// Decision 389: pure rules of the release step — state from events, release plan (approval gating, confirmed owners go
// straight to the installer), what the tick does when, the Needs me / waiting-list piles, the owner page, the wording.
import { describe, expect, test } from "bun:test";
import { NO_RATE_CARD_REASON,
  CONFIRM_BUTTON, DECLINE_REASON, LAPSED_NEEDS_LINE, OWNER_CONFIRMED_LINE, SPOT_RELEASED_APPROVED, SPOT_RELEASED_EVENT, SPOT_RELEASED_LINE, SPOT_RELEASED_SUBJECT,
  SPOT_RELEASE_CONFIRMED_EVENT, SPOT_RELEASE_DECLINED_EVENT, SPOT_RELEASE_LAPSED_EVENT, SPOT_RELEASE_PAGE, SPOT_RELEASE_REMINDED_EVENT, SPOT_RELEASE_UNAPPROVED, WHAT_HAPPENS_NEXT,
  jobWaitingForInstaller, nextReleaseSeq, officeItemWithRelease, ownerTurnView, releasable, releasePlan, releaseStatusLine, spotReleaseDue, spotReleaseKey,
  spotReleasePageLink, spotReleaseState, spotReleasedText, type SpotReleaseEventRow, type SpotReleaseState,
} from "../src/lib/spot-release.core";
import { renderSpotReleasedEmail } from "../src/lib/spot-release-email.core";
import { SMS_FRESHNESS, SMS_MESSAGE_TYPES } from "../src/lib/sms.core";
import { buildNeedsRows, needsCandidates } from "../src/lib/office-needs.core";

const J = "job-1";
const ev = (event_type: string, created_at: string, details: Record<string, unknown>): SpotReleaseEventRow => ({ event_type, created_at, details });
const released = (seq: number, at: string, more: Record<string, unknown> = {}) => ev(SPOT_RELEASED_EVENT, at, { release_seq: seq, business_id: `b${seq}`, business_name: `Installer ${seq}`, released_by: "jo", idempotency_key: spotReleaseKey(J, seq, "released"), ...more });
const outcome = (type: string, seq: number, at: string) => ev(type, at, { release_seq: seq, idempotency_key: spotReleaseKey(J, seq, "outcome") });
const reminded = (seq: number, at: string, step = "reminder") => ev(SPOT_RELEASE_REMINDED_EVENT, at, { release_seq: seq, step, idempotency_key: spotReleaseKey(J, seq, step as "reminder") });
const T0 = "2026-10-26T00:00:00.000Z"; // 11am Melbourne
const h = (n: number) => new Date(Date.parse(T0) + n * 3_600_000);

describe("state from events (table)", () => {
  const cases: [string, SpotReleaseEventRow[], string][] = [
    ["nothing released", [], "none"],
    ["released, no answer", [released(1, T0)], "pending"],
    ["released + reminded", [released(1, T0), reminded(1, h(48).toISOString())], "pending"],
    ["confirmed", [released(1, T0), outcome(SPOT_RELEASE_CONFIRMED_EVENT, 1, h(1).toISOString())], "confirmed"],
    ["declined", [released(1, T0), outcome(SPOT_RELEASE_DECLINED_EVENT, 1, h(1).toISOString())], "declined"],
    ["lapsed", [released(1, T0), outcome(SPOT_RELEASE_LAPSED_EVENT, 1, h(120).toISOString())], "lapsed"],
    ["lapsed then released again", [released(1, T0), outcome(SPOT_RELEASE_LAPSED_EVENT, 1, h(120).toISOString()), released(2, h(121).toISOString())], "pending"],
    ["first outcome wins (confirm before a racing lapse)", [released(1, T0), outcome(SPOT_RELEASE_CONFIRMED_EVENT, 1, h(119).toISOString()), outcome(SPOT_RELEASE_LAPSED_EVENT, 1, h(120).toISOString())], "confirmed"],
    ["events in any order", [outcome(SPOT_RELEASE_DECLINED_EVENT, 1, h(1).toISOString()), released(1, T0)], "declined"],
    ["an outcome of an older release doesn't close the newer one", [released(1, T0), outcome(SPOT_RELEASE_LAPSED_EVENT, 1, h(120).toISOString()), released(2, h(130).toISOString())], "pending"],
  ];
  for (const [name, events, want] of cases) test(name, () => expect(spotReleaseState(events).state).toBe(want));
  test("pending carries the installer, release number and steps done", () => {
    const s = spotReleaseState([released(2, T0, { text_waits_for_morning: true }), reminded(2, h(9).toISOString(), "release_text")]);
    expect(s).toMatchObject({ state: "pending", seq: 2, businessId: "b2", businessName: "Installer 2", releasedBy: "jo", reminded: false, releaseTextDone: true, textWaitsForMorning: true });
  });
  test("next release number", () => {
    expect(nextReleaseSeq([])).toBe(1);
    expect(nextReleaseSeq([released(1, T0), released(2, T0)])).toBe(3);
  });
  test("keys are per job + release + slot; confirm/decline/lapse share the outcome slot", () => {
    expect(spotReleaseKey(J, 1, "released")).toBe("spot-release:v1:job-1:1:released");
    expect(outcome(SPOT_RELEASE_CONFIRMED_EVENT, 1, T0).details).toEqual(outcome(SPOT_RELEASE_LAPSED_EVENT, 1, T0).details);
    expect(spotReleaseKey(J, 1, "reminder")).not.toBe(spotReleaseKey(J, 2, "reminder"));
  });
});

