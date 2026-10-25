// Decision 315 (Jo 25 Oct 2026): A3 PIESA completed + electrical fixes needed + no fixes times yet → ONE text to the
// assigned electrician with a link to pick 3–5 fixes times on their job page; the fixes quote is held until the times
// exist; 24h with no times → one Needs me row. Plus the decision-314 follow-up: "Be on site at the start of the install
// day" alone clears on the accepted + paid fixes quote (basis electrician_at_start, 30 days from the official PIESA).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  FIXES_TIMES_ANCHOR, FIXES_TIMES_GIVEN_EVENT, FIXES_TIMES_HOLD_REASON, FIXES_TIMES_LINK_EVENT, FIXES_TIMES_MISSING_LINE, FIXES_TIMES_SMS_TYPE,
  fixesTimesCardState, fixesTimesHoldReason, fixesTimesLink, fixesTimesLinkBlocker, fixesTimesLinkKey, fixesTimesLinkText, fixesTimesMissing, fixesTimesNeeded, onsiteStartOnly,
} from "../src/lib/fixes-times.core";
import { FIXES_ONSITE_OPTION, FIXES_WORK_LABEL, RECTIFICATION_OUTCOMES, shortAnswersFromEntries } from "../src/lib/official-short.core";
import { SMS_FRESHNESS, SMS_MESSAGE_TYPES, brandSmsBody, smsStaleReason } from "../src/lib/sms.core";
import { electricalClearance, rectificationSendBlocker } from "../src/lib/allocation.core";
import { buildNeedsRows } from "../src/lib/office-needs.core";
import { installerTextAddress } from "../src/lib/installer-texts.core";

const REPAIR = RECTIFICATION_OUTCOMES[1];
const ONSITE = RECTIFICATION_OUTCOMES[2];
const read = (f: string) => readFileSync(f, "utf8");

describe("fixesTimesNeeded — the existing rectification-needed reading (fixesFormNeeded) minus on-site-only", () => {
  test("repair needed and not fixed on the same visit → times needed", () => {
    expect(fixesTimesNeeded({ rectificationOutcome: REPAIR })).toBe(true);
    expect(fixesTimesNeeded({ rectificationOutcome: REPAIR, rectificationComplete: "No" })).toBe(true);
  });
  test("fixed on the same visit, or no repair → none", () => {
    expect(fixesTimesNeeded({ rectificationOutcome: REPAIR, rectificationComplete: "Yes" })).toBe(false);
    expect(fixesTimesNeeded({ rectificationOutcome: RECTIFICATION_OUTCOMES[0] })).toBe(false);
    expect(fixesTimesNeeded({})).toBe(false);
  });
  test("decision 314: 'Be on site at the start of the install day' as the ONLY tick → no times; with another tick → times", () => {
    expect(onsiteStartOnly({ rectificationOutcome: ONSITE, fixesWork: FIXES_ONSITE_OPTION })).toBe(true);
    expect(fixesTimesNeeded({ rectificationOutcome: ONSITE, fixesWork: FIXES_ONSITE_OPTION })).toBe(false);
    const both = `Install RCD safety switches, ${FIXES_ONSITE_OPTION}`;
    expect(onsiteStartOnly({ rectificationOutcome: ONSITE, fixesWork: both })).toBe(false);
    expect(fixesTimesNeeded({ rectificationOutcome: ONSITE, fixesWork: both })).toBe(true);
    // No tick list at all (a form from before decision 308) is not "on site only".
    expect(onsiteStartOnly({ rectificationOutcome: REPAIR })).toBe(false);
  });
  test("read from the real A3 labels (shortAnswersFromEntries)", () => {
    const entries = (work: string) => [
      { label: "Is any electrical repair work needed before insulation can be installed?", value: "Yes" },
      { label: FIXES_WORK_LABEL, value: work },
    ];
    expect(fixesTimesNeeded(shortAnswersFromEntries("piesa", entries(FIXES_ONSITE_OPTION)))).toBe(false);
    expect(fixesTimesNeeded(shortAnswersFromEntries("piesa", entries("Install RCD safety switches")))).toBe(true);
  });
});

