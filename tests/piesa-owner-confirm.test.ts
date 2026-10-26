// Decision 296 (Jo, 25 Oct 2026): the owner confirms the PIESA by secure link — pure rules, the official-form expansion,
// the installer Next line, the Needs me row, the P6 mock-up wording and the O71 draft files.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CEILING_ENTRY_WARNING, OFFICIAL_OWNER_DECLARATIONS, OUTCOME_LABEL, OWNER_CONFIRMATION_NOT_SIGNED_FLAG, OWNER_PIESA_CONFIRMATION_BLOCKER, OWNER_PIESA_CONFIRM_WAITING,
  PIESA_CONFIRM_SCHEDULE, PIESA_OWNER_CONFIRMED_EVENT, PIESA_OWNER_CONFIRM_EMAIL_APPROVED, PIESA_OWNER_CONFIRM_OFFICE_ALERT_EVENT, PIESA_OWNER_CONFIRM_SMS_APPROVED, PIESA_OWNER_CONFIRM_SMS_TYPE, PIESA_OWNER_CONFIRM_STEP_EVENT,
  buildPiesaOwnerConfirmation, confirmTickText, confirmationFromEvents, melbourneDateOf, nextPiesaConfirmStep, ownerConfirmationForForm, ownerPiesaConfirmationBlocker, piesaConfirmKey, piesaConfirmPage,
  piesaConfirmPurpose, piesaOutcomeKind, piesaOwnerConfirmReminderText, piesaOwnerConfirmRequestText, piesaOwnerConfirmedSummary, validateOwnerPiesaConfirmation, type PiesaOwnerConfirmFacts,
} from "../src/lib/piesa-owner-confirm.core";
import { renderPiesaOwnerConfirmEmail } from "../src/lib/piesa-owner-confirm-email.core";
import { expandPiesa } from "../src/lib/official-expand.core";
import { OFFICIAL_ITEMS } from "../src/lib/official-forms.core";
import { SHORT_PIESA_FIELDS, shortAnswersFromEntries } from "../src/lib/official-short.core";
import { jobNext } from "../src/lib/installer-screens.core";
import { buildNeedsRows, needsCandidates } from "../src/lib/office-needs.core";
import { SMS_FRESHNESS, SMS_MESSAGE_TYPES } from "../src/lib/sms.core";
import { P6, OWNER_PAGE_FOOTER } from "../src/lib/owner-pages.core";
import { FOOTER_TEXT } from "../src/lib/email-kit.core";
import { MAIL_LOGO_URL } from "../src/lib/mail-mjml.core";
import { O71_FILES, O71_SAMPLE } from "../scripts/render-decision-296-drafts";

const REC = "11111111-1111-1111-1111-111111111111";
/** Short Mitti PIESA answers as label/value entries (the same shape the sync stores). */
const entries = (_key: "piesa", values: Record<string, string>) => SHORT_PIESA_FIELDS.filter((f) => values[f.id!] !== undefined).map((f) => ({ label: f.label, value: values[f.id!]! }));
const facts = (over: Partial<PiesaOwnerConfirmFacts> = {}): PiesaOwnerConfirmFacts => ({
  piesaRecordId: REC, completedDate: "2026-10-24", completedAt: "2026-10-24T03:30:00Z", outcome: "pass", rectificationRequired: false, electricianOnInstallDay: false,
  electrician: { name: "Sam Spark", recName: "Spark Electrical Pty Ltd" }, signedCopy: { id: "copy-1", sha: "abc" }, confirmation: null, ...over,
});
const signed = { name: "Helen Yang", authority: "owner" as const, signedAt: "2026-10-25T01:00:00Z", piesaRecordId: REC, signedCopyId: "copy-1" };

