// Decision 376 (Jo 25 Oct 2026): the four moments F13 left record-only have messages wired through the existing senders:
// O74 (+ text) visit cancelled by the trade → owner; O75 signed Gate B paperwork copy → owner (PDFs attached); E14 (+ text)
// 24h coordination reminder → the electrician who has not offered safety check times; I71 (+ text) safety check booked →
// installer, planning only. Decision 384 (Jo 25 Oct 2026): all four APPROVED exactly as drafted, so real recipients now go
// through the existing guarded senders — customer_comms_enabled and each text type's sms_message_switches entry still gate
// actual delivery. Pure wording/flags/keys first, then each server module against an in-memory backend with every sender
// mocked: real recipients reach only the guarded senders (paused while customer comms are off; texts held while their
// switch is off), TEST → test-send, once only, one workflow event before any send.
// Run: bun test tests/decision-376-drafts.test.ts
import { describe, expect, mock, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { SMS_FRESHNESS, SMS_MESSAGE_TYPES, brandSmsBody, smsBlocker } from "../src/lib/sms.core";
import { VISIT_NEW_TIMES_APPROVED, VISIT_NEW_TIMES_EVENT, renderVisitNewTimesEmail, visitNewTimesKeys, visitNewTimesLink, visitNewTimesText } from "../src/lib/visit-new-times.core";
import { OWNER_PAPERWORK_COPY_APPROVED, OWNER_PAPERWORK_COPY_EVENT, PAPERWORK_COPY_QUIET_MINUTES, paperworkCopyBatch, paperworkCopyFilename, paperworkCopyKey, renderPaperworkCopyEmail } from "../src/lib/paperwork-copy-email.core";
import { PIESA_TIMES_REMINDER_APPROVED, coordinationReminderSends, piesaTimesReminderKeys, piesaTimesReminderText, renderPiesaTimesReminderEmail } from "../src/lib/piesa-times-reminder.core";
import { INSTALLER_PLANNING_NOTICE_APPROVED, INSTALLER_PLANNING_NOTIFIED_EVENT, installerPlanningKeys, installerPlanningText, renderInstallerPlanningEmail } from "../src/lib/installer-planning-notice.core";

const MY_JOB = "https://estimate.homeinsulationvictoria.com.au/my-job/tok";
const read = (f: string) => readFileSync(f, "utf8");

describe("decision 384: Jo approved the four decision 376 messages (delivery still gated by the switches)", () => {
  const gate = { to: "0412 345 678", senderConfigured: true, optedOut: false, consent: true, isTestRecord: false, nowIso: "2026-10-26T02:00:00.000Z" };
  test("every *_APPROVED flag is true and the three text types are approved, under quiet hours, 24h event freshness", () => {
    expect([VISIT_NEW_TIMES_APPROVED, OWNER_PAPERWORK_COPY_APPROVED, PIESA_TIMES_REMINDER_APPROVED, INSTALLER_PLANNING_NOTICE_APPROVED]).toEqual([true, true, true, true]);
    for (const [t, audience] of [["visit_new_times", "owner"], ["piesa_times_reminder", "partner"], ["installer_planning_notice", "partner"]] as const) {
      expect(SMS_MESSAGE_TYPES[t]).toMatchObject({ audience, wordingApproved: true, quietHours: true });
      expect(SMS_FRESHNESS[t]).toEqual({ kind: "event", maxAgeMinutes: 24 * 60 });
      // Approval alone sends nothing: customer comms and the type's own switch must both be on.
      expect(smsBlocker({ ...gate, type: t, commsEnabled: false, typeSwitchOn: true })).toBe("Customer communications are switched off");
      expect(smsBlocker({ ...gate, type: t, commsEnabled: true, typeSwitchOn: false })).toContain("texts are switched off");
      expect(smsBlocker({ ...gate, type: t, commsEnabled: true, typeSwitchOn: true })).toBeNull();
      expect(smsBlocker({ ...gate, type: t, commsEnabled: true, typeSwitchOn: true, nowIso: "2026-10-26T12:00:00.000Z" })).not.toBeNull(); // 11pm: quiet hours
      expect(smsBlocker({ ...gate, type: t, commsEnabled: true, typeSwitchOn: true, isTestRecord: true })).toBe("TEST record – use the test sender");
    }
  });
  test("approved designs are the email refresh MJML files (owner / electrician / installer)", () => {
    for (const f of ["owner_O74.mjml", "owner_O74b.mjml", "owner_O75.mjml", "electrician_E14.mjml", "installer_I71.mjml"]) {
      expect(existsSync(`docs/templates/mjml/${f}`)).toBe(true);
    }
    const log = read("docs/JO_DECISIONS_LOG.md");
    expect(log).toContain("376. **");
    expect(log).toContain("384. **");
  });
});

describe("O74 wording (trade cancelled the visit)", () => {
  const was = "2026-10-28T22:30:00.000Z"; // Thursday 29 October, 9:30am Melbourne
  test("owner picks: subject, struck-through old time, Choose new times to the visit's screen; text with STOP", () => {
    const link = visitNewTimesLink(MY_JOB, "assessment");
    expect(link).toBe(`${MY_JOB}?screen=book`);
    expect(visitNewTimesLink(`${MY_JOB}?x=1`, "ready_check")).toBe(MY_JOB);
    const m = renderVisitNewTimesEmail({ kind: "assessment", wasIso: was, ownerPicks: true, link, firstName: "Helen Yang", unsubscribeUrl: "https://u" });
    expect(m.subject).toBe("Your electrical safety check needs a new time");
    expect(m.html).toContain("Sorry, the electrician can't make your electrical safety check on Thursday 29 October any more.");
    expect(m.html).toContain("text-decoration:line-through\">Thursday 29 October, 9:30am");
    expect(m.html).toContain("Choose new times</a>");
    expect(m.text).toContain(`Choose new times: ${link}`);
    expect(m.text).toContain("Unsubscribe: https://u");
    const t = visitNewTimesText({ kind: "assessment", wasIso: was, ownerPicks: true, link });
    expect(brandSmsBody(t)).toBe(`Home Insulation Victoria: Sorry, the electrician can't make your electrical safety check on Thursday 29 October any more. Please choose new times here: ${link} Reply STOP to opt out.`);
  });
  test("trade offers: 'you don't need to do anything' variant, See my job", () => {
    const m = renderVisitNewTimesEmail({ kind: "installation", wasIso: was, ownerPicks: false, link: MY_JOB, firstName: null, unsubscribeUrl: null, test: true });
    expect(m.subject).toBe("Your install day is moving");
    expect(m.text).toContain("You don't need to do anything. Your installer will offer you new install days soon, and we'll send you a link to choose one.");
    expect(m.html).toContain("<strong>You don't need to do anything.</strong>");
    expect(m.html).toContain("See my job</a>");
    expect(m.html).toContain("TEST — only sent to Jo");
    expect(visitNewTimesText({ kind: "ready_check", wasIso: was, ownerPicks: false, link: MY_JOB })).toContain("You don't need to do anything – we'll send you new times soon.");
    expect(visitNewTimesKeys("j", "b")).toEqual({ email: "visit-new-times:v1:j:b:email", sms: "visit-new-times:v1:j:b:sms" });
  });
});

describe("O75 wording and batching (signed paperwork copy)", () => {
  const sig = (id: string, at: string, extra: Partial<{ gate: string; method: string }> = {}) => ({ id, gate: "B", method: "link_code", signed_at: at, doc_key: "payment_terms", title: "Payment", copy_path: `j/${id}.pdf`, ...extra });
  const now = new Date("2026-10-25T10:00:00.000Z");
  test("waits until the sitting is over, then batches every uncopied owner Gate B signature; office items and old ones never", () => {
    const s = [sig("a", "2026-10-25T09:40:00.000Z"), sig("b", "2026-10-25T09:45:00.000Z"), sig("office", "2026-10-25T09:41:00.000Z", { method: "office" }), sig("gateA", "2026-10-25T09:41:00.000Z", { gate: "A" }), sig("old", "2026-10-20T09:00:00.000Z")];
    expect(paperworkCopyBatch({ signatures: s, copiedIds: new Set(), now }).map((x) => x.id)).toEqual(["a", "b"]);
    expect(paperworkCopyBatch({ signatures: [...s, sig("c", "2026-10-25T09:55:00.000Z")], copiedIds: new Set(), now })).toEqual([]); // still signing (< 10 min)
    expect(PAPERWORK_COPY_QUIET_MINUTES).toBe(10);
    expect(paperworkCopyBatch({ signatures: s, copiedIds: new Set(["a", "b"]), now })).toEqual([]);
    expect(paperworkCopyKey("j", ["b", "a"])).toBe("owner-paperwork-copy:v1:j:a");
    expect(paperworkCopyFilename("Your rebate (VEEC assignment)", "HV-3117")).toBe("Signed - Your rebate (VEEC assignment) - HV-3117.pdf");
  });
  test("email lists what was signed; only claims attachments when attached", () => {
    const m = renderPaperworkCopyEmail({ firstName: "Helen", address: "12 Smith St, Frankston", titles: ["The agreement", "Payment"], attached: true, myJobUrl: MY_JOB, unsubscribeUrl: null });
    expect(m.subject).toBe("Your signed paperwork");
    expect(m.text).toContain("Hi Helen, thanks for signing.");
    expect(m.text).toContain("Here's a copy of what you signed for the ceiling insulation at 12 Smith St, Frankston, for your records.");
    expect(m.text).toContain("- The agreement\n- Payment");
    // O75 design: no VEEC jargon for owners in the list (the stored title and filename stay).
    const r = renderPaperworkCopyEmail({ firstName: "Helen", address: "x", titles: ["Your rebate (VEEC assignment)"], attached: true, myJobUrl: null, unsubscribeUrl: null });
    expect(r.text).toContain("- Your rebate form");
    expect(r.html).not.toContain("VEEC");
    expect(m.text).toContain("The signed copies are attached as PDFs.");
    expect(renderPaperworkCopyEmail({ firstName: null, address: "", titles: ["Payment"], attached: false, myJobUrl: null, unsubscribeUrl: null }).text).not.toContain("attached");
  });
});

describe("E14 / I71 wording", () => {
  test("E14: only the safety check point sends; the electrician is asked to offer 3 times; no prices", () => {
    expect(coordinationReminderSends("piesa")).toBe(true);
    for (const k of ["ready_check", "installation", "rectification"]) expect(coordinationReminderSends(k)).toBe(false);
    const f = { jobNumber: "HV-3117", address: "12 Smith St, Frankston", link: "https://x/field/j" };
    expect(piesaTimesReminderText(f)).toBe("Reminder: HV-3117 at 12 Smith St, Frankston still needs safety check times. Please offer the owner 3 times on your job page: https://x/field/j");
    const m = renderPiesaTimesReminderEmail({ ...f, firstName: "Sam" });
    expect(m.subject).toBe("HV-3117: please offer the owner 3 safety check times");
    expect(m.html).toContain(">Offer 3 times<");
    expect(m.html).not.toMatch(/\$\d/);
    expect(piesaTimesReminderKeys("a1").sms).toBe("piesa-times-reminder:v1:a1:sms");
  });
  test("I71: date, planning only, don't book yet; one key per assignment + PIESA instant", () => {
    const f = { jobNumber: "HV-3117", address: "12 Smith St, Frankston", piesaStartIso: "2026-10-28T22:30:00.000Z", link: "https://x/field/j" };
    expect(installerPlanningText(f)).toBe("HV-3117 (12 Smith St, Frankston): the safety check is booked for Thursday 29 October. For planning only – please don't book the install yet. We'll text you when it's cleared: https://x/field/j");
    const m = renderInstallerPlanningEmail({ ...f, ownerFirstName: "Helen" });
    expect(m.subject).toBe("HV-3117: safety check booked for Thursday 29 October");
    expect(m.text).toContain("Safety check: Thursday 29 October, arriving 9:30am");
    expect(m.text).toContain("Please don't book the install yet.");
    expect(installerPlanningKeys("a1", "2026-10-28T22:30:00.000Z").base).toBe(installerPlanningKeys("a1", "2026-10-28T22:30:00Z").base);
  });
  test("wired at the four moments (no outbox rows come back)", () => {
    const ve = read("src/lib/visit-events.server.ts");
    const cancel = ve.slice(ve.indexOf("export async function tradeCancelVisit"), ve.indexOf("export async function sweepTradeNoShows"));
    expect(cancel.indexOf("notifyOwnerVisitNewTimes(")).toBeGreaterThan(cancel.indexOf("await reopen("));
    expect(ve.slice(ve.indexOf("async function ownerMiss"), ve.indexOf("export async function tradeArrived"))).not.toContain("notifyOwnerVisitNewTimes");
    expect(read("src/routes/api/public/hooks/allocation-tick.ts")).toContain("sweepOwnerPaperworkCopies()");
    const alloc = read("src/lib/allocation.server.ts");
    expect(alloc.indexOf("remindTradeToOfferTimes(")).toBeGreaterThan(alloc.indexOf('"coordination_reminder", `24h'));
    const bk = read("src/lib/booking.server.ts");
    expect(bk.indexOf("notifyInstallerPlanning(")).toBeGreaterThan(bk.indexOf('"installer_planning_notice", INSTALLER_PLANNING_NOTICE'));
    for (const f of ["src/lib/visit-events.server.ts", "src/lib/owner-gates.server.ts", "src/lib/allocation.server.ts", "src/lib/booking.server.ts"]) expect(read(f)).not.toContain("enqueue_external_action");
  });
});

// ---- in-memory backend ----
type Row = Record<string, any>;
const db: Record<string, Row[]> = {
  workflow_events: [], bookings: [], appointment_proposals: [],
  jobs: [
    { id: "job-real", owner_id: "o1", source: "website", deleted_at: null, job_number: "HV-3117", stage: "piesa_and_install_window_pending", owners: { full_name: "Helen Yang" }, properties: { address_line: "12 Smith St", suburb: "Frankston", postcode: "3199" } },
    { id: "job-test", owner_id: "o2", source: "qa_test", deleted_at: null, job_number: "HV-9001", stage: "piesa_and_install_window_pending", owners: { full_name: "Test Owner" }, properties: { address_line: "1 Test St", suburb: "Testville", postcode: "3000" } },
  ],
  owners: [{ id: "o1", full_name: "Helen Yang", email: "helen@example.com", phone: "0412 000 111" }, { id: "o2", full_name: "Test Owner", email: "jo@test.test", phone: "0400 000 000" }],
  job_assignments: [
    { id: "inst-real", job_id: "job-real", role: "installer", active: true, business_id: "b-i", profiles: { full_name: "Ian Inst", email: "ian@inst.test", phone: "0411 111 111" }, businesses: { in_house: false, name: "Inst Co", email: "office@inst.test", phone: null, signer_mobile: null, onboarding_notes: null } },
    { id: "inst-test", job_id: "job-test", role: "installer", active: true, business_id: "b-i", profiles: { full_name: "Ian Inst", email: "ian@inst.test", phone: "0411 111 111" }, businesses: { in_house: false, name: "Inst Co", email: "office@inst.test", phone: null, signer_mobile: null, onboarding_notes: null } },
    { id: "el-real", job_id: "job-real", role: "electrician", active: true, booking_confirmed_at: null, business_id: "b-e", profiles: { full_name: "Sam Spark", email: "sam@spark.test", phone: "0422 222 222" }, businesses: { name: "Spark", email: "office@spark.test", phone: null, signer_mobile: null, onboarding_notes: null } },
    { id: "el-test", job_id: "job-test", role: "electrician", active: true, booking_confirmed_at: null, business_id: "b-e", profiles: { full_name: "Sam Spark", email: "sam@spark.test", phone: "0422 222 222" }, businesses: { name: "Spark", email: "office@spark.test", phone: null, signer_mobile: null, onboarding_notes: null } },
  ],
  owner_gate_signatures: [
    { id: "s1", job_id: "job-real", gate: "B", method: "link_code", signed_at: "2026-10-25T09:40:00.000Z", doc_key: "quote_acceptance", copy_path: "job-real/owner-paperwork/s1.pdf" },
    { id: "s2", job_id: "job-real", gate: "B", method: "link_code", signed_at: "2026-10-25T09:42:00.000Z", doc_key: "payment_terms", copy_path: "job-real/owner-paperwork/s2.pdf" },
    { id: "s3", job_id: "job-real", gate: "B", method: "office", signed_at: "2026-10-25T09:43:00.000Z", doc_key: "landlord_consent", copy_path: "job-real/owner-paperwork/s3.pdf" },
    { id: "t1", job_id: "job-test", gate: "B", method: "link_code", signed_at: "2026-10-25T09:40:00.000Z", doc_key: "payment_terms", copy_path: "job-test/owner-paperwork/t1.pdf" },
  ],
};
function q(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let head = false;
  const rows = () => (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
  const api: any = {
    select: (_c?: string, o?: { head?: boolean }) => { head = !!o?.head; return api; }, order: () => api, limit: () => api, range: () => api,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return api; },
    neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return api; },
    in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return api; },
    is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return api; },
    gte: (k: string, v: string) => { filters.push((r) => String(r[k]) >= v); return api; },
    contains: (k: string, v: Row) => { filters.push((r) => Object.entries(v).every(([kk, vv]) => (r[k] ?? {})[kk] === vv)); return api; },
    maybeSingle: async () => ({ data: rows()[0] ?? null }),
    then: (res: any) => res(head ? { count: rows().length, data: null } : { data: rows() }),
  };
  return api;
}
const calls = { testEmail: [] as string[], testSms: [] as string[], owner: [] as string[], office: [] as string[], sms: [] as string[] };
/** The live gates the real senders read (workflow_settings.customer_comms_enabled + sms_message_switches). */
const gates = { comms: false, switches: {} as Record<string, boolean> };
const storage = { from: () => ({ download: async (p: string) => ({ data: new Blob([`%PDF ${p}`]), error: null }) }) };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: q, storage } }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: class WorkflowError extends Error {}, logEvent: async (job_id: string, _a: unknown, event_type: string, summary: string, details: unknown) => { db.workflow_events!.push({ job_id, event_type, summary, details, created_at: new Date().toISOString() }); } }));
mock.module("../src/lib/test-send.server", () => ({
  TEST_APP_BASE: "https://preview.test",
  sendTestEmail: async (ctx: { label: string }, to: string, subject: string, _h: string, _t: string, opts?: { attachments?: unknown[] }) => { calls.testEmail.push(`${ctx.label}:${to}:${subject}:${opts?.attachments?.length ?? 0}`); return { status: "sent", detail: "test" }; },
  sendTestSms: async (ctx: { label: string }, to: string, body: string) => { calls.testSms.push(`${ctx.label}:${to}:${body}`); return { status: "sent", detail: "test" }; },
}));
mock.module("../src/lib/owner-email-send.server", () => ({ sendGuardedOwnerEmail: async (p: { purpose: string; key: string }) => { calls.owner.push(`${p.purpose}:${p.key}`); return "sent"; } }));
// sendOfficeEmail pauses partner email while customer comms are off (Jo 24 Oct).
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: { label: string; to: string }) => { calls.office.push(`${p.label}:${p.to}`); return gates.comms ? { status: "sent", detail: "ok" } : { status: "held", detail: "customer communications are off" }; } }));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => { if (!gates.comms) throw new Error("Customer communications are switched off"); }, customerCommsEnabled: async () => gates.comms }));
// The one real text sender: the same pure gate it uses, with the live switch states above.
mock.module("../src/lib/sms.server", () => ({ sendRealSms: async (p: { type: string; idempotencyKey: string; to: string | null; event?: { current?: boolean } }) => {
  calls.sms.push(`${p.type}:${p.idempotencyKey}:${p.to}:${p.event?.current}`);
  const blocked = smsBlocker({ type: p.type, to: p.to ?? "", commsEnabled: gates.comms, typeSwitchOn: gates.switches[p.type] === true, senderConfigured: true, optedOut: false, consent: true, isTestRecord: false, nowIso: "2026-10-26T02:00:00.000Z" });
  return blocked ? { status: "blocked", detail: blocked, sid: null } : { status: "sent", detail: "SM1", sid: "SM1" };
} }));
mock.module("../src/lib/veec-copy-email.server", () => ({ ownerMyJobLink: async (jobId: string) => `${MY_JOB}-${jobId}` }));
mock.module("../src/lib/readycheck-booking.server", () => ({ ownerReadyCheckWindowState: async () => ({ canPick: true }) }));
mock.module("../src/lib/allocation.server", () => ({ ownerPiesaWindowState: async () => ({ canPick: false }) }));
mock.module("../src/lib/visit-events.server", () => ({ currentBooking: async () => null }));

