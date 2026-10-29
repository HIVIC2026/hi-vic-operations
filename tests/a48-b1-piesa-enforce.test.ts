// A48 batch 1 task 2 (Jo 29 Oct 2026): a safety check (PIESA) that breaks the DEECA form's own rules stops the job. The
// electrician is messaged once per form version (text + email, exact approved wording; TEST jobs → test-send), the office
// gets one Needs me row, and a corrected form or a signed Section C clears it. "On site at the start" is valid only for
// Part 2–3 problems. The REAL piesa-rules-notice / piesa-complete / official-piesa-issue / workflow.server code runs
// against an in-memory database with every sender mocked. Own file: it mocks senders for the whole process.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { CEILING_PROBLEMS, FIXES_WORK_OPTIONS, MAINS_PROBLEMS, RECTIFICATION_OUTCOMES, SHORT_PIESA_FIELDS, shortAnswersFromEntries } from "../src/lib/official-short.core";
import { onsiteStartOnly } from "../src/lib/fixes-times.core";
import { SMS_FRESHNESS, SMS_MESSAGE_TYPES } from "../src/lib/sms.core";
import { needsCandidates } from "../src/lib/office-needs.core";
import { cardOf } from "../src/lib/needs-cards.core";

const J = "00000000-0000-4000-8000-0000000000c1", P = "00000000-0000-4000-8000-0000000000c2", E = "00000000-0000-4000-8000-0000000000c3", B = "00000000-0000-4000-8000-0000000000c4";
const R = {
  p2p3: "a switchboard or solar answer is No, so repairs are needed (or you must be on site at the start)",
  rect: "wiring, safety switch (RCD) or downlight problems must be repaired before the install",
  list: "the repairs list doesn't match the repairs answer",
  blank: "some required answers are blank",
  p7: "an appliance or hazard row is incomplete",
};
const message = (reason: string) => `Hi Sam, the safety check for HV-0701 at 12 Oak St, Box Hill can't go ahead yet: ${reason}. Please correct the form in Mitti or book the repairs. Thanks, Home Insulation Victoria`;

// ---- the electrician's A3 answers, as Mitti snapshot entries (label/value) ----
const entries = (values: Record<string, string>) => SHORT_PIESA_FIELDS.filter((f) => values[f.id!] !== undefined).map((f) => ({ label: f.label, value: values[f.id!]! }));
const clean = (): Record<string, string> => ({
  jobRef: "HV-0701", address: "12 Oak St, Box Hill VIC 3128", noPriceTalk: "Yes", inspectionDate: "2026-10-28", lifeSupportPresent: "No", mainsSafe: "Yes", solarPresent: "No", ceilingSafe: "Yes",
  downlightsPresent: "No", appliancesPresent: "No", rectificationNeeded: "No", "b3.licence": "L1", "b3.name": "Sam Spark", "b3.recName": "Spark Co", "b3.recNo": "R1", "b3.phone": "0422 222 222", "b3.declaration": "Yes", electricianSignature: "sig-1",
});
const switchNo = { mainsSafe: "No", mainsProblems: MAINS_PROBLEMS[3] };
const nonIc = { downlightsPresent: "Yes", downlightCount: "6", downlightsNonIc: "Yes", downlightsNonIcCount: "6" };
const onsite = { rectificationNeeded: "Yes", onsiteStartNeeded: "Yes", fixesPriceIncGst: "150" };
const fixesSigned = { rectificationComplete: "Yes", coesNumber: "CES-1", certDate: "2026-10-29", fixesSignedBy: "Sam Spark", fixesSignedOn: "2026-10-29" };
const short = (v: Record<string, string>) => shortAnswersFromEntries("piesa", entries(v));