describe("outcome + page", () => {
  test("three outcomes: all clear / repair work needed / electrician present on install day", () => {
    expect(piesaOutcomeKind({ outcome: "pass", rectificationRequired: false, electricianOnInstallDay: false })).toBe("all_clear");
    expect(piesaOutcomeKind({ outcome: "pass", rectificationRequired: true, electricianOnInstallDay: false })).toBe("repair_needed");
    expect(piesaOutcomeKind({ outcome: "fail", rectificationRequired: false, electricianOnInstallDay: false })).toBe("repair_needed");
    expect(piesaOutcomeKind({ outcome: "pass", rectificationRequired: true, electricianOnInstallDay: true })).toBe("electrician_on_install_day");
  });
  test("the page shows the date, the electrician + REC, the result, the official warning and the one tick", () => {
    const p = piesaConfirmPage(facts());
    expect(p.assessmentDate).toBe("24 October 2026");
    expect(p.electricianLine).toBe("Sam Spark (Spark Electrical Pty Ltd)");
    expect(p.outcome).toBe(OUTCOME_LABEL.all_clear);
    expect(p.warning).toBe("Anyone going into the ceiling before installation may cancel this assessment.");
    expect(p.tick).toBe("The assessment was completed on 24 October 2026");
    expect(p.declarations).toEqual(OFFICIAL_OWNER_DECLARATIONS);
    expect(p.confirmed).toBeNull();
    expect(piesaConfirmPage(facts({ electrician: { name: null, recName: null } })).electricianLine).toBe("Your electrician");
    expect(piesaConfirmPage(facts({ electrician: { name: null, recName: "Spark" } })).electricianLine).toBe("Spark");
  });
  test("after signing the page says Confirmed on <date>", () => {
    expect(piesaConfirmPage(facts({ confirmation: signed })).confirmed).toEqual({ name: "Helen Yang", signedOn: "25 October 2026" });
    expect(P6.confirmedOn("25 October 2026", "Helen Yang")).toBe("Confirmed on 25 October 2026 by Helen Yang. Your installer can now offer you install days.");
  });
  test("the four declarations are the official PIESA owner ticks, verbatim", () => {
    const official = OFFICIAL_ITEMS.piesa.filter((i) => /^o\.tick/.test(i.id)).map((i) => i.label);
    expect([...OFFICIAL_OWNER_DECLARATIONS]).toEqual(official);
  });
});

describe("validation", () => {
  const ok = { fullName: "Helen Yang", confirmed: true, signatureName: "Helen Yang", authority: "owner" as const };
  test("full name + tick + matching signature", () => expect(validateOwnerPiesaConfirmation(ok)).toEqual([]));
  test("each missing piece is named", () => {
    expect(validateOwnerPiesaConfirmation({ ...ok, fullName: "Helen", signatureName: "Helen" })).toEqual(["Type your full name (first and last)."]);
    expect(validateOwnerPiesaConfirmation({ ...ok, confirmed: false })).toEqual(["Tick to confirm the assessment was completed on that date."]);
    expect(validateOwnerPiesaConfirmation({ ...ok, signatureName: "H Yang" })).toEqual(["Your typed signature must match your full name."]);
    expect(validateOwnerPiesaConfirmation({ ...ok, signatureName: "  helen   yang " })).toEqual([]);
    expect(validateOwnerPiesaConfirmation({ ...ok, authority: "friend" as never })).toEqual(["Say whether you are the owner or signing for the owner."]);
  });
});