describe("Release plan (approval gating; a confirmed owner is never asked again)", () => {
  const none: SpotReleaseState = { state: "none" };
  const st = (events: SpotReleaseEventRow[]) => spotReleaseState(events);
  test("unapproved: REAL job refuses with the clear message; TEST job releases", () => {
    // Jo approved O77 + the text on 25 Oct 2026 (decision 389); the gate itself stays covered below.
    expect(SPOT_RELEASED_APPROVED).toBe(true);
    expect(SMS_MESSAGE_TYPES.spot_released.wordingApproved).toBe(true);
    expect(releasePlan({ state: none, testJob: false, emailApproved: false, smsApproved: false, hasRateCard: true })).toEqual({ mode: "refused", reason: SPOT_RELEASE_UNAPPROVED });
    expect(releasePlan({ state: none, testJob: false, emailApproved: true, smsApproved: false, hasRateCard: true })).toEqual({ mode: "refused", reason: SPOT_RELEASE_UNAPPROVED });
    expect(SPOT_RELEASE_UNAPPROVED).toBe("The 'It's your turn' message isn't approved yet");
    expect(releasePlan({ state: none, testJob: true, emailApproved: false, smsApproved: false, hasRateCard: true })).toEqual({ mode: "release" });
    expect(releasePlan({ state: none, testJob: false, emailApproved: true, smsApproved: true, hasRateCard: true })).toEqual({ mode: "release" });
  });
  test("pending → refused (not available again); declined → refused; lapsed → release again", () => {
    expect(releasePlan({ state: st([released(1, T0)]), testJob: true, emailApproved: true, smsApproved: true, hasRateCard: true }).mode).toBe("refused");
    expect(releasePlan({ state: st([released(1, T0), outcome(SPOT_RELEASE_DECLINED_EVENT, 1, T0)]), testJob: true, emailApproved: true, smsApproved: true, hasRateCard: true }).mode).toBe("refused");
    expect(releasePlan({ state: st([released(1, T0), outcome(SPOT_RELEASE_LAPSED_EVENT, 1, T0)]), testJob: true, emailApproved: true, smsApproved: true, hasRateCard: true }).mode).toBe("release");
  });
  test("confirmed owner (offer came back) → straight to the installer offer, even while unapproved", () => {
    expect(releasePlan({ state: st([released(1, T0), outcome(SPOT_RELEASE_CONFIRMED_EVENT, 1, T0)]), testJob: false, emailApproved: false, smsApproved: false, hasRateCard: true })).toEqual({ mode: "direct_offer" });
  });
  test("decision 399: no active installer rate card → refused with Jo's exact words, whatever the state", () => {
    expect(NO_RATE_CARD_REASON).toBe("This installer has no rate card yet");
    for (const state of [none, st([released(1, T0), outcome(SPOT_RELEASE_LAPSED_EVENT, 1, T0)]), st([released(1, T0), outcome(SPOT_RELEASE_CONFIRMED_EVENT, 1, T0)])])
      for (const testJob of [true, false])
        expect(releasePlan({ state, testJob, emailApproved: true, smsApproved: true, hasRateCard: false })).toEqual({ mode: "refused", reason: NO_RATE_CARD_REASON });
    // A pending / declined job keeps its own (more useful) reason.
    expect(releasePlan({ state: st([released(1, T0)]), testJob: true, emailApproved: true, smsApproved: true, hasRateCard: false }).mode).toBe("refused");
    expect((releasePlan({ state: st([released(1, T0)]), testJob: true, emailApproved: true, smsApproved: true, hasRateCard: false }) as { reason: string }).reason).toMatch(/Already released/);
  });
  test("releasable", () => {
    expect(releasable(none)).toBe(true);
    expect(releasable(st([released(1, T0)]))).toBe(false);
    expect(releasable(st([released(1, T0), outcome(SPOT_RELEASE_LAPSED_EVENT, 1, T0)]))).toBe(true);
    expect(releasable(st([released(1, T0), outcome(SPOT_RELEASE_CONFIRMED_EVENT, 1, T0)]))).toBe(true);
  });
});