describe("on site at the start is only for Part 2–3 problems (B1 option 3)", () => {
  test("Part 6 non-IC downlights + on site → rectification required, not on-site only", () => {
    const s = short({ ...clean(), ...switchNo, ...nonIc, ...onsite });
    expect(s["rectificationOutcome"]).toBe(RECTIFICATION_OUTCOMES[1]);
    expect(onsiteStartOnly(s)).toBe(false);
  });
  test("Part 4/5 ceiling problem + on site → rectification required", () => {
    const s = short({ ...clean(), ...switchNo, ceilingSafe: "No", ceilingProblems: CEILING_PROBLEMS[3], ...onsite });
    expect(s["rectificationOutcome"]).toBe(RECTIFICATION_OUTCOMES[1]);
    expect(onsiteStartOnly(s)).toBe(false);
  });
  test("Part 2–3 only + on site → still the on-site outcome", () => {
    const s = short({ ...clean(), ...switchNo, ...onsite });
    expect(s["rectificationOutcome"]).toBe(RECTIFICATION_OUTCOMES[2]);
    expect(onsiteStartOnly(s)).toBe(true);
  });
  test("downlights present but all IC rated + on site → still allowed", () => {
    const s = short({ ...clean(), ...switchNo, downlightsPresent: "Yes", downlightCount: "6", downlightsNonIc: "No", ...onsite });
    expect(s["rectificationOutcome"]).toBe(RECTIFICATION_OUTCOMES[2]);
    expect(onsiteStartOnly(s)).toBe(true);
  });
});

describe("pure wording, keys and rules", async () => {
  const c = await import("../src/lib/piesa-rules-notice.core");
  const { expandPiesa } = await import("../src/lib/official-expand.core");
  const official = (v: Record<string, string>) => expandPiesa(short(v), { lifeSupportDeclared: "no", today: "2026-10-29", ownerConfirmation: null, ownerFixesConfirmation: null }).answers;
  test("message is the approved wording; first two reasons joined with '; '", () => {
    expect(c.piesaRulesMessage({ name: "Sam", job: "HV-0701", address: "12 Oak St, Box Hill", reasons: [R.p2p3] })).toBe(message(R.p2p3));
    expect(c.piesaRulesMessage({ name: "Sam", job: "HV-0701", address: "12 Oak St, Box Hill", reasons: [R.p2p3, R.rect, R.blank] })).toBe(message(`${R.p2p3}; ${R.rect}`));
  });
  test("office row lists every reason", () => {
    expect(c.piesaRulesOfficeLine([R.p2p3, R.rect, R.blank])).toBe(`Safety check breaks the official rules — ${R.p2p3}; ${R.rect}; ${R.blank}`);
  });
  test("idempotency key per job + form version", () => {
    expect(c.piesaRulesKey(J, "aud-1:2026-10-29T01:00:00Z")).toBe(`piesa-rules:v1:${J}:aud-1:2026-10-29T01:00:00Z`);
    expect(c.piesaFormVersion("aud-1", null)).toBe("aud-1:completed");
  });
  test("a clean A3 is clear even though the owner block and Section C are filled later", () => {
    expect(c.piesaEnforcedRules(official(clean()))).toEqual([]);
    // A rectification A3 before the fixes visit: Section C blank by design.
    expect(c.piesaEnforcedRules(official({ ...clean(), ...nonIc, rectificationNeeded: "Yes", fixesWork: FIXES_WORK_OPTIONS[0], fixesDownlightCount: "6", fixesPriceIncGst: "900" }))).toEqual([]);
  });
  test("switchboard No + no repairs → P2P3 reason; an electrician's own blank answer still counts", () => {
    expect(c.piesaEnforcedRules(official({ ...clean(), ...switchNo })).map((r) => r.reason)).toEqual([R.p2p3]);
    const v = clean(); delete v["b3.licence"];
    expect(c.piesaEnforcedRules(official(v)).map((r) => r.reason)).toEqual([R.blank]);
  });
  test("signed Section C covers the repair rules", () => {
    const before = official({ ...clean(), ...switchNo, ...nonIc, ...onsite });
    expect(c.piesaEnforcedRules(before).length).toBeGreaterThan(0);
    expect(c.sectionCSigned(before)).toBe(false);
    const after = official({ ...clean(), ...switchNo, ...nonIc, ...onsite, ...fixesSigned });
    expect(c.sectionCSigned(after)).toBe(true);
    expect(c.piesaEnforcedRules(after)).toEqual([]);
  });
  test("SMS type: partner, approved, quiet hours, 24h event freshness", () => {
    expect(SMS_MESSAGE_TYPES.piesa_rules_failed).toMatchObject({ audience: "partner", wordingApproved: true, quietHours: true });
    expect(SMS_FRESHNESS.piesa_rules_failed).toEqual({ kind: "event", maxAgeMinutes: 24 * 60 });
  });
  test("Needs me: one Today row with the office line, on the 'Waiting on the owner or electrician' card", () => {
    const rows = needsCandidates({ jobId: J, jobNumber: "HV-0701", surname: "Lee", suburb: "Box Hill", piesaRulesFailed: { at: "2026-10-29T01:00:00Z", reasons: [R.p2p3, R.blank] } }, Date.parse("2026-10-29T02:00:00Z"));
    const row = rows.find((r) => r.kind === "piesa_rules_failed")!;
    expect(row).toMatchObject({ group: "today", line: `Safety check breaks the official rules — ${R.p2p3}; ${R.blank}`, button: { label: "Open job", to: "job", section: "piesa" } });
    expect(cardOf("piesa_rules_failed")).toBe("owner");
  });
  test("open state: newest failed vs cleared event", () => {
    const ev = (event_type: string, at: string, v: string, reasons: string[] = [R.p2p3]) => ({ event_type, created_at: at, details: { form_version: v, reasons } });
    expect(c.piesaRulesOpen([ev(c.PIESA_RULES_FAILED_EVENT, "2026-10-29T01:00:00Z", "a")])).toEqual({ at: "2026-10-29T01:00:00Z", formVersion: "a", reasons: [R.p2p3] });
    expect(c.piesaRulesOpen([ev(c.PIESA_RULES_FAILED_EVENT, "2026-10-29T01:00:00Z", "a"), ev(c.PIESA_RULES_CLEARED_EVENT, "2026-10-29T02:00:00Z", "b", [])])).toBeNull();
    expect(c.piesaRulesOpen([])).toBeNull();
  });
});