const { notifyOwnerVisitNewTimes } = await import("../src/lib/visit-new-times.server");
const { sendOwnerPaperworkCopy } = await import("../src/lib/paperwork-copy-email.server");
const { remindTradeToOfferTimes } = await import("../src/lib/piesa-times-reminder.server");
const { notifyInstallerPlanning } = await import("../src/lib/installer-planning-notice.server");
const ev = (job: string, type: string) => db.workflow_events!.filter((e) => e["job_id"] === job && e["event_type"] === type);
const reset = (g: { comms?: boolean; switches?: Record<string, boolean> } = {}) => { for (const k of Object.keys(calls) as (keyof typeof calls)[]) calls[k].length = 0; gates.comms = g.comms ?? false; gates.switches = g.switches ?? {}; };

describe("O74 server (mocked)", () => {
  test("no visit_times_reopened → nothing; office-arranged fixes visit → nothing", async () => {
    reset();
    expect(await notifyOwnerVisitNewTimes({ jobId: "job-real", bookingId: "bk1", kind: "assessment", wasIso: "2026-10-28T22:30:00.000Z" })).toBe("skipped — times not reopened");
    expect(await notifyOwnerVisitNewTimes({ jobId: "job-real", bookingId: "bk1", kind: "rectification", wasIso: "2026-10-28T22:30:00.000Z" })).toContain("office");
    expect(ev("job-real", VISIT_NEW_TIMES_EVENT).length).toBe(0);
  });
  test("real owner while customer comms are off: event first, email paused by the guard, text blocked by the real sender; once only", async () => {
    reset();
    db.workflow_events!.push({ job_id: "job-real", event_type: "visit_times_reopened", details: { booking_id: "bk1", kind: "assessment" }, created_at: new Date().toISOString() });
    const r = await notifyOwnerVisitNewTimes({ jobId: "job-real", bookingId: "bk1", kind: "assessment", wasIso: "2026-10-28T22:30:00.000Z" });
    expect(r).toBe("email not sent — Customer communications are switched off; sms blocked: Customer communications are switched off");
    expect(ev("job-real", VISIT_NEW_TIMES_EVENT).map((e) => e["details"])).toEqual([{ booking_id: "bk1", kind: "assessment", owner_picks: false, was: "2026-10-28T22:30:00.000Z" }]);
    expect(calls.owner).toEqual([]);
    expect(calls.sms).toEqual(["visit_new_times:visit-new-times:v1:job-real:bk1:sms:0412 000 111:true"]);
    expect(calls.testEmail.length + calls.testSms.length).toBe(0);
    expect(await notifyOwnerVisitNewTimes({ jobId: "job-real", bookingId: "bk1", kind: "assessment", wasIso: "2026-10-28T22:30:00.000Z" })).toBe("already handled");
    expect(calls.sms.length).toBe(1);
  });
  test("real owner with customer comms on: email through the guarded owner sender; text waits for its own switch, then sends", async () => {
    reset({ comms: true });
    db.workflow_events!.push({ job_id: "job-real", event_type: "visit_times_reopened", details: { booking_id: "bk2", kind: "installation" }, created_at: new Date().toISOString() });
    const r = await notifyOwnerVisitNewTimes({ jobId: "job-real", bookingId: "bk2", kind: "installation", wasIso: "2026-11-03T21:00:00.000Z" });
    expect(r).toBe(`email sent; sms blocked: "${SMS_MESSAGE_TYPES.visit_new_times.label}" texts are switched off`);
    expect(calls.owner).toEqual(["visit_new_times:visit-new-times:v1:job-real:bk2:email"]);
    reset({ comms: true, switches: { visit_new_times: true } });
    db.workflow_events!.push({ job_id: "job-real", event_type: "visit_times_reopened", details: { booking_id: "bk3", kind: "installation" }, created_at: new Date().toISOString() });
    expect(await notifyOwnerVisitNewTimes({ jobId: "job-real", bookingId: "bk3", kind: "installation", wasIso: "2026-11-03T21:00:00.000Z" })).toBe("email sent; sms sent: SM1");
    expect(calls.testEmail.length + calls.testSms.length).toBe(0);
  });
  test("TEST job → test-send (email + text), never the real senders", async () => {
    reset();
    db.workflow_events!.push({ job_id: "job-test", event_type: "visit_times_reopened", details: { booking_id: "bk9", kind: "ready_check" }, created_at: new Date().toISOString() });
    const r = await notifyOwnerVisitNewTimes({ jobId: "job-test", bookingId: "bk9", kind: "ready_check", wasIso: "2026-10-28T22:30:00.000Z" });
    expect(r).toBe("email sent: test; sms sent: test");
    expect(calls.testEmail).toEqual(["visit_new_times:bk9:jo@test.test:Your Ready Check visit needs a new time:0"]);
    expect(calls.testSms[0]).toContain(`Please choose new times here: ${MY_JOB}-job-test`);
    expect(calls.owner.length + calls.sms.length).toBe(0);
  });
});

