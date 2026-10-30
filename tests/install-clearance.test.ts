// Decision 186 (Jo, 24 Oct 2026): the installer is told once, by text and email, the moment electrical clearance is
// valid — offer the owner 3 install days before the 30-day deadline. Pure wording/keys/SMS registry, then the server
// module against an in-memory backend with every sender mocked (sent once, idempotent, TEST path, not cleared → nothing,
// 7-day catch-up sweep). Run: bun test tests/install-clearance.test.ts
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  INSTALL_CLEARANCE_EMAIL_APPROVED, INSTALL_CLEARANCE_EVENT, INSTALL_CLEARANCE_SMS_TYPE, installClearanceDeadlineLabel, installClearanceKeys, installClearanceText, renderInstallClearanceEmail,
} from "../src/lib/install-clearance.core";
import { SMS_BRAND_PREFIX, SMS_FRESHNESS, SMS_MESSAGE_TYPES, brandSmsBody, smsBlocker, smsStaleReason } from "../src/lib/sms.core";
import { electricalClearance } from "../src/lib/allocation.core";
import { installWindowDeadline } from "../src/lib/install-days.core";

const LINK = "https://estimate.homeinsulationvictoria.com.au/field/job-real";

describe("wording (decision 186)", () => {
  test("text: the decision's sentence verbatim after the brand prefix, under two segments", () => {
    const t = installClearanceText({ jobNumber: "HV-3117", deadlineLabel: "23 November 2026", link: LINK });
    expect(t).toBe(`HV-3117 is cleared for install (safety check done). Offer the owner 3 install days by 23 November 2026: ${LINK}`);
    const branded = brandSmsBody(t);
    expect(branded).toBe(`Home Insulation Victoria: HV-3117 is cleared for install (safety check done). Offer the owner 3 install days by 23 November 2026: ${LINK}`);
    expect(branded.startsWith(SMS_BRAND_PREFIX)).toBe(true);
    expect(branded.length).toBeLessThanOrEqual(306);
    expect(/^[\x20-\x7E]+$/.test(branded)).toBe(true); // plain GSM characters only: no accidental unicode split
  });
  test("deadline: clearance date + 30 days as a Melbourne long date", () => {
    const c = electricalClearance({ piesaOutcome: "pass", piesaCompletedAt: "2026-10-24", rectificationRequired: false, rectificationQuoteAccepted: false, rectificationCompletedAt: null, sectionCSignedAt: null });
    expect(c.cleared).toBe(true);
    const deadline = installWindowDeadline(c.timingDate, null)!;
    expect(deadline).toBe("2026-11-23");
    expect(installClearanceDeadlineLabel(deadline)).toBe("23 November 2026");
    expect(installClearanceDeadlineLabel("2027-01-02")).toBe("2 January 2027");
    expect(installClearanceDeadlineLabel("2026-12-31T00:00:00.000Z")).toBe("31 December 2026");
  });
  test("email: headline, one line (PIESA or fixes variant), installer 30-day box with the deadline, Offer install days, AP footer, no prices", () => {
    const m = renderInstallClearanceEmail({ jobNumber: "HV-3117", ownerFirstName: "Helen", fixesSignedOff: false, deadlineLabel: "23 November 2026", jobUrl: LINK });
    expect(m.subject).toBe("HV-3117 is cleared for install – offer 3 install days by 23 November 2026");
    expect(m.html).toContain(">HV-3117 is cleared for install</div>");
    expect(m.html).toContain("The electrical safety check is done. Offer Helen three install days with arrival times from your job page.");
    expect(m.html).toContain("&#9200; The 30-day clock");
    expect(m.html).toContain("The install must happen within 30 days of this safety check (by 23 November 2026).");
    expect(m.html).toContain("So please offer install days as soon as you can.");
    expect(m.html).not.toContain("book your install day as soon as the installer offers times");
    expect(m.text).toContain("The 30-day clock: The install must happen within 30 days of this safety check (by 23 November 2026).");
    expect(m.html).toContain(">Offer install days<");
    expect(m.html).toContain("VEU Accredited Person A003654");
    expect(m.html).not.toMatch(/\$\d/);
    expect(m.html).not.toContain("Unsubscribe");
    expect(m.text).toContain(`Offer install days: ${LINK}`);
    const f = renderInstallClearanceEmail({ jobNumber: "HV-3117", ownerFirstName: null, fixesSignedOff: true, deadlineLabel: "23 November 2026", jobUrl: LINK, test: true });
    expect(f.html).toContain("The electrical safety check is done, and the fixes are signed off. Offer the owner three install days with arrival times from your job page.");
    expect(f.html).toContain("TEST — only sent to Jo");
  });
  test("flags: email approved; SMS type install_clearance is an approved partner type under quiet hours, 24h from the clearance", () => {
    expect(INSTALL_CLEARANCE_EMAIL_APPROVED).toBe(true);
    expect(INSTALL_CLEARANCE_SMS_TYPE).toBe("install_clearance");
    expect(SMS_MESSAGE_TYPES.install_clearance).toMatchObject({ audience: "partner", wordingApproved: true, quietHours: true });
    expect(SMS_FRESHNESS.install_clearance).toEqual({ kind: "event", maxAgeMinutes: 24 * 60 });
    expect(smsStaleReason("install_clearance", { at: "2026-10-26T01:00:00.000Z" }, "2026-10-26T02:00:00.000Z")).toBeNull();
    expect(smsStaleReason("install_clearance", { at: "2026-10-24T01:00:00.000Z" }, "2026-10-26T02:00:00.000Z")).toMatch(/Too late/);
    expect(smsStaleReason("install_clearance", { at: "2026-10-26T01:00:00.000Z", current: false }, "2026-10-26T02:00:00.000Z")).toMatch(/no longer current/);
    const base = { type: "install_clearance", to: "0412 345 678", commsEnabled: true, typeSwitchOn: true, senderConfigured: true, optedOut: false, consent: true, isTestRecord: false, nowIso: "2026-10-26T02:00:00.000Z" };
    expect(smsBlocker(base)).toBeNull();
    expect(smsBlocker({ ...base, consent: false })).toBe("Partner is not approved and active");
    expect(smsBlocker({ ...base, isTestRecord: true })).toBe("TEST record – use the test sender");
    expect(smsBlocker({ ...base, nowIso: "2026-10-26T11:30:00.000Z" })).toMatch(/quiet|8pm|7am/i); // 10:30pm Melbourne
  });
  test("one key pair per job + clearance timing date", () => {
    expect(installClearanceKeys("j1", "2026-10-24")).toEqual({ email: "install-clearance:v1:j1:2026-10-24:email", sms: "install-clearance:v1:j1:2026-10-24:sms" });
    expect(installClearanceKeys("j1", "2026-10-24T00:00:00.000Z").sms).toBe("install-clearance:v1:j1:2026-10-24:sms");
    expect(installClearanceKeys("j1", "2026-11-30").sms).not.toBe(installClearanceKeys("j1", "2026-10-24").sms);
  });
  test("wired at the two places clearance is established and in the 15-minute tick; the server never talks to a provider itself", () => {
    const pf = readFileSync("src/lib/portal.functions.ts", "utf8");
    // Complete PIESA: the office/electrician handler checks the caller, then runs the one body in piesa-complete.server.
    expect(pf.slice(pf.indexOf("export const completeAssessment"), pf.indexOf("export const recordPiesa"))).toContain('(await import("./piesa-complete.server")).completePiesaAssessment(data, context.userId)');
    const complete = readFileSync("src/lib/piesa-complete.server.ts", "utf8");
    const record = pf.slice(pf.indexOf("export const recordPiesa"), pf.indexOf("export const generateInstallerQuotes"));
    for (const s of [complete, record]) {
      const write = s.indexOf('from("piesa_records").insert(');
      const notify = s.indexOf("notifyInstallerClearance(data.jobId)");
      expect(write).toBeGreaterThan(0);
      expect(notify).toBeGreaterThan(write);
    }
    const tick = readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8");
    expect(tick).toContain('import("@/lib/install-clearance.server")');
    expect(tick).toContain("sweepInstallClearance()");
    const srv = readFileSync("src/lib/install-clearance.server.ts", "utf8");
    expect(srv).not.toMatch(/resendSend\(|fetch\(|twilio/i);
    for (const t of ["sendTestEmail", "sendTestSms", "sendOfficeEmail", "sendRealSms", INSTALL_CLEARANCE_EVENT]) expect(srv).toContain(t);
    // Never reachable from the auto-advance graph (tests/comms.test.ts rule).
    expect(readFileSync("src/lib/autoadvance.server.ts", "utf8")).not.toContain("install-clearance");
  });
});

// ---- in-memory backend for the server module ----
type Row = Record<string, any>;
const REAL_BIZ = { name: "Reinsulate", trading_name: null, email: "office@reinsulate.test", phone: "0400 111 222", onboarding_notes: null };
const TEST_BIZ = { name: "Test Installers", trading_name: null, email: "test@reinsulate.test", phone: "0400 333 444", onboarding_notes: "[TEST PARTNER]" };
const SAM = { full_name: "Sam Lee", email: "sam@reinsulate.test", phone: "0412 345 678" };
const db: Record<string, Row[]> = {
  workflow_events: [],
  jobs: [
    { id: "job-real", stage: "installation_scheduling", deleted_at: null, job_number: "HV-3117", source: "website", owners: { full_name: "Helen Yang" } },
    { id: "job-test", stage: "installation_scheduling", deleted_at: null, job_number: "HV-9001", source: "qa_test", owners: { full_name: "Test Owner" } },
    { id: "job-testpartner", stage: "installation_scheduling", deleted_at: null, job_number: "HV-9002", source: "website", owners: { full_name: "Ann Wu" } },
    { id: "job-pending", stage: "piesa_scheduled", deleted_at: null, job_number: "HV-3200", source: "website", owners: { full_name: "Bob Ng" } },
    { id: "job-old", stage: "installation_scheduling", deleted_at: null, job_number: "HV-3300", source: "website", owners: { full_name: "Cy Do" } },
    { id: "job-booked", stage: "installation_scheduling", deleted_at: null, job_number: "HV-3400", source: "website", owners: { full_name: "Di Fu" } },
    { id: "job-noinstaller", stage: "installation_scheduling", deleted_at: null, job_number: "HV-3500", source: "website", owners: { full_name: "Ed Go" } },
  ],
  job_assignments: [
    { id: "asg-real", job_id: "job-real", role: "installer", active: true, user_id: "u1", business_id: "b-real", profiles: SAM, businesses: REAL_BIZ },
    { id: "asg-test", job_id: "job-test", role: "installer", active: true, user_id: "u2", business_id: "b-real", profiles: SAM, businesses: REAL_BIZ },
    { id: "asg-tp", job_id: "job-testpartner", role: "installer", active: true, user_id: "u3", business_id: "b-test", profiles: { full_name: "Tess Test", email: "tess@test.test", phone: "0400 999 888" }, businesses: TEST_BIZ },
    { id: "asg-old", job_id: "job-old", role: "installer", active: true, user_id: "u1", business_id: "b-real", profiles: SAM, businesses: REAL_BIZ },
    { id: "asg-booked", job_id: "job-booked", role: "installer", active: true, user_id: "u1", business_id: "b-real", profiles: SAM, businesses: REAL_BIZ },
  ],
  piesa_records: [
    { job_id: "job-real", kind: "initial", is_current: true, created_at: "2026-10-24T03:10:00.000Z" },
    { job_id: "job-old", kind: "initial", is_current: true, created_at: "2026-10-10T03:10:00.000Z" },
  ],
};
function q(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  const api: any = {
    select: () => api, order: () => api, limit: () => api,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return api; },
    neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return api; },
    is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return api; },
    contains: (k: string, v: Row) => { filters.push((r) => Object.entries(v).every(([kk, vv]) => (r[k] ?? {})[kk] === vv)); return api; },
    maybeSingle: async () => ({ data: db[table]!.find((r) => filters.every((f) => f(r))) ?? null }),
    then: (res: any) => res({ data: db[table]!.filter((r) => filters.every((f) => f(r))) }),
  };
  return api;
}
const cleared = (timingDate: string, basis: "initial_piesa" | "section_c" = "initial_piesa") => ({ cleared: true, timingDate, basis, blocker: null, pendingConfirmation: "" });
const NOT_CLEARED = { cleared: false, timingDate: null, basis: null, blocker: "PIESA not completed and signed yet.", pendingConfirmation: "" };
const asg = (id: string) => ({ id, user_id: "u", business_id: "b" });
const contexts: Record<string, Row> = {
  "job-real": { clearance: cleared("2026-10-24"), deadline: "2026-11-23", asg: asg("asg-real"), booked: false },
  "job-test": { clearance: cleared("2026-10-24", "section_c"), deadline: "2026-11-23", asg: asg("asg-test"), booked: false },
  "job-testpartner": { clearance: cleared("2026-10-24"), deadline: "2026-11-23", asg: asg("asg-tp"), booked: false },
  "job-pending": { clearance: NOT_CLEARED, deadline: null, asg: asg("asg-x"), booked: false },
  "job-old": { clearance: cleared("2026-10-10"), deadline: "2026-11-09", asg: asg("asg-old"), booked: false },
  "job-booked": { clearance: cleared("2026-10-23"), deadline: "2026-11-22", asg: asg("asg-booked"), booked: true },
  "job-noinstaller": { clearance: cleared("2026-10-24"), deadline: "2026-11-23", asg: null, booked: false },
};
const calls = { testEmail: [] as string[], testSms: [] as string[], office: [] as string[], real: [] as string[] };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: q } }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: class WorkflowError extends Error {}, logEvent: async (job_id: string, _a: unknown, event_type: string, summary: string, details: unknown) => { db.workflow_events!.push({ job_id, event_type, summary, details }); } }));
// Jo 30 Oct 2026: "Pause all trade messages" off here (its own tests: trade-pause-*.test.ts).
let tradePaused: string | null = null;
mock.module("../src/lib/trade-pause.server", () => ({ tradeMessagesPausedNow: async () => tradePaused }));
mock.module("../src/lib/install-days.server", () => ({ installDayContext: async (jobId: string) => contexts[jobId] ?? { clearance: NOT_CLEARED, deadline: null, asg: null, booked: false } }));
mock.module("../src/lib/test-send.server", () => ({
  sendTestEmail: async (ctx: { jobSource: string | null; partnerIsTest: boolean; label: string }, to: string, subject: string) => { calls.testEmail.push(`${ctx.jobSource}:${ctx.partnerIsTest}:${ctx.label}:${to}:${subject}`); return { status: "sent", detail: "test" }; },
  sendTestSms: async (ctx: { jobSource: string | null; label: string }, to: string, body: string) => { calls.testSms.push(`${ctx.jobSource}:${ctx.label}:${to}:${body}`); return { status: "sent", detail: "test" }; },
}));
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: { recipient: string; to: string; subject: string; label: string; record: { businessId: string } }) => { calls.office.push(`${p.recipient}:${p.to}:${p.label}:${p.record.businessId}:${p.subject}`); return { status: "sent", detail: "ok" }; } }));
mock.module("../src/lib/sms.server", () => ({ sendRealSms: async (p: { type: string; idempotencyKey: string; to: string | null; body: string; businessId?: string; event?: { at: string; current?: boolean } }) => { calls.real.push(`${p.type}:${p.idempotencyKey}:${p.to}:${p.businessId}:${p.event?.at ?? "no-event"}:${p.event?.current}:${p.body}`); return { status: "sent", detail: "ok", sid: "x" }; } }));
const { notifyInstallerClearance, sweepInstallClearance } = await import("../src/lib/install-clearance.server");