// ---- server: in-memory database, every sender mocked ----
const tables: Tables = {};
const calls = { testEmail: [] as string[], testSms: [] as string[], office: [] as string[], sms: [] as string[] };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => memoryPostgrest(tables).from(t), rpc: async () => ({ data: false, error: null }), storage: { from: () => ({ upload: async () => ({ error: { message: "no storage in test" } }) }) } } }));
mock.module("../src/lib/test-send.server", () => ({
  TEST_APP_BASE: "https://preview.test",
  sendTestEmail: async (ctx: { label: string }, to: string, subject: string, _h: string, text: string) => { calls.testEmail.push(`${ctx.label}|${to}|${subject}|${text}`); return { channel: "email", to, status: "sent", detail: "test" }; },
  sendTestSms: async (ctx: { label: string }, to: string, body: string) => { calls.testSms.push(`${ctx.label}|${to}|${body}`); return { channel: "sms", to, status: "sent", detail: "test" }; },
}));
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: { label: string; to: string; subject: string; text?: string; recipient: string }) => { calls.office.push(`${p.label}|${p.recipient}|${p.to}|${p.subject}|${p.text}`); return { channel: "email", to: p.to, status: "sent", detail: "ok" }; } }));
mock.module("../src/lib/sms.server", () => ({ sendRealSms: async (p: { type: string; idempotencyKey: string; to: string | null; body: string }) => { calls.sms.push(`${p.type}|${p.idempotencyKey}|${p.to}|${p.body}`); return { status: "sent", detail: "SM1", sid: "SM1" }; } }));
mock.module("../src/lib/requirements.server", () => ({ jobScope: async () => ({ scope: "full", label: "whole ceiling", measurementRow: null }), advanceSiteRequirements: async () => ({ advanced: false, scope: "full" }) }));

const notice = await import("../src/lib/piesa-rules-notice.server");
const core = await import("../src/lib/piesa-rules-notice.core");
const { completePiesaAssessment } = await import("../src/lib/piesa-complete.server");
const { issueOfficialPiesa } = await import("../src/lib/official-piesa-issue.server");
const { stageEntryBlockers } = await import("../src/lib/workflow.server");