describe("O75 server (mocked)", () => {
  const now = new Date("2026-10-25T10:00:00.000Z");
  test("real owner while customer comms are off: one batch event (owner items only) before any send, email paused; never copied twice", async () => {
    reset();
    expect(await sendOwnerPaperworkCopy("job-real", now)).toBe("not sent — Customer communications are switched off");
    expect(ev("job-real", OWNER_PAPERWORK_COPY_EVENT).map((e) => e["details"])).toEqual([{ signature_ids: ["s1", "s2"], doc_keys: ["quote_acceptance", "payment_terms"] }]);
    expect(calls.owner).toEqual([]);
    expect(await sendOwnerPaperworkCopy("job-real", now)).toBe("nothing to copy");
    expect(ev("job-real", OWNER_PAPERWORK_COPY_EVENT).length).toBe(1);
  });
  test("real owner with customer comms on: ONE email through the guarded owner sender with both PDFs", async () => {
    reset({ comms: true });
    db.owner_gate_signatures!.push(
      { id: "s4", job_id: "job-real", gate: "B", method: "link_code", signed_at: "2026-10-25T09:44:00.000Z", doc_key: "quote_acceptance", copy_path: "job-real/owner-paperwork/s4.pdf" },
      { id: "s5", job_id: "job-real", gate: "B", method: "link_code", signed_at: "2026-10-25T09:45:00.000Z", doc_key: "payment_terms", copy_path: "job-real/owner-paperwork/s5.pdf" },
    );
    expect(await sendOwnerPaperworkCopy("job-real", now)).toBe("sent (2 PDFs attached)");
    expect(calls.owner).toEqual(["owner_paperwork_copy:owner-paperwork-copy:v1:job-real:s4"]);
    expect(calls.testEmail.length).toBe(0);
  });
  test("TEST job → test-send with the signed PDF attached", async () => {
    reset();
    expect(await sendOwnerPaperworkCopy("job-test", now)).toBe("sent: test (1 PDF attached)");
    expect(calls.testEmail).toEqual(["owner_paperwork_copy:t1:jo@test.test:Your signed paperwork:1"]);
    expect(calls.owner.length).toBe(0);
  });
});