describe("tick: day-2 reminder, 7am release text, day-5 lapse", () => {
  const waiting = { waiting: true };
  const p = spotReleaseState([released(1, T0)]);
  test("nothing before day 2; reminder at 48h in the day; never twice; lapse at 120h", () => {
    expect(spotReleaseDue(p, h(47), waiting)).toBeNull();
    expect(spotReleaseDue(p, h(48), waiting)).toBe("reminder");
    expect(spotReleaseDue(spotReleaseState([released(1, T0), reminded(1, h(48).toISOString())]), h(60), waiting)).toBeNull();
    expect(spotReleaseDue(spotReleaseState([released(1, T0), reminded(1, h(48).toISOString())]), h(120), waiting)).toBe("lapse");
    expect(spotReleaseDue(p, h(121), waiting)).toBe("lapse");
  });
  test("reminder waits for daytime (quiet hours 8pm–7am Melbourne)", () => {
    const night = spotReleaseState([released(1, "2026-10-26T10:00:00.000Z")]); // 9pm Melbourne
    expect(spotReleaseDue(night, new Date("2026-10-28T10:00:00.000Z"), waiting)).toBeNull(); // 9pm, day 2
    expect(spotReleaseDue(night, new Date("2026-10-28T20:30:00.000Z"), waiting)).toBe("reminder"); // 7:30am
  });
  test("released during quiet hours → the text goes once at 7am", () => {
    const s = spotReleaseState([released(1, "2026-10-26T10:00:00.000Z", { text_waits_for_morning: true })]);
    expect(spotReleaseDue(s, new Date("2026-10-26T11:00:00.000Z"), waiting)).toBeNull(); // 10pm
    expect(spotReleaseDue(s, new Date("2026-10-26T20:15:00.000Z"), waiting)).toBe("release_text"); // 7:15am
    const done = spotReleaseState([released(1, "2026-10-26T10:00:00.000Z", { text_waits_for_morning: true }), reminded(1, "2026-10-26T20:15:00.000Z", "release_text")]);
    expect(spotReleaseDue(done, new Date("2026-10-26T21:00:00.000Z"), waiting)).toBeNull();
  });
  test("only pending releases on jobs still waiting", () => {
    expect(spotReleaseDue(p, h(200), { waiting: false })).toBeNull();
    expect(spotReleaseDue(spotReleaseState([released(1, T0), outcome(SPOT_RELEASE_CONFIRMED_EVENT, 1, T0)]), h(200), waiting)).toBeNull();
    expect(spotReleaseDue({ state: "none" }, h(200), waiting)).toBeNull();
  });
  test("waiting = our lead at the Ready Check scheduling stage, nobody assigned, not deleted", () => {
    expect(jobWaitingForInstaller({ channel: "hivic_sourced", stage: "ready_check_ready_to_schedule", hasInstaller: false, deleted: false })).toBe(true);
    expect(jobWaitingForInstaller({ channel: "installer_sourced", stage: "ready_check_ready_to_schedule", hasInstaller: false, deleted: false })).toBe(false);
    expect(jobWaitingForInstaller({ channel: "hivic_sourced", stage: "ready_check_ready_to_schedule", hasInstaller: true, deleted: false })).toBe(false);
    expect(jobWaitingForInstaller({ channel: "hivic_sourced", stage: "cancelled", hasInstaller: false, deleted: false })).toBe(false);
  });
});