describe("the record", () => {
  test("append-only event details: name, signed_at, link code session, ip/ua hashes, the PIESA record + copy it confirms", () => {
    const d = buildPiesaOwnerConfirmation({ facts: facts(), name: " Helen  Yang ", authority: "authorised_representative", signedAt: "2026-10-25T01:00:00Z", codeId: "code-1", ipHash: "iphash", uaHash: "uahash" });
    expect(d).toEqual({ version: "piesa-owner-confirm-v1", piesa_record_id: REC, completed_date: "2026-10-24", signed_copy_id: "copy-1", snapshot_sha256: "abc", name: "Helen Yang", authority: "authorised_representative", signed_at: "2026-10-25T01:00:00Z", link_code_id: "code-1", ip_hash: "iphash", ua_hash: "uahash" });
    expect(piesaOwnerConfirmedSummary(d)).toBe("Owner confirmed the electrical safety check (PIESA of 2026-10-24) on their secure link: Helen Yang (signing for the owner)");
    expect(buildPiesaOwnerConfirmation({ facts: facts({ signedCopy: null }), name: "Helen Yang", authority: "owner", signedAt: "2026-10-25T01:00:00Z", codeId: "c", ipHash: null, uaHash: null })).toMatchObject({ signed_copy_id: null, snapshot_sha256: null, ip_hash: null });
    expect(PIESA_OWNER_CONFIRMED_EVENT).toBe("piesa_owner_confirmed");
  });
  test("a confirmation counts only for the PIESA record it names; a re-done PIESA needs a new one; latest wins", () => {
    const ev = (recordId: string, signed_at: string, name = "Helen Yang") => ({ details: { piesa_record_id: recordId, name, signed_at, authority: "owner", signed_copy_id: null } });
    expect(confirmationFromEvents([ev(REC, "2026-10-25T01:00:00Z")], REC)).toMatchObject({ name: "Helen Yang", piesaRecordId: REC, authority: "owner" });
    expect(confirmationFromEvents([ev("other", "2026-10-25T01:00:00Z")], REC)).toBeNull();
    expect(confirmationFromEvents([ev(REC, "2026-10-25T01:00:00Z"), ev(REC, "2026-10-26T01:00:00Z", "Helen Yang (again)")], REC)?.name).toBe("Helen Yang (again)");
    expect(confirmationFromEvents([{ details: null }, { details: { piesa_record_id: REC } }], REC)).toBeNull();
    expect(confirmationFromEvents([ev(REC, "2026-10-25T01:00:00Z")], null)).toBeNull();
  });
  test("the official form gets the typed name and the Melbourne date they signed", () => {
    expect(ownerConfirmationForForm(signed)).toEqual({ name: "Helen Yang", date: "2026-10-25" });
    expect(ownerConfirmationForForm({ ...signed, signedAt: "2026-10-24T14:30:00Z" })).toEqual({ name: "Helen Yang", date: "2026-10-25" }); // 1:30am Melbourne next day
    expect(ownerConfirmationForForm(null)).toBeNull();
    expect(melbourneDateOf("2026-10-24T13:59:00Z")).toBe("2026-10-25");
  });
});

describe("the gate", () => {
  test("blocked while the current PIESA is unconfirmed; nothing to confirm without a PIESA; another record's confirmation does not count", () => {
    expect(ownerPiesaConfirmationBlocker({ piesaRecordId: REC, confirmation: null })).toBe(OWNER_PIESA_CONFIRMATION_BLOCKER);
    expect(ownerPiesaConfirmationBlocker({ piesaRecordId: REC, confirmation: { piesaRecordId: "old" } })).toBe(OWNER_PIESA_CONFIRMATION_BLOCKER);
    expect(ownerPiesaConfirmationBlocker({ piesaRecordId: REC, confirmation: { piesaRecordId: REC } })).toBeNull();
    expect(ownerPiesaConfirmationBlocker({ piesaRecordId: null, confirmation: null })).toBeNull();
    expect(OWNER_PIESA_CONFIRMATION_BLOCKER).toContain("can't be booked");
  });
  test("installer job page Next line: waiting for the owner while unconfirmed, the normal offer panel once confirmed", () => {
    const base = { channel: "hivic_sourced", stage: "installation_scheduling", ownerFirstName: "Helen", formLinked: true, formCompleted: true, quoteLine: null, installTurn: "installer_to_offer" as const, installDeadline: "2026-11-23", installDaysLeft: 25, clearedOn: "2026-10-24", installFormComplete: false, installationRecorded: false, rebateSigned: false };
    const waiting = jobNext({ ...base, ownerPiesaConfirmed: false });
    expect(waiting.panel).toBe("waiting"); expect(waiting.title).toBe(OWNER_PIESA_CONFIRM_WAITING); expect(waiting.title).toBe("Waiting for the owner to confirm the safety check"); expect(waiting.yours).toBe(false);
    expect(waiting.sub).toContain("Install by"); expect(waiting.sub).toContain("We've asked Helen by email and text");
    expect(jobNext({ ...base, ownerPiesaConfirmed: true }).panel).toBe("offer_install_days");
    expect(jobNext({ ...base, ownerPiesaConfirmed: null }).panel).toBe("offer_install_days"); // not read / no PIESA record → unchanged behaviour
    expect(jobNext({ ...base, ownerPiesaConfirmed: false, installTurn: "owner_to_answer" }).title).toBe(OWNER_PIESA_CONFIRM_WAITING);
    expect(jobNext({ ...base, ownerPiesaConfirmed: false, installTurn: "booked", installBookedAt: "2026-11-02T22:00:00Z" }).panel).toBe("install_booked"); // already booked = already confirmed
  });
});