const V1 = "2026-10-29T01:00:00.000Z", V2 = "2026-10-29T03:00:00.000Z";
function seed(answers: Record<string, string>, o: { source?: string; stage?: string; status?: string } = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(calls) as (keyof typeof calls)[]) calls[k].length = 0;
  Object.assign(tables, {
    jobs: [{ id: J, job_number: "HV-0701", source: o.source ?? "website", stage: o.stage ?? "piesa_scheduled", deleted_at: null, qa_archived_at: null, life_support_status: "no", life_support: false, property_id: P, business_unit: "hivic" }],
    properties: [{ id: P, address_line: "12 Oak St, Box Hill VIC 3128", suburb: "Box Hill" }],
    assessments: [{ id: "as-1", job_id: J, status: o.status ?? "in_progress", external_mitti_id: "aud-1", mitti_modified_at: V1, mitti_completed: true, mitti_raw_snapshot: entries(answers),
      switchboard_condition: "good", rcds_present: true, life_support_confirmed: false, piesa_outcome: "pass", assessed_on: "2026-10-28", no_rectification_confirmed: true }],
    job_assignments: [{ id: "asg-1", job_id: J, role: "electrician", active: true, user_id: E, business_id: B }],
    profiles: [{ id: E, full_name: "Sam Spark", email: "sam@spark.test", phone: "0422 222 222" }],
    businesses: [{ id: B, name: "Spark Co", email: "office@spark.test", phone: null, signer_mobile: null, onboarding_notes: null }],
    workflow_events: [], evidence_requirements: [], rectification_items: [], piesa_records: [], official_form_signed_copies: [],
  });
}
const resync = (answers: Record<string, string>, modifiedAt: string) => { Object.assign(tables["assessments"]![0]!, { mitti_raw_snapshot: entries(answers), mitti_modified_at: modifiedAt }); return notice.recheckPiesaRules(J, null); };
const events = (type: string) => tables["workflow_events"]!.filter((e) => e["event_type"] === type);
const blockedPiesa = () => ({ ...clean(), ...switchNo });

describe("a synced PIESA that breaks the rules stops the job", () => {
  beforeEach(() => seed(blockedPiesa()));
  test("piesaRulesBlockerFor names the office line", async () => {
    expect(await notice.piesaRulesBlockerFor(J)).toBe(`Safety check breaks the official rules — ${R.p2p3}`);
  });
  test("completePiesaAssessment refuses", async () => {
    await expect(completePiesaAssessment({ jobId: J }, E)).rejects.toThrow("Safety check breaks the official rules");
    expect(tables["assessments"]![0]!["status"]).toBe("in_progress");
  });
  test("issueOfficialPiesa refuses (held, nothing filed)", async () => {
    Object.assign(tables["assessments"]![0]!, { status: "complete" });
    const r = await issueOfficialPiesa(J, null);
    expect(r.status).toBe("held");
    expect(r.detail).toContain("Safety check breaks the official rules");
    expect(tables["official_form_signed_copies"]!.length).toBe(0);
  });
  test("stageEntryBlockers for piesa_complete and the install stages carry the blocker", async () => {
    for (const to of ["piesa_complete", "installation_scheduling", "installation_booked"] as const)
      expect(await stageEntryBlockers(J, to)).toContain(`Safety check breaks the official rules — ${R.p2p3}`);
  });
  test("one piesa_rules_failed event; electrician text + email with the exact message", async () => {
    await notice.recheckPiesaRules(J, null);
    const ev = events(core.PIESA_RULES_FAILED_EVENT);
    expect(ev.length).toBe(1);
    expect(ev[0]!["details"]).toMatchObject({ form_version: `aud-1:${V1}`, rules: ["P2P3-NO"], reasons: [R.p2p3] });
    expect(calls.sms).toEqual([`piesa_rules_failed|piesa-rules:v1:${J}:aud-1:${V1}|0422 222 222|${message(R.p2p3)}`]);
    expect(calls.office.length).toBe(1);
    expect(calls.office[0]).toContain("|partner|sam@spark.test|");
    expect(calls.office[0]).toContain(message(R.p2p3));
    expect(calls.testSms.length + calls.testEmail.length).toBe(0);
  });
  test("TEST job → test-send only", async () => {
    tables["jobs"]![0]!["source"] = "qa_test";
    await notice.recheckPiesaRules(J, null);
    expect(calls.sms.length + calls.office.length).toBe(0);
    expect(calls.testSms.length).toBe(1);
    expect(calls.testSms[0]).toContain(message(R.p2p3));
    expect(calls.testEmail.length).toBe(1);
    expect(calls.testEmail[0]).toContain(message(R.p2p3));
  });
  test("resync once: the same form version three times → 1 event, 1 send", async () => {
    for (let i = 0; i < 3; i++) await resync(blockedPiesa(), V1);
    expect(events(core.PIESA_RULES_FAILED_EVENT).length).toBe(1);
    expect(calls.sms.length).toBe(1);
    expect(calls.office.length).toBe(1);
  });
  test("corrected form clears: new version passes → blocker null, cleared event, no new send", async () => {
    await notice.recheckPiesaRules(J, null);
    await resync(clean(), V2);
    expect(await notice.piesaRulesBlockerFor(J)).toBeNull();
    expect(events(core.PIESA_RULES_CLEARED_EVENT).length).toBe(1);
    expect(core.piesaRulesOpen(tables["workflow_events"]!.map((e) => ({ event_type: String(e["event_type"]), created_at: String(e["created_at"]), details: e["details"] as Record<string, unknown> })))).toBeNull();
    expect(calls.sms.length).toBe(1);
    expect(calls.office.length).toBe(1);
    expect(await stageEntryBlockers(J, "installation_booked")).not.toContain(`Safety check breaks the official rules — ${R.p2p3}`);
  });
  test("a new version that still breaks the rules is a new event + one new send", async () => {
    await notice.recheckPiesaRules(J, null);
    await resync({ ...blockedPiesa(), appliancesPresent: "Yes" }, V2);
    await resync({ ...blockedPiesa(), appliancesPresent: "Yes" }, V2);
    expect(events(core.PIESA_RULES_FAILED_EVENT).length).toBe(2);
    expect(calls.sms.length).toBe(2);
  });
  test("signed Section C covering the items clears", async () => {
    await resync({ ...clean(), ...switchNo, ...nonIc, ...onsite }, V1);
    expect(await notice.piesaRulesBlockerFor(J)).not.toBeNull();
    expect(events(core.PIESA_RULES_FAILED_EVENT).length).toBe(1);
    // The A4 fixes form merges Section C into the stored answers (same form version), then re-checks.
    Object.assign(tables["assessments"]![0]!, { mitti_raw_snapshot: entries({ ...clean(), ...switchNo, ...nonIc, ...onsite, ...fixesSigned }) });
    await notice.recheckPiesaRules(J, null);
    expect(await notice.piesaRulesBlockerFor(J)).toBeNull();
    expect(events(core.PIESA_RULES_CLEARED_EVENT).length).toBe(1);
    expect(calls.sms.length).toBe(1);
  });
  test("several reasons: message has the first two, the event and office row all", async () => {
    await resync({ ...blockedPiesa(), appliancesPresent: "Yes", "b3.licence": "" }, V1);
    const reasons = (events(core.PIESA_RULES_FAILED_EVENT)[0]!["details"] as { reasons: string[] }).reasons;
    expect(reasons).toEqual([R.p2p3, R.p7, R.blank]);
    expect(calls.sms[0]).toContain(message(`${R.p2p3}; ${R.p7}`));
  });
});