describe("one pile per job: Needs me and the waiting list", () => {
  const choose = { code: "choose_installer" as const };
  test("pending → no office item; lapsed → the ONE lapse row; confirmed/none → unchanged; returned offer unchanged", () => {
    expect(officeItemWithRelease(choose, spotReleaseState([released(1, T0)]))).toBeNull();
    expect(officeItemWithRelease(choose, spotReleaseState([released(1, T0), outcome(SPOT_RELEASE_LAPSED_EVENT, 1, h(120).toISOString())]))).toEqual({ code: "release_lapsed", name: "Installer 1", at: h(120).toISOString() });
    expect(officeItemWithRelease(choose, spotReleaseState([released(1, T0), outcome(SPOT_RELEASE_CONFIRMED_EVENT, 1, T0)]))).toEqual(choose);
    expect(officeItemWithRelease(choose, { state: "none" })).toEqual(choose);
    const returned = { code: "offer_returned" as const, status: "declined" as const, name: "X" };
    expect(officeItemWithRelease(returned, spotReleaseState([released(1, T0), outcome(SPOT_RELEASE_CONFIRMED_EVENT, 1, T0)]))).toEqual(returned);
    expect(officeItemWithRelease(null, spotReleaseState([released(1, T0)]))).toBeNull();
  });
  test("lapse is ONE Needs me row (never alongside choose installer)", () => {
    const f = { jobId: "j", jobNumber: "HV-1", surname: "Sample", suburb: null, releaseLapsed: { at: T0, name: "Installer 1" } };
    const c = needsCandidates(f, Date.parse(T0));
    expect(c.map((x) => x.kind)).toEqual(["release_lapsed"]);
    expect(c[0]!.line).toBe(`${LAPSED_NEEDS_LINE} · released to Installer 1`);
    expect(LAPSED_NEEDS_LINE).toBe("Didn't confirm after release — release to someone else or leave");
    const rows = buildNeedsRows({ now: Date.parse(T0), jobs: [f, { ...f, jobId: "k", releaseLapsed: null, spotSaved: { at: T0 } }] });
    const all = [...rows.today, ...rows.week, ...rows.watch];
    expect(all.filter((r) => r.jobId === "j").map((r) => r.kind)).toEqual(["release_lapsed"]);
    expect(all.filter((r) => r.jobId === "k").map((r) => r.kind)).toEqual(["choose_installer"]);
  });
  test("waiting-list status lines", () => {
    const now = Date.parse(h(5).toISOString());
    expect(releaseStatusLine(spotReleaseState([released(1, T0)]), now)).toMatch(/^Released to Installer 1 · waiting for owner since .*\(5h\)$/);
    expect(releaseStatusLine(spotReleaseState([released(1, T0), outcome(SPOT_RELEASE_CONFIRMED_EVENT, 1, T0)]), now)).toBe(OWNER_CONFIRMED_LINE);
    expect(OWNER_CONFIRMED_LINE).toBe("Owner confirmed — choose installer");
    expect(releaseStatusLine(spotReleaseState([released(1, T0), outcome(SPOT_RELEASE_LAPSED_EVENT, 1, T0)]), now)).toContain("Didn't confirm after release");
    expect(releaseStatusLine({ state: "none" }, now)).toBeNull();
  });
});