describe("reminders", () => {
  const T0 = "2026-10-24T03:30:00Z";
  const at = (days: number, plusMin = 1) => new Date(Date.parse(T0) + days * 86400_000 + plusMin * 60_000).toISOString();
  test("request day 0, reminders days 1 and 3, office alert day 5, in order, one per sweep", () => {
    expect(PIESA_CONFIRM_SCHEDULE.map((s) => [s.step, s.afterDays])).toEqual([["request", 0], ["reminder_1", 1], ["reminder_3", 3], ["office_alert_5", 5]]);
    expect(nextPiesaConfirmStep({ completedAt: T0, confirmedAt: null, done: [], now: at(0) })).toBe("request");
    expect(nextPiesaConfirmStep({ completedAt: T0, confirmedAt: null, done: ["request"], now: at(0, 30) })).toBeNull();
    expect(nextPiesaConfirmStep({ completedAt: T0, confirmedAt: null, done: ["request"], now: at(1) })).toBe("reminder_1");
    expect(nextPiesaConfirmStep({ completedAt: T0, confirmedAt: null, done: ["request", "reminder_1"], now: at(2) })).toBeNull();
    expect(nextPiesaConfirmStep({ completedAt: T0, confirmedAt: null, done: ["request", "reminder_1"], now: at(3) })).toBe("reminder_3");
    expect(nextPiesaConfirmStep({ completedAt: T0, confirmedAt: null, done: ["request", "reminder_1", "reminder_3"], now: at(5) })).toBe("office_alert_5");
    expect(nextPiesaConfirmStep({ completedAt: T0, confirmedAt: null, done: ["request", "reminder_1", "reminder_3", "office_alert_5"], now: at(9) })).toBeNull();
    // a late sweep catches up one step at a time, never skips the request
    expect(nextPiesaConfirmStep({ completedAt: T0, confirmedAt: null, done: [], now: at(6) })).toBe("request");
  });
  test("nothing once confirmed, nothing without a completion time", () => {
    expect(nextPiesaConfirmStep({ completedAt: T0, confirmedAt: "2026-10-24T05:00:00Z", done: [], now: at(1) })).toBeNull();
    expect(nextPiesaConfirmStep({ completedAt: null, confirmedAt: null, done: [], now: at(1) })).toBeNull();
    expect(nextPiesaConfirmStep({ completedAt: "not-a-date", confirmedAt: null, done: [], now: at(1) })).toBeNull();
  });
  test("keys and purposes name the PIESA record (a re-done PIESA = new request)", () => {
    expect(piesaConfirmKey("job", REC, "request")).toBe(`piesa-owner-confirm:v1:job:${REC}:request`);
    expect(piesaConfirmKey("job", REC, "reminder_1")).not.toBe(piesaConfirmKey("job", "other", "reminder_1"));
    expect(piesaConfirmPurpose("reminder_3")).toBe("piesa_owner_confirm_reminder_3");
    expect(PIESA_OWNER_CONFIRM_STEP_EVENT).toBe("piesa_owner_confirm_reminder"); expect(PIESA_OWNER_CONFIRM_OFFICE_ALERT_EVENT).toBe("piesa_owner_unconfirmed_5_days");
  });
  test("Needs me row on day 5: This week, Open job → PIESA card, and never above a Today item", () => {
    const f = { jobId: "1", jobNumber: "HV-1", surname: "Yang", suburb: "Glen Waverley", piesaOwnerUnsigned: { at: "2026-10-29T03:30:00Z", completedDate: "2026-10-24" } };
    const g = buildNeedsRows({ now: Date.parse("2026-10-29T04:00:00Z"), jobs: [f] });
    expect(g.week.map((r) => [r.kind, r.line, r.button])).toEqual([["piesa_owner_unsigned", "Owner hasn't confirmed the safety check of Sat, 24 Oct · 5 days · install can't be booked", { label: "Open job", to: "job", section: "piesa" }]]);
    expect(needsCandidates({ ...f, sendFailed: { at: "2026-10-29T03:00:00Z", text: "x" } }, Date.parse("2026-10-29T04:00:00Z"))[0]!.kind).toBe("send_failed");
    expect(needsCandidates({ ...f, piesaOwnerUnsigned: { at: "2026-10-29T03:30:00Z", completedDate: null } }, 0)[0]!.line).toBe("Owner hasn't confirmed the safety check · 5 days · install can't be booked");
  });
});