describe("E14 server (mocked)", () => {
  test("record-only kinds send nothing; real electrician: email + text through the guarded senders (paused while comms are off); TEST → test-send", async () => {
    reset();
    expect(await remindTradeToOfferTimes({ jobId: "job-real", assignmentId: "el-real", visitKind: "ready_check", remindedAt: new Date().toISOString() })).toBe("record only");
    const r = await remindTradeToOfferTimes({ jobId: "job-real", assignmentId: "el-real", visitKind: "piesa", remindedAt: new Date().toISOString() });
    expect(r).toBe("electrician email held: customer communications are off; electrician sms blocked: Customer communications are switched off");
    expect(calls.office).toEqual(["piesa_times_reminder:sam@spark.test"]);
    expect(calls.sms).toEqual(["piesa_times_reminder:piesa-times-reminder:v1:el-real:sms:0422 222 222:true"]);
    reset({ comms: true, switches: { piesa_times_reminder: true } });
    expect(await remindTradeToOfferTimes({ jobId: "job-real", assignmentId: "el-real", visitKind: "piesa", remindedAt: new Date().toISOString() })).toBe("electrician email sent: ok; electrician sms sent: SM1");
    reset({ comms: true });
    expect(await remindTradeToOfferTimes({ jobId: "job-real", assignmentId: "el-real", visitKind: "piesa", remindedAt: new Date().toISOString() })).toBe(`electrician email sent: ok; electrician sms blocked: "${SMS_MESSAGE_TYPES.piesa_times_reminder.label}" texts are switched off`);
    reset();
    const t = await remindTradeToOfferTimes({ jobId: "job-test", assignmentId: "el-test", visitKind: "piesa", remindedAt: new Date().toISOString() });
    expect(t).toBe("electrician email sent: test; electrician sms sent: test");
    expect(calls.testSms[0]).toContain("https://preview.test/field/job-test");
    expect(calls.sms.length + calls.office.length).toBe(0); // TEST never reaches the real senders
  });
  test("the 24h point is claimed once by the coordination_reminder event before the reminder is sent", () => {
    const alloc = read("src/lib/allocation.server.ts");
    const sweep = alloc.slice(alloc.indexOf("export async function sweepCoordination"), alloc.indexOf("// ---------- Owner-picked PIESA windows"));
    expect(sweep).toContain('eq("event_type", "coordination_reminder")');
    expect(sweep.indexOf("logEvent(")).toBeLessThan(sweep.indexOf("remindTradeToOfferTimes("));
  });
});