const events = (jobId: string) => db.workflow_events!.filter((e) => e["job_id"] === jobId && e["event_type"] === INSTALL_CLEARANCE_EVENT);

describe("notifyInstallerClearance (server, mocked backend)", () => {
  test("real job: one event, one partner office email and one real text with the clearance as the trigger; a retry sends nothing", async () => {
    // Jo 30 Oct 2026: while "Pause all trade messages" is on it is held BEFORE the once-per-clearance event (nothing claimed).
    tradePaused = "Trade messages paused";
    expect(await notifyInstallerClearance("job-real", { clearedAt: "2026-10-24T03:10:00.000Z" })).toBe("held: Trade messages paused");
    expect(events("job-real").length).toBe(0);
    expect(calls.office.length + calls.real.length).toBe(0);
    tradePaused = null;
    const r = await notifyInstallerClearance("job-real", { clearedAt: "2026-10-24T03:10:00.000Z" });
    expect(r).toBe("installer email sent: ok; installer sms sent: ok");
    expect(calls.office).toEqual(["partner:sam@reinsulate.test:install_clearance:b-real:HV-3117 is cleared for install – offer 3 install days by 23 November 2026"]);
    expect(calls.real).toEqual([`install_clearance:install-clearance:v1:job-real:2026-10-24:sms:0412 345 678:b-real:2026-10-24T03:10:00.000Z:true:HV-3117 is cleared for install (safety check done). Offer the owner 3 install days by 23 November 2026: ${LINK}`]);
    expect(events("job-real").length).toBe(1);
    expect(events("job-real")[0]!["details"]).toMatchObject({ timing_date: "2026-10-24", basis: "initial_piesa", deadline: "2026-11-23", assignment_id: "asg-real" });
    expect(await notifyInstallerClearance("job-real")).toBe("already handled");
    expect(await notifyInstallerClearance("job-real", { clearedAt: "2026-10-24T05:00:00.000Z" })).toBe("already handled");
    expect(calls.office.length).toBe(1);
    expect(calls.real.length).toBe(1);
    expect(events("job-real").length).toBe(1);
    expect(calls.testEmail.length + calls.testSms.length).toBe(0);
  });
  test("qa_test job: test sender only (partner path), fixes wording for a Section C clearance, never the office or real senders", async () => {
    const before = { office: calls.office.length, real: calls.real.length };
    const r = await notifyInstallerClearance("job-test");
    expect(r).toBe("installer email sent: test; installer sms sent: test");
    expect(calls.testEmail).toEqual(["qa_test:true:install_clearance:2026-10-24:sam@reinsulate.test:HV-9001 is cleared for install – offer 3 install days by 23 November 2026"]);
    expect(calls.testSms).toEqual(["qa_test:install_clearance:2026-10-24:0412 345 678:HV-9001 is cleared for install (safety check done). Offer the owner 3 install days by 23 November 2026: https://estimate.homeinsulationvictoria.com.au/field/job-test"]);
    expect(events("job-test")[0]!["summary"]).toContain("fixes signed off");
    expect(calls.office.length).toBe(before.office);
    expect(calls.real.length).toBe(before.real);
    expect(await notifyInstallerClearance("job-test")).toBe("already handled");
    expect(calls.testEmail.length).toBe(1);
  });
  test("real job with a [TEST PARTNER] installer: test sender only", async () => {
    const before = { office: calls.office.length, real: calls.real.length, testEmail: calls.testEmail.length };
    await notifyInstallerClearance("job-testpartner");
    expect(calls.testEmail.length).toBe(before.testEmail + 1);
    expect(calls.testEmail.at(-1)).toContain("website:true:install_clearance:2026-10-24:tess@test.test:");
    expect(calls.office.length).toBe(before.office);
    expect(calls.real.length).toBe(before.real);
  });
  test("not cleared → nothing recorded or sent; no installer → nothing recorded (so a later assignment can still be told)", async () => {
    const before = { office: calls.office.length, real: calls.real.length, test: calls.testEmail.length + calls.testSms.length, events: db.workflow_events!.length };
    expect(await notifyInstallerClearance("job-pending")).toBe("not cleared");
    expect(await notifyInstallerClearance("job-noinstaller")).toBe("no installer assigned");
    expect(await notifyInstallerClearance("job-unknown")).toBe("not cleared");
    expect(calls.office.length).toBe(before.office);
    expect(calls.real.length).toBe(before.real);
    expect(calls.testEmail.length + calls.testSms.length).toBe(before.test);
    expect(db.workflow_events!.length).toBe(before.events);
  });
});