describe("wording (DRAFT until Jo approves)", () => {
  test("decision 311: flags are on and the SMS type is approved, window freshness", () => {
    expect(PIESA_OWNER_CONFIRM_EMAIL_APPROVED).toBe(true); expect(PIESA_OWNER_CONFIRM_SMS_APPROVED).toBe(true);
    expect(SMS_MESSAGE_TYPES[PIESA_OWNER_CONFIRM_SMS_TYPE]).toMatchObject({ audience: "owner", wordingApproved: true, quietHours: true });
    expect(SMS_FRESHNESS[PIESA_OWNER_CONFIRM_SMS_TYPE]).toEqual({ kind: "window" });
  });
  test("texts: under two segments, carry the link and the STOP line", () => {
    const link = "https://estimate.homeinsulationvictoria.com.au/my-job/tok";
    for (const t of [piesaOwnerConfirmRequestText(link), piesaOwnerConfirmReminderText(link)]) { expect(t).toContain(link); expect(t).toEndWith("Reply STOP to opt out."); expect(t.length).toBeLessThan(2 * 153 - 30); }
    expect(piesaOwnerConfirmRequestText(link)).toBe("Your electrical safety check is done. Please confirm it so we can book your install (takes a minute): https://estimate.homeinsulationvictoria.com.au/my-job/tok Reply STOP to opt out.");
    expect(piesaOwnerConfirmReminderText(link)).toBe("Your install can't be booked until you confirm your electrical safety check. It takes a minute: https://estimate.homeinsulationvictoria.com.au/my-job/tok Reply STOP to opt out.");
  });
  test("O71 email: kit shell, the date, the electrician, the result, the warning, one button; reminder variant", () => {
    const m = renderPiesaOwnerConfirmEmail({ ...O71_SAMPLE, reminder: false, unsubscribeUrl: "https://u/x" });
    expect(m.subject).toBe("Helen, please confirm your electrical safety check");
    expect(m.html.startsWith("<!doctype html")).toBe(true);
    expect(m.html).toContain(MAIL_LOGO_URL); expect(m.html).not.toContain("data:image");
    for (const s of ["<strong>24 October 2026</strong>", "Sam Spark (Spark Electrical Pty Ltd)", `>${OUTCOME_LABEL.all_clear}<`, `<strong>${CEILING_ENTRY_WARNING}</strong>`, ">Confirm my safety check<", `href="${O71_SAMPLE.confirmUrl}"`, "Unsubscribe"]) expect(m.html).toContain(s);
    expect(m.html).not.toMatch(/\bHI ?VIC!?(?![a-z_])/); expect(m.html).not.toMatch(/\$/);
    expect(m.text).toContain(FOOTER_TEXT); expect(m.text).toContain(`Confirm my safety check: ${O71_SAMPLE.confirmUrl}`); expect(m.text).toContain("Unsubscribe: https://u/x");
    const r = renderPiesaOwnerConfirmEmail({ ...O71_SAMPLE, reminder: true, test: true });
    expect(r.subject).toBe("Helen, your electrical safety check still needs your confirmation");
    expect(r.html).toContain("We can't book your install day until you've confirmed it."); expect(r.html).toContain("TEST — only sent to Jo");
    expect(renderPiesaOwnerConfirmEmail({ ...O71_SAMPLE, firstName: null, reminder: false }).subject).toBe("there, please confirm your electrical safety check");
  });
  test("the O71 files under docs/templates/owner are the renderer's output (run scripts/render-decision-296-drafts.ts after a wording change)", () => {
    for (const reminder of [false, true]) {
      const file = readFileSync(`docs/templates/owner/${reminder ? O71_FILES.reminder : O71_FILES.request}`, "utf8");
      expect(file).toBe(renderPiesaOwnerConfirmEmail({ ...O71_SAMPLE, reminder }).html);
    }
  });
  test("P6 mock-up carries the page wording byte for byte", () => {
    const html = readFileSync("docs/templates/owner/P6-piesa-confirm-page.html", "utf8").replace(/&rsaquo;/g, "›").replace(/&#10003;/g, "✓");
    for (const t of [P6.kicker, P6.title, P6.sub("24 October 2026"), P6.whyLead + "</b>" + P6.why, P6.formEyebrow, P6.factsTitle, P6.rows.date, P6.rows.electrician, P6.rows.result, P6.warningLead + "</b>" + CEILING_ENTRY_WARNING, P6.declareTitle, P6.declare, confirmTickText("24 October 2026"), P6.signLabel, P6.typeHere, P6.dateLine("25 October 2026"), P6.button, P6.lockHint, P6.afterNote, P6.confirmedTitle, P6.confirmedOn("25 October 2026", "Helen Yang"), OUTCOME_LABEL.all_clear, OWNER_PAGE_FOOTER]) expect(html).toContain(t);
  });
});

describe("official PIESA owner block (Section 4 / O) from the confirmation record only", () => {
  const short = () => shortAnswersFromEntries("piesa", entries("piesa", {
    jobRef: "HV-1003", address: "1 Test St, Melbourne VIC 3000", inspectionDate: "2026-10-03", lifeSupportPresent: "No", mainsSafe: "Yes", solarPresent: "No", ceilingSafe: "Yes",
    downlightsPresent: "No", appliancesPresent: "No", rectificationOutcome: "No repair work is needed", "b3.declaration": "Yes", electricianSignature: "sig",
    "b3.licence": "A12345", "b3.name": "Sam Spark", "b3.recName": "Sparky Pty Ltd", "b3.recNo": "REC12345", "b3.phone": "0400000000",
    // Legacy Mitti owner answers (the coordinator is removing these from the form): never read any more.
    ownerConfirm: "Yes", "o.name": "Mitti Typed", "o.date": "2026-10-03", ownerSignature: "mitti-sig",
  }));
  test("with the record: four ticks, the typed name and the signing date; no owner flag", () => {
    const r = expandPiesa(short(), { lifeSupportDeclared: "no", today: "2026-10-03", ownerConfirmation: { name: "Helen Yang", date: "2026-10-05" } });
    expect([1, 2, 3, 4].map((i) => r.answers[`o.tick${i}`])).toEqual([true, true, true, true]);
    expect(r.answers["o.name"]).toBe("Helen Yang"); expect(r.answers["o.date"]).toBe("2026-10-05");
    expect(r.flagged.filter((f) => /owner/i.test(f))).toEqual([]);
  });
  test("without the record: the owner block stays blank and is flagged — the Mitti answers are ignored", () => {
    for (const ctx of [{}, { ownerConfirmation: null }]) {
      const r = expandPiesa(short(), { lifeSupportDeclared: "no", today: "2026-10-03", ...ctx });
      expect(r.answers["o.name"]).toBeUndefined(); expect(r.answers["o.date"]).toBeUndefined(); expect(r.answers["o.tick1"]).toBeUndefined();
      expect(r.flagged).toContain(`${OWNER_CONFIRMATION_NOT_SIGNED_FLAG} (secure link).`);
      expect(r.flagged.some((f) => /Owner signature missing|Owner declaration: not confirmed/.test(f))).toBe(false);
    }
  });
});

// F08: a reassessment (re-done PIESA) is the PIESA the owner confirms — the same kinds as the 30-day anchor.
describe("ownerPiesaConfirmFacts: latest initial OR reassessment record", () => {
  type Row = Record<string, unknown>;
  const JOB = "00000000-0000-0000-0000-0000000000f8";
  const tables: Record<string, Row[]> = {
    piesa_records: [
      { id: "rec-initial", job_id: JOB, kind: "initial", outcome: "pass", completed_date: "2026-10-01", created_at: "2026-10-01T02:00:00Z", signed_off_by: "u1" },
      { id: "rec-post", job_id: JOB, kind: "post_rectification", outcome: "pass", completed_date: "2026-10-20", created_at: "2026-10-20T02:00:00Z", signed_off_by: "u1" },
      { id: "rec-reassess", job_id: JOB, kind: "reassessment", outcome: "pass", completed_date: "2026-11-05", created_at: "2026-11-05T02:00:00Z", signed_off_by: "u1" },
    ],
    workflow_events: [{ job_id: JOB, event_type: PIESA_OWNER_CONFIRMED_EVENT, created_at: "2026-10-02T00:00:00Z", details: { piesa_record_id: "rec-initial", name: "Helen Yang" } }],
  };
  const builder = (t: string) => {
    const f: ((r: Row) => boolean)[] = [];
    let one = false, count = false, desc = false, col: string | null = null, lim = Infinity;
    const b: Record<string, unknown> = {
      select: (_c?: string, o?: { count?: string }) => { count = o?.count === "exact"; return b; },
      eq: (c: string, v: unknown) => { f.push((r) => r[c] === v); return b; }, in: (c: string, v: unknown[]) => { f.push((r) => v.includes(r[c])); return b; },
      not: () => b, order: (c: string, o?: { ascending?: boolean }) => { col = c; desc = o?.ascending === false; return b; }, limit: (n: number) => { lim = n; return b; },
      maybeSingle: () => { one = true; return b; },
      then: (res: (v: unknown) => unknown) => {
        let out = (tables[t] ?? []).filter((r) => f.every((x) => x(r)));
        if (col) out = [...out].sort((a, z) => (String(a[col!]) < String(z[col!]) ? -1 : 1) * (desc ? -1 : 1));
        out = out.slice(0, lim);
        return Promise.resolve(count ? { data: null, count: out.length, error: null } : { data: one ? out[0] ?? null : out, error: null }).then(res);
      },
    };
    return b;
  };
  test("a newer reassessment wins over the initial PIESA; the old confirmation doesn't carry over; post-rectification is ignored", async () => {
    const { mock } = await import("bun:test");
    mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: builder } }));
    mock.module("../src/lib/official-forms.server", () => ({ currentCopy: async () => ({ copy: null }) }));
    const { ownerPiesaConfirmFacts, OWNER_CONFIRMED_PIESA_KINDS } = await import("../src/lib/piesa-owner-confirm.server");
    expect([...OWNER_CONFIRMED_PIESA_KINDS]).toEqual(["initial", "reassessment"]);
    const f = await ownerPiesaConfirmFacts(JOB);
    expect(f?.piesaRecordId).toBe("rec-reassess");
    expect(f?.completedDate).toBe("2026-11-05");
    expect(f?.confirmation).toBeNull(); // the re-done PIESA needs its own confirmation
  });
});