describe("fixesTimesLinkBlocker (pure)", () => {
  const ok = { deleted: false, piesaCompleted: true, timesNeeded: true, windowsExist: false, alreadySent: false, electricianAssigned: true };
  test("send once the PIESA is completed, fixes needed, no times yet", () => expect(fixesTimesLinkBlocker(ok)).toBeNull());
  test("every hold reason", () => {
    expect(fixesTimesLinkBlocker({ ...ok, deleted: true })).toBe("job closed");
    expect(fixesTimesLinkBlocker({ ...ok, piesaCompleted: false })).toBe("PIESA not completed in Mitti");
    expect(fixesTimesLinkBlocker({ ...ok, timesNeeded: false })).toBe("no electrical fixes visit needed");
    expect(fixesTimesLinkBlocker({ ...ok, windowsExist: true })).toBe("fixes times already given");
    expect(fixesTimesLinkBlocker({ ...ok, alreadySent: true })).toBe("already texted");
    expect(fixesTimesLinkBlocker({ ...ok, electricianAssigned: false })).toBe("no electrician assigned");
  });
});

describe("wording, key, link and SMS type", () => {
  test("the decision-315 wording, brand prefix added by the sender", () => {
    const link = fixesTimesLink("https://estimate.homeinsulationvictoria.com.au/", "job-1");
    expect(link).toBe(`https://estimate.homeinsulationvictoria.com.au/field/job-1#${FIXES_TIMES_ANCHOR}`);
    expect(FIXES_TIMES_ANCHOR).toBe("fixes-times");
    const body = fixesTimesLinkText({ address: installerTextAddress("12 Smith St, Frankston VIC 3199", "Frankston"), link });
    expect(body).toBe("Your safety check at 12 Smith St, Frankston needs electrical fixes. Please pick 3 to 5 times you can do the work: https://estimate.homeinsulationvictoria.com.au/field/job-1#fixes-times");
    expect(brandSmsBody(body)).toBe(`Home Insulation Victoria: ${body}`);
    expect(fixesTimesLinkText({ address: null, link: "https://x/f" })).toBe("Your safety check at the property needs electrical fixes. Please pick 3 to 5 times you can do the work: https://x/f");
  });
  test("one key per job + PIESA form; event names", () => {
    expect(fixesTimesLinkKey("job-1", "audit-9")).toBe("fixes-times-link:v1:job-1:audit-9");
    expect(FIXES_TIMES_LINK_EVENT).toBe("fixes_times_link_sent");
    expect(FIXES_TIMES_GIVEN_EVENT).toBe("rectification_windows_given");
  });
  test("SMS type: trade audience, approved, quiet hours, 24h event freshness", () => {
    expect(FIXES_TIMES_SMS_TYPE).toBe("fixes_times_link");
    expect(SMS_MESSAGE_TYPES.fixes_times_link).toMatchObject({ audience: "partner", wordingApproved: true, quietHours: true });
    expect(SMS_FRESHNESS.fixes_times_link).toEqual({ kind: "event", maxAgeMinutes: 24 * 60 });
    expect(smsStaleReason("fixes_times_link", { at: "2026-10-24T01:00:00.000Z", current: true }, "2026-10-26T02:00:00.000Z")).toMatch(/Too late/);
  });
});