describe("owner page and wording", () => {
  const w = { waiting: true, cancelled: false };
  test("page view", () => {
    expect(ownerTurnView(spotReleaseState([released(1, T0)]), w)).toEqual({ kind: "ask" });
    expect(ownerTurnView(spotReleaseState([released(1, T0)]), { waiting: false, cancelled: false })).toEqual({ kind: "closed" });
    expect(ownerTurnView(spotReleaseState([released(1, T0), outcome(SPOT_RELEASE_CONFIRMED_EVENT, 1, T0)]), { waiting: false, cancelled: false })).toEqual({ kind: "confirmed", installer: "Installer 1" });
    expect(ownerTurnView(spotReleaseState([released(1, T0), outcome(SPOT_RELEASE_DECLINED_EVENT, 1, T0)]), { waiting: false, cancelled: true })).toEqual({ kind: "declined" });
    expect(ownerTurnView(spotReleaseState([released(1, T0), outcome(SPOT_RELEASE_LAPSED_EVENT, 1, T0)]), w)).toEqual({ kind: "closed" });
    expect(ownerTurnView({ state: "none" }, w)).toEqual({ kind: "closed" });
  });
  test("Jo's words, verbatim", () => {
    expect(SPOT_RELEASED_SUBJECT).toBe("It's your turn — confirm your free Ready Check");
    expect(SPOT_RELEASED_LINE).toBe("It's your turn! Press here to confirm you'd still like your free Ready Check, and one of our EEC-certified installers will be in touch.");
    expect(spotReleasedText("L")).toBe("Home Insulation Victoria: it's your turn! Confirm you'd still like your free Ready Check and one of our EEC-certified installers will be in touch: L");
    expect(spotReleasedText("L", true)).toMatch(/^Home Insulation Victoria: just checking — it's your turn!/);
    expect(spotReleasedText("L")).not.toContain("What happens next");
    expect(SPOT_RELEASE_PAGE.confirm).toBe("Yes, I'd still like my free Ready Check");
    expect(SPOT_RELEASE_PAGE.decline).toBe("I'm no longer interested");
    expect(SPOT_RELEASE_PAGE.thanks("Sample Insulation")).toBe("Thanks — confirmed. Sample Insulation will text and email you 3 times for your free Ready Check within a day or so.");
    expect(SPOT_RELEASE_PAGE.thanks(null)).toBe("Thanks — confirmed. Your installer will text and email you 3 times for your free Ready Check within a day or so.");
    expect(DECLINE_REASON).toBe("No longer interested (owner, at release)");
    expect(WHAT_HAPPENS_NEXT.steps).toEqual([
      "Press Confirm.",
      "Within a day or so, your installer will text and email you 3 times for your free Ready Check.",
      "Tap the time that suits you (or suggest other days). They'll check your ceiling and measure up, and your fixed quote follows.",
    ]);
    expect(spotReleasePageLink("https://x/my-job/t")).toBe("https://x/my-job/t?screen=turn");
  });
  test("O77 (MJML refresh 27 Oct): the Confirm line, then the Confirm button, then What happens next; reminder variant", () => {
    const m = renderSpotReleasedEmail({ firstName: "Helen Sample", confirmUrl: "https://x/my-job/t?screen=turn", unsubscribeUrl: "https://x/u", reminder: false });
    expect(m.subject).toBe(SPOT_RELEASED_SUBJECT);
    const iLine = m.html.indexOf("Press Confirm to tell us you'd still like your free Ready Check.");
    const iNext = m.html.indexOf(">What happens next<"), iBtn = m.html.indexOf(">Confirm<");
    expect(iLine).toBeGreaterThan(0);
    expect(iBtn).toBeGreaterThan(iLine);
    expect(iNext).toBeGreaterThan(iBtn);
    expect(m.html).toContain(`href="https://x/my-job/t?screen=turn"`);
    for (const s of WHAT_HAPPENS_NEXT.steps) expect(m.text).toContain(s);
    expect(m.text).toContain(`${CONFIRM_BUTTON}: https://x/my-job/t?screen=turn`);
    expect(m.html).toContain("Hi Helen, it's your turn!");
    const r = renderSpotReleasedEmail({ firstName: null, confirmUrl: "u", unsubscribeUrl: null, reminder: true });
    expect(r.subject).toMatch(/^Just checking — it's your turn/);
    expect(r.text).toContain("Hi, just checking — it's your turn!");
  });
  test("SMS type: owner, quiet hours, window freshness, approved", () => {
    expect(SMS_MESSAGE_TYPES.spot_released).toMatchObject({ audience: "owner", wordingApproved: true, quietHours: true });
    expect(SMS_FRESHNESS.spot_released).toEqual({ kind: "window" });
  });
});