describe("sweepInstallClearance (15-minute catch-up)", () => {
  test("only installation-scheduling jobs cleared in the last 7 days with nothing booked and no notice; the clearance record time is the text's trigger; a second sweep sends nothing", async () => {
    // job-real/test/testpartner were already told above; job-old was cleared 14 days ago; job-booked has an install day; job-noinstaller has nobody to tell.
    const before = { office: calls.office.length, real: calls.real.length };
    const now = new Date("2026-10-24T06:00:00.000Z");
    const r1 = await sweepInstallClearance(now);
    expect(r1.checked).toBe(6); // the piesa_scheduled job is not in installation_scheduling
    expect(r1.notified).toBe(0);
    expect(calls.office.length).toBe(before.office);
    expect(calls.real.length).toBe(before.real);
    // A job cleared 3 days ago before this notice existed: told once, with the recorded clearance time as the trigger.
    db.jobs!.push({ id: "job-legacy", stage: "installation_scheduling", deleted_at: null, job_number: "HV-3600", source: "website", owners: { full_name: "Flo Hu" } });
    db.job_assignments!.push({ id: "asg-legacy", job_id: "job-legacy", role: "installer", active: true, user_id: "u1", business_id: "b-real", profiles: SAM, businesses: REAL_BIZ });
    db.piesa_records!.push({ job_id: "job-legacy", kind: "initial", is_current: false, created_at: "2026-10-01T00:00:00.000Z" }, { job_id: "job-legacy", kind: "post_rectification", is_current: true, created_at: "2026-10-21T04:00:00.000Z" });
    contexts["job-legacy"] = { clearance: cleared("2026-10-21", "section_c"), deadline: "2026-11-20", asg: asg("asg-legacy"), booked: false };
    const r2 = await sweepInstallClearance(now);
    expect(r2.notified).toBe(1);
    expect(calls.office.length).toBe(before.office + 1);
    expect(calls.real.length).toBe(before.real + 1);
    expect(calls.real.at(-1)).toContain("install-clearance:v1:job-legacy:2026-10-21:sms:0412 345 678:b-real:2026-10-21T04:00:00.000Z:true:HV-3600 is cleared for install");
    expect(events("job-legacy").length).toBe(1);
    const r3 = await sweepInstallClearance(now);
    expect(r3.notified).toBe(0);
    expect(calls.office.length).toBe(before.office + 1);
    expect(calls.real.length).toBe(before.real + 1);
    expect(events("job-old").length).toBe(0);
    expect(events("job-booked").length).toBe(0);
    expect(events("job-noinstaller").length).toBe(0);
  });
});