describe("quote hold, card state, Needs me", () => {
  test("hold until the windows exist (only when times are needed); Send refuses with the reason", () => {
    expect(fixesTimesHoldReason({ timesNeeded: true, windowsExist: false })).toBe(FIXES_TIMES_HOLD_REASON);
    expect(FIXES_TIMES_HOLD_REASON).toBe("Waiting for the electrician's fixes times");
    expect(fixesTimesHoldReason({ timesNeeded: true, windowsExist: true })).toBeNull();
    expect(fixesTimesHoldReason({ timesNeeded: false, windowsExist: false })).toBeNull();
    const q = { kind: "rectification", status: "draft", office_reviewed_at: "x", has_unpriced_items: false };
    expect(rectificationSendBlocker({ ...q, fixes_times_hold: FIXES_TIMES_HOLD_REASON }, true)).toBe(FIXES_TIMES_HOLD_REASON);
    expect(rectificationSendBlocker({ ...q, fixes_times_hold: null }, true)).toBeNull();
    expect(rectificationSendBlocker(q, true)).toBeNull();
  });
  test("card: electricians only; shown once completed/linked and needed; times shown once given", () => {
    const base = { electrician: true, timesNeeded: true, piesaCompleted: true, linkSent: false, windowsExist: false };
    expect(fixesTimesCardState(base)).toEqual({ show: true, given: false });
    expect(fixesTimesCardState({ ...base, electrician: false })).toEqual({ show: false });
    expect(fixesTimesCardState({ ...base, piesaCompleted: false })).toEqual({ show: false });
    expect(fixesTimesCardState({ ...base, piesaCompleted: false, linkSent: true })).toEqual({ show: true, given: false });
    expect(fixesTimesCardState({ ...base, timesNeeded: false })).toEqual({ show: false });
    expect(fixesTimesCardState({ ...base, windowsExist: true })).toEqual({ show: true, given: true });
  });
  test("24h after the link with no times → one row; cleared by the times; younger links wait", () => {
    const now = Date.parse("2026-10-27T03:00:00.000Z");
    const links = [{ job_id: "A", created_at: "2026-10-26T01:00:00.000Z" }, { job_id: "B", created_at: "2026-10-26T01:00:00.000Z" }, { job_id: "C", created_at: "2026-10-27T01:00:00.000Z" }];
    const given = [{ job_id: "B", created_at: "2026-10-26T05:00:00.000Z" }, { job_id: "A", created_at: "2026-10-20T00:00:00.000Z" }];
    const m = fixesTimesMissing({ links, given, now });
    expect([...m.keys()]).toEqual(["A"]);
    const g = buildNeedsRows({ now, jobs: [{ jobId: "A", jobNumber: "HV-1", surname: "Smith", suburb: "Frankston", fixesTimesMissing: m.get("A")! }] });
    expect(g.week.map((r) => [r.kind, r.line, r.button])).toEqual([["fixes_times_missing", FIXES_TIMES_MISSING_LINE, { label: "Open job", to: "job", section: "piesa" }]]);
    expect(FIXES_TIMES_MISSING_LINE).toBe("Electrician hasn't given fixes times");
  });
});

describe("decision 314 follow-up: on site at the start only → cleared on the accepted + paid fixes quote", () => {
  const r = { piesaOutcome: "fail" as const, piesaCompletedAt: "2026-10-01", rectificationRequired: true, rectificationQuoteAccepted: false, rectificationCompletedAt: null, sectionCSignedAt: null, onsiteStartOnly: true, fixesPaymentCleared: false };
  test("not before the owner accepts, not before the payment rule clears", () => {
    expect(electricalClearance(r).cleared).toBe(false);
    const accepted = electricalClearance({ ...r, rectificationQuoteAccepted: true });
    expect(accepted.cleared).toBe(false);
    expect(accepted.blocker).toMatch(/payment/);
  });
  test("accepted + paid → basis electrician_at_start, 30 days from the official PIESA date; no Section C needed", () => {
    expect(electricalClearance({ ...r, rectificationQuoteAccepted: true, fixesPaymentCleared: true })).toMatchObject({ cleared: true, basis: "electrician_at_start", timingDate: "2026-10-01", blocker: null });
  });
  test("other repair work still needs the fixes visit + Section C", () => {
    expect(electricalClearance({ ...r, onsiteStartOnly: false, rectificationQuoteAccepted: true, fixesPaymentCleared: true }).cleared).toBe(false);
  });
});