describe("clean, manual and Part 2–3 on-site PIESAs are not blocked", () => {
  test("clean A3 → null, no event, no send", async () => {
    seed(clean());
    expect(await notice.piesaRulesBlockerFor(J)).toBeNull();
    await notice.recheckPiesaRules(J, null);
    expect(tables["workflow_events"]!.filter((e) => String(e["event_type"]).startsWith("piesa_rules")).length).toBe(0);
    expect(calls.sms.length + calls.office.length).toBe(0);
  });
  test("Part 2–3 only + on site at the start → allowed", async () => {
    seed({ ...clean(), ...switchNo, ...onsite });
    expect(await notice.piesaRulesBlockerFor(J)).toBeNull();
  });
  test("no Mitti PIESA (manual portal entry) → null", async () => {
    seed(clean());
    Object.assign(tables["assessments"]![0]!, { external_mitti_id: null, mitti_raw_snapshot: null });
    expect(await notice.piesaRulesBlockerFor(J)).toBeNull();
  });
});

describe("wiring (source)", () => {
  const src = (f: string) => readFileSync(`src/lib/${f}`, "utf8");
  test("the A3 sync re-checks the rules once the PIESA is marked complete in Mitti", () => {
    const m = src("mitti.server.ts");
    const sync = m.slice(m.indexOf("export async function syncMittiAssessment"));
    expect(sync).toMatch(/if \(plan\.completed\) await \(await import\("\.\/piesa-rules-notice\.server"\)\)\.recheckPiesaRules\(jobId, actorId\)/);
  });
  test("the A4 fixes form re-checks after Section C is merged", () => {
    const f = src("fixes-day.server.ts");
    expect(f.indexOf("recheckPiesaRules(jobId, actorId)")).toBeGreaterThan(f.indexOf("mergeFixesIntoPiesaSnapshot(snapshotOf"));
  });
  test("Needs me reads the failed / cleared events", () => {
    expect(src("office-needs.server.ts")).toContain("piesaRulesOpen(");
  });
});