describe("I71 server (mocked)", () => {
  test("real installer: event first, email + text through the guarded senders (comms on, text switch off); once per assignment + PIESA time; TEST → test-send", async () => {
    reset({ comms: true });
    db.bookings!.push({ job_id: "job-real", kind: "assessment", status: "confirmed", scheduled_start: "2026-10-28T22:30:00+00:00" });
    const r = await notifyInstallerPlanning({ jobId: "job-real", assignmentId: "inst-real", piesaStartIso: "2026-10-28T22:30:00.000Z" });
    expect(r).toBe(`installer email sent: ok; installer sms blocked: "${SMS_MESSAGE_TYPES.installer_planning_notice.label}" texts are switched off`);
    expect(ev("job-real", INSTALLER_PLANNING_NOTIFIED_EVENT).length).toBe(1);
    expect(calls.office).toEqual(["installer_planning_notice:ian@inst.test"]);
    expect(calls.sms).toEqual([`installer_planning_notice:${installerPlanningKeys("inst-real", "2026-10-28T22:30:00.000Z").sms}:0411 111 111:true`]);
    expect(await notifyInstallerPlanning({ jobId: "job-real", assignmentId: "inst-real", piesaStartIso: "2026-10-28T22:30:00Z" })).toBe("already handled");
    expect(calls.sms.length).toBe(1);
    const t = await notifyInstallerPlanning({ jobId: "job-test", assignmentId: "inst-test", piesaStartIso: "2026-10-28T22:30:00.000Z" });
    expect(t).toBe("installer email sent: test; installer sms sent: test");
    expect(calls.testEmail[0]).toContain("HV-9001: safety check booked for Thursday 29 October");
  });
});