describe("source pins", () => {
  test("sender: event claimed BEFORE sending; TEST → test-send; real → sendRealSms fixes_times_link with the job+audit key; no raw gateway", () => {
    const s = read("src/lib/fixes-times-link.server.ts");
    const idx = (t: string) => { const i = s.indexOf(t); expect(i, t).toBeGreaterThan(-1); return i; };
    expect(idx("fixesTimesLinkBlocker({")).toBeLessThan(idx("logEvent(jobId, null, FIXES_TIMES_LINK_EVENT"));
    expect(idx("logEvent(jobId, null, FIXES_TIMES_LINK_EVENT")).toBeLessThan(idx("sendTestSms("));
    expect(idx("sendTestSms(")).toBeLessThan(idx("sendRealSms("));
    expect(s).toContain('const test = j.source === "qa_test" || partnerIsTest;');
    expect(s).toContain("sendRealSms({ type: FIXES_TIMES_SMS_TYPE, idempotencyKey: key, to, body, jobId, businessId: asg!.business_id, event: { at: completedAt, current: !windowsExist } })");
    expect(s).toContain("fixesTimesLink(test ? TEST_APP_BASE : SET_PASSWORD_BASE, jobId)");
    expect(s).not.toMatch(/fetch\(|twilio/i);
  });
  test("the A3 sync calls it only when the PIESA is completed", () => {
    expect(read("src/lib/mitti.server.ts")).toContain('if (completed) await (await import("./fixes-times-link.server")).textFixesTimesLink(jobId, { auditId: a.external_mitti_id, completedAt: plan.modifiedAt ?? now, short: shortAnswers });');
  });
  test("new literal createServerFn chain → trade-view.server → the ONE shared write; the old portal path uses the same write", () => {
    const f = read("src/lib/trade-view.functions.ts");
    expect(f).toMatch(/export const saveTradeFixesTimes = createServerFn\(\{ method: "POST" \}\)\.middleware\(\[requireSupabaseAuth\]\)\n\s+\.inputValidator\([\s\S]+?\)\n\s+\.handler\(async \(\{ data, context \}\) => \{\n\s+const r = await \(await import\("\.\/trade-view\.server"\)\)\.tradeSaveFixesTimes\(/);
    expect(f).toMatch(/export const getTradeFixesTimes = createServerFn\(\{ method: "POST" \}\)\.middleware\(\[requireSupabaseAuth\]\)\n\s+\.inputValidator/);
    expect(f).not.toContain("@tanstack/react-start/server");
    const tv = read("src/lib/trade-view.server.ts");
    const save = tv.slice(tv.indexOf("export async function tradeSaveFixesTimes"));
    expect(save.indexOf("requireJobElectrician(jobId, userId)")).toBeLessThan(save.indexOf("recordRectificationWindows("));
    expect(tv).toContain('if (c.kind !== "electrician") return null;');
    const rs = read("src/lib/rectification.server.ts");
    const body = rs.slice(rs.indexOf("export async function recordRectificationWindows"));
    expect(body.indexOf("rectPlanBlockers(hours, windows)")).toBeLessThan(body.indexOf('.from("appointment_proposals").insert('));
    expect(body).toContain("electrician_window: true");
    expect(body).toContain("logEvent(jobId, actorId, FIXES_TIMES_GIVEN_EVENT");
    const pf = read("src/lib/portal.functions.ts");
    expect(pf).toContain("recordRectificationWindows(data.jobId, context.userId, data.rectHours, data.rectWindows)");
    expect(pf).not.toContain('"rectification_windows_given"');
  });
  test("the hold goes through the existing fixes-quote send check; the office card shows it", () => {
    const af = read("src/lib/allocation.functions.ts");
    expect(af.slice(af.indexOf("export const sendRectificationQuote"))).toContain('releaseFixesQuote(data.quoteId, context.userId, "office")');
    // Decision 354: the one shared release (office Send + automatic send) carries the check.
    const send = read("src/lib/fixes-quote-release.server.ts");
    expect(send.indexOf("fixesTimesHoldFor(q.job_id)")).toBeLessThan(send.indexOf("rectificationSendBlocker({"));
    expect(send).toContain("fixes_times_hold: fixesTimesHold");
    expect(read("src/components/portal/allocation.tsx")).toContain("data-fixes-times-hold");
  });
  test("no sender reachable from the senders-free modules", () => {
    for (const f of ["src/lib/rectification.server.ts", "src/lib/trade-view.server.ts", "src/lib/office-needs.server.ts"]) expect(read(f)).not.toContain("fixes-times-link.server");
  });
});
