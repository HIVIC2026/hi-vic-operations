// Decision 227 (Jo 24 Oct 2026): Cancel at any time / reopen from Closed. Proves cancelJobFully and reopenJob against an
// in-memory backend: stage → cancelled (prior stage kept), every future booking (the held install day included) cancelled,
// open day offers superseded, pending trade offers withdrawn, installer/electrician assignments ended, unsent ESC notices
// cancelled (so no reminder or text goes out), the expected install week released, nothing deleted; reopen restores the
// prior stage with a reason. Decision 291 (Jo 25 Oct 2026): ticked notices SEND the owner email O69 and the installer
// email I70 through the guarded senders (mocked here): both when ticked, neither when unticked, held when customer
// comms are off, TEST job → test-send only, never twice for the same cancellation. Run: bun test tests/cancel-job-fully.test.ts
import { beforeEach, describe, expect, mock, test } from "bun:test";

process.env["HIV_OFFICE_PHONE"] = "03 9000 0000";

type Row = Record<string, any>;
let db: Record<string, Row[]> = {};
const FUTURE = "2099-11-10T20:30:00.000Z";
const PAST = "2020-01-10T20:30:00.000Z";
const REAL_BIZ = { name: "Reinsulate", trading_name: null, email: "office@reinsulate.test", onboarding_notes: null };
const TEST_BIZ = { name: "Test Installers", trading_name: null, email: "test@reinsulate.test", onboarding_notes: "[TEST PARTNER]" };

function seed() {
  db = {
    jobs: [
      { id: "j1", job_number: "HV-3117", stage: "installation_booked", prior_stage: null, cancelled_reason: null, hold_reason: null, next_action: "Install booked", source: "website", owner_id: "o1", property_id: "p1" },
      { id: "j2", job_number: "HV-3118", stage: "complete", prior_stage: null, cancelled_reason: null, hold_reason: null, next_action: null, source: "website" },
      { id: "j3", job_number: "HV-3119", stage: "cancelled", prior_stage: "pending_quote", cancelled_reason: "x", hold_reason: null, next_action: null, source: "website" },
      { id: "j7", job_number: "HV-9001", stage: "pending_quote", prior_stage: null, cancelled_reason: null, hold_reason: null, next_action: null, source: "qa_test", owner_id: "o7", property_id: "p7" },
      { id: "j8", job_number: "HV-3130", stage: "pending_quote", prior_stage: null, cancelled_reason: null, hold_reason: null, next_action: null, source: "website", owner_id: "o8", property_id: "p8", originating_installer_business_id: "b-test" },
    ],
    owners: [
      { id: "o1", full_name: "Helen Yang", email: "helen@example.test" },
      { id: "o7", full_name: "Test Owner", email: "jo-test@example.test" },
      { id: "o8", full_name: "Ann Wu", email: null },
    ],
    properties: [
      { id: "p1", address_line: "824 High Street Road", suburb: "Glen Waverley", postcode: "3150" },
      { id: "p7", address_line: "1 Test Street", suburb: "Testville", postcode: "3000" },
      { id: "p8", address_line: "5 Orchard Lane", suburb: "Ringwood", postcode: "3134" },
    ],
    businesses: [{ id: "b-test", ...TEST_BIZ }],
    customer_email_sends: [],
    bookings: [
      { id: "b-install", job_id: "j1", kind: "installation", status: "confirmed", scheduled_start: FUTURE },
      { id: "b-piesa-done", job_id: "j1", kind: "assessment", status: "completed", scheduled_start: PAST },
      { id: "b-past-confirmed", job_id: "j1", kind: "ready_check", status: "confirmed", scheduled_start: PAST },
      { id: "b-other-job", job_id: "j2", kind: "installation", status: "confirmed", scheduled_start: FUTURE },
    ],
    appointment_proposals: [
      { id: "p1", job_id: "j1", status: "proposed" },
      { id: "p2", job_id: "j1", status: "accepted" },
    ],
    partner_offers: [
      { id: "o1", job_id: "j1", status: "pending", responded_at: null },
      { id: "o2", job_id: "j1", status: "declined", responded_at: PAST },
    ],
    job_assignments: [
      { id: "a-inst", job_id: "j1", role: "installer", active: true, ended_at: null, end_reason: null, user_id: "u1", business_id: "b-real", profiles: { full_name: "Sam Lee", email: "sam@reinsulate.test" }, businesses: REAL_BIZ },
      { id: "a-elec", job_id: "j1", role: "electrician", active: true, ended_at: null, end_reason: null },
      { id: "a-old", job_id: "j1", role: "installer", active: false, ended_at: PAST, end_reason: "replaced" },
    ],
    esc_notifications: [
      { id: "e-unsent", job_id: "j1", status: "pending", sent_at: null },
      { id: "e-sent", job_id: "j1", status: "sent", sent_at: PAST },
    ],
    install_holds: [{ id: "h1", job_id: "j1", status: "active", released_at: null, release_reason: null, updated_at: null }],
    workflow_events: [{ id: "w-old", job_id: "j1", event_type: "quote_accepted", summary: "Quote accepted" }],
  };
}

const updates: { table: string; patch: Row }[] = [];
const deletes: string[] = [];
function q(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let patch: Row | null = null;
  let orderBy: ((x: Row, y: Row) => number) | null = null;
  const rows = () => { const hit = (db[table] ??= []).filter((r) => filters.every((f) => f(r))); return orderBy ? hit.sort(orderBy) : hit; };
  const run = () => {
    const hit = rows();
    if (patch) { for (const r of hit) Object.assign(r, patch); updates.push({ table, patch }); }
    return { data: hit.map((r) => ({ ...r })), error: null };
  };
  const api: any = {
    select: () => api, limit: () => api,
    order: (k: string, o?: { ascending?: boolean }) => { const asc = o?.ascending !== false; orderBy = (x: Row, y: Row) => (String(x[k] ?? "") < String(y[k] ?? "") ? -1 : String(x[k] ?? "") > String(y[k] ?? "") ? 1 : 0) * (asc ? 1 : -1); return api; },
    like: (k: string, v: string) => { const pre = v.replace(/%$/, ""); filters.push((r) => typeof r[k] === "string" && r[k].startsWith(pre)); return api; },
    update: (p: Row) => { patch = p; return api; },
    insert: (row: Row) => { (db[table] ??= []).push({ id: `${table}-${db[table]!.length + 1}`, created_at: new Date().toISOString(), ...row }); return api; },
    delete: () => { deletes.push(table); return api; },
    contains: (k: string, v: Row) => { filters.push((r) => Object.entries(v).every(([kk, vv]) => (r[k] ?? {})[kk] === vv)); return api; },
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return api; },
    in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return api; },
    gt: (k: string, v: string) => { filters.push((r) => r[k] > v); return api; },
    is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return api; },
    not: (k: string, op: string, v: string) => { const list = v.replace(/[()]/g, "").split(","); if (op === "in") filters.push((r) => !list.includes(r[k])); return api; },
    maybeSingle: async () => { const r = run(); return { data: r.data[0] ?? null, error: null }; },
    single: async () => { const r = run(); return { data: r.data[0] ?? null, error: r.data[0] ? null : { message: "no row" } }; },
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  };
  return api;
}

class WorkflowError extends Error {}
const closedForms: string[] = [];
mock.module("../src/lib/in-house-forms.server", () => ({ closeUnneededForms: async (jobId: string) => { closedForms.push(jobId); return 3; } }));
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: q } }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError,
  stageEntryBlockers: async () => [],
  currentApprovedQuote: async () => null,
  // Like the real workflow_events.actor_id (uuid): "" is refused, null is fine.
  logEvent: async (job_id: string, actor_id: unknown, event_type: string, summary: string, details: unknown, opts?: Row) => {
    if (actor_id === "") throw new Error('invalid input syntax for type uuid: ""');
    db.workflow_events!.push({ job_id, actor_id, event_type, summary, details, created_at: new Date().toISOString(), ...(opts ?? {}) });
  },
}));
// Batch 1 F6: reopen reads the repeat-check state (no 30-day lapse on these jobs).
mock.module("../src/lib/install-days.server", () => ({ installDayContext: async () => ({ deadline: null, expired: false, booked: false }) }));
// Decision 291 senders, mocked: the real owner path, the partner office-email path and the TEST sender.
const comms = { enabled: true };
const calls = { owner: [] as Row[], office: [] as Row[], test: [] as Row[] };
mock.module("../src/lib/comms.server", () => ({
  customerCommsEnabled: async () => comms.enabled,
  assertCustomerDeliveryAllowed: async (_jobId: string, what: string) => { if (!comms.enabled) throw new WorkflowError(`Customer messages are switched off (${what})`); },
}));
mock.module("../src/lib/owner-email-send.server", () => ({
  sendGuardedOwnerEmail: async (p: { jobId: string; to: string; purpose: string; key: string; build: () => { subject: string; html: string; text: string } }) => {
    if (db.customer_email_sends!.some((r) => r.idempotency_key === p.key)) return "already attempted — not resent";
    const m = p.build();
    db.customer_email_sends!.push({ job_id: p.jobId, purpose: p.purpose, idempotency_key: p.key, status: "sent" });
    calls.owner.push({ to: p.to, purpose: p.purpose, key: p.key, subject: m.subject, text: m.text });
    return "sent";
  },
}));
mock.module("../src/lib/office-email.server", () => ({
  sendOfficeEmail: async (p: { recipient: string; to: string; subject: string; label: string; record: { businessId: string | null }; text?: string }) => {
    calls.office.push({ to: p.to, recipient: p.recipient, label: p.label, businessId: p.record.businessId, subject: p.subject, text: p.text });
    return comms.enabled ? { channel: "email", to: p.to, status: "sent", detail: "Accepted by the email service" } : { channel: "email", to: p.to, status: "blocked", detail: "Emails are paused while the templates are reviewed (master switch off). Nothing was sent." };
  },
}));
mock.module("../src/lib/test-send.server", () => ({
  sendTestEmail: async (ctx: { jobSource: string | null; partnerIsTest: boolean; label: string }, to: string, subject: string) => { calls.test.push({ source: ctx.jobSource, partnerIsTest: ctx.partnerIsTest, label: ctx.label, to, subject }); return { channel: "email", to, status: "sent", detail: "test" }; },
}));
const { cancelJobFully, reopenJob, releaseCancelledJob } = await import("../src/lib/office-actions.server");

beforeEach(() => { seed(); closedForms.length = 0; updates.length = 0; deletes.length = 0; comms.enabled = true; calls.owner.length = 0; calls.office.length = 0; calls.test.length = 0; });
const job = (id: string) => db.jobs!.find((j) => j.id === id)!;
const byId = (t: string, id: string) => db[t]!.find((r) => r.id === id)!;
const events = (type: string) => db.workflow_events!.filter((e) => e.event_type === type);

describe("cancelJobFully (decision 227, mocked DB)", () => {
  test("Task 3 cancellation invokes portal-only unused-form closure for this job", async () => {
    await cancelJobFully("j1", "Owner cancelled", "admin");
    expect(closedForms).toEqual(["j1"]);
  });
  test("moves the job to Closed with the reason and keeps the stage it was at", async () => {
    const r = await cancelJobFully("j1", "Owner changed their mind", "admin-1");
    expect(job("j1")).toMatchObject({ stage: "cancelled", prior_stage: "installation_booked", cancelled_reason: "Owner changed their mind", next_action: null });
    expect(r.noticesSent).toBe(false);
    const st = events("stage_changed").at(-1)!;
    expect(st).toMatchObject({ job_id: "j1", from: "installation_booked", to: "cancelled" });
    expect((st.details as Row).decision).toBe(227);
  });

  test("releases the held install day and every future booking, leaves past and other jobs' bookings alone", async () => {
    const r = await cancelJobFully("j1", "Owner changed their mind", "admin-1");
    expect(byId("bookings", "b-install").status).toBe("cancelled");
    expect(byId("bookings", "b-piesa-done").status).toBe("completed");
    expect(byId("bookings", "b-past-confirmed").status).toBe("confirmed");
    expect(byId("bookings", "b-other-job").status).toBe("confirmed");
    expect(r.released.bookings).toBe(1);
    expect(byId("install_holds", "h1")).toMatchObject({ status: "released", release_reason: "Job cancelled: Owner changed their mind" });
    expect(r.released.installHolds).toBe(1);
  });

  test("releases the installer and electrician (assignments ended, open offers withdrawn, day offers superseded)", async () => {
    const r = await cancelJobFully("j1", "Owner changed their mind", "admin-1");
    expect(byId("job_assignments", "a-inst")).toMatchObject({ active: false, end_reason: "Job cancelled: Owner changed their mind" });
    expect(byId("job_assignments", "a-elec").active).toBe(false);
    expect(byId("job_assignments", "a-old").end_reason).toBe("replaced");
    expect(byId("partner_offers", "o1").status).toBe("withdrawn");
    expect(byId("partner_offers", "o2").status).toBe("declined");
    expect(byId("appointment_proposals", "p1").status).toBe("superseded");
    expect(byId("appointment_proposals", "p2").status).toBe("accepted");
    expect(r.released).toMatchObject({ trades: 2, tradeOffers: 1, dayOffers: 1 });
  });

  test("stops reminders and texts: unsent ESC notices cancelled, sent ones kept; nothing sent when the ticks are off", async () => {
    const r = await cancelJobFully("j1", "Owner changed their mind", "admin-1");
    expect(byId("esc_notifications", "e-unsent").status).toBe("cancelled");
    expect(byId("esc_notifications", "e-sent").status).toBe("sent");
    expect(r.released.escNotices).toBe(1);
    expect(r.noticesSent).toBe(false);
    expect(r.notices).toEqual({ owner: null, installer: null });
    expect(events("cancel_notice_requested")).toHaveLength(0);
    expect(events("cancel_notice_sent")).toHaveLength(0);
    expect(calls.owner.length + calls.office.length + calls.test.length).toBe(0);
  });

  // ---- decision 291: the ticks send O69 (owner) and I70 (installer), by email ----
  test("both ticked on a real job: O69 to the owner through the guarded owner path, I70 to the installer business email, one event each, ticks kept as history", async () => {
    const r = await cancelJobFully("j1", "Owner changed their mind", "admin-1", { tell: { owner: true, installer: true } });
    expect(r.noticesSent).toBe(true);
    expect(r.notices.owner).toMatchObject({ who: "owner", status: "sent", to: "helen@example.test" });
    expect(r.notices.installer).toMatchObject({ who: "installer", status: "sent", to: "office@reinsulate.test" });
    expect(calls.owner).toHaveLength(1);
    expect(calls.owner[0]).toMatchObject({ to: "helen@example.test", purpose: "job_cancelled", key: "cancel-notice:v1:j1:0:owner", subject: "Your ceiling insulation job HV-3117 has been cancelled" });
    expect(calls.owner[0]!.text).toContain("We've cancelled your ceiling insulation job at 824 High Street Road, Glen Waverley VIC 3150, as discussed.");
    expect(calls.owner[0]!.text).not.toContain("call us");
    expect(calls.office).toHaveLength(1);
    expect(calls.office[0]).toMatchObject({ recipient: "partner", to: "office@reinsulate.test", label: "job_cancelled_installer", businessId: "b-real", subject: "HV-3117 cancelled – 824 High Street Road, Glen Waverley" });
    expect(calls.office[0]!.text).toContain("HV-3117 at 824 High Street Road, Glen Waverley has been cancelled. Nothing more to do on it — it's gone from your list.");
    expect(calls.office[0]!.text).not.toContain("HIV:"); // I70 design fix: no text-message prefix in the email
    expect(calls.office[0]!.text).not.toContain("Helen");
    expect(calls.test).toHaveLength(0);
    // The installer was released (assignment ended) and still told: the recipient is read before the release.
    expect(byId("job_assignments", "a-inst").active).toBe(false);
    const sent = events("cancel_notice_sent");
    expect(sent).toHaveLength(2);
    expect(sent.map((e) => (e.details as Row).who).sort()).toEqual(["installer", "owner"]);
    expect(sent.every((e) => (e.details as Row).channel === "email" && (e.details as Row).cancel_seq === 0 && e.internal === true)).toBe(true);
    expect(events("cancel_notice_held")).toHaveLength(0);
    const asked = events("cancel_notice_requested");
    expect(asked).toHaveLength(1);
    expect(asked[0]!.summary).toContain("email the owner and email the installer");
    expect((asked[0]!.details as Row).wording_approved).toBe(true);
  });

  test("batch 1 F2: owner cancel / STOP (no office actor) still records the notice — actor null, not \"\"", async () => {
    await cancelJobFully("j1", "Owner cancelled in the portal", null, { tell: { owner: true, installer: false } });
    const sent = [...events("cancel_notice_sent"), ...events("cancel_notice_held")];
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ event_type: "cancel_notice_sent", actor_id: null });
    expect((sent[0]!.details as Row).who).toBe("owner");
  });

  test("only the owner ticked → only O69; only the installer ticked → only I70", async () => {
    await cancelJobFully("j1", "Owner changed their mind", "admin-1", { tell: { owner: true, installer: false } });
    expect(calls.owner).toHaveLength(1);
    expect(calls.office).toHaveLength(0);
    expect(events("cancel_notice_sent").map((e) => (e.details as Row).who)).toEqual(["owner"]);
    seed(); calls.owner.length = 0;
    await cancelJobFully("j1", "Owner changed their mind", "admin-1", { tell: { owner: false, installer: true } });
    expect(calls.owner).toHaveLength(0);
    expect(calls.office).toHaveLength(1);
    expect(events("cancel_notice_sent").map((e) => (e.details as Row).who)).toEqual(["installer"]);
  });

  test("customer comms off: the job is still cancelled, both notices are HELD (event says held, nothing reaches a provider)", async () => {
    comms.enabled = false;
    const r = await cancelJobFully("j1", "Owner changed their mind", "admin-1", { tell: { owner: true, installer: true } });
    expect(job("j1").stage).toBe("cancelled");
    expect(r.noticesSent).toBe(false);
    expect(r.notices.owner).toMatchObject({ status: "held" });
    expect(r.notices.owner!.detail).toMatch(/switched off/);
    expect(r.notices.installer).toMatchObject({ status: "held" });
    expect(r.notices.installer!.detail).toMatch(/paused|master switch/);
    expect(calls.owner).toHaveLength(0); // the real owner sender is never reached
    expect(events("cancel_notice_sent")).toHaveLength(0);
    const held = events("cancel_notice_held");
    expect(held).toHaveLength(2);
    expect(held.every((e) => e.summary.includes("held"))).toBe(true);
    expect(held.map((e) => (e.details as Row).who).sort()).toEqual(["installer", "owner"]);
  });

  test("TEST job (source qa_test): both go through test-send only, labelled with their keys; a job supplied by a [TEST PARTNER] uses the originating business", async () => {
    await cancelJobFully("j7", "Practice run", "admin-1", { tell: { owner: true, installer: true } });
    expect(calls.owner).toHaveLength(0);
    expect(calls.office).toHaveLength(0);
    // No installer on j7 → the installer notice is held (not invented), the owner one goes to the TEST sender.
    expect(calls.test).toHaveLength(1);
    expect(calls.test[0]).toMatchObject({ source: "qa_test", partnerIsTest: false, label: "job_cancelled:cancel-notice:v1:j7:0:owner", to: "jo-test@example.test", subject: "Your ceiling insulation job HV-9001 has been cancelled" });
    expect(events("cancel_notice_held").map((e) => (e.details as Row).detail)).toEqual(["no installer on this job"]);
    expect(events("cancel_notice_sent")).toHaveLength(1);
    // j8: real website job, no active assignment, originating [TEST PARTNER] business → test-send for the installer; owner has no email → held.
    await cancelJobFully("j8", "Owner changed their mind", "admin-1", { tell: { owner: true, installer: true } });
    expect(calls.office).toHaveLength(0);
    expect(calls.owner).toHaveLength(0);
    expect(calls.test.at(-1)).toMatchObject({ source: "website", partnerIsTest: true, label: "job_cancelled_installer:cancel-notice:v1:j8:0:installer", to: "test@reinsulate.test", subject: "HV-3130 cancelled – 5 Orchard Lane, Ringwood" });
    expect(db.workflow_events!.filter((e) => e.job_id === "j8" && e.event_type === "cancel_notice_held").map((e) => (e.details as Row).detail)).toEqual(["no owner email on file"]);
  });

  test("never twice for the same cancellation: a repeat cancel is refused, a direct resend is a no-op; reopen + cancel again is a new cancellation", async () => {
    await cancelJobFully("j1", "Owner changed their mind", "admin-1", { tell: { owner: true, installer: true } });
    await expect(cancelJobFully("j1", "Owner changed their mind again", "admin-1", { tell: { owner: true, installer: true } })).rejects.toThrow(/already cancelled/);
    const { sendCancelNotices } = await import("../src/lib/cancel-notice.server");
    const again = await sendCancelNotices("j1", "admin-1", { owner: true, installer: true }, { cancelSeq: 0, installer: { businessId: "b-real", contactName: "Sam Lee", email: "office@reinsulate.test", isTestPartner: false } });
    expect(again.owner).toMatchObject({ status: "already" });
    expect(again.installer).toMatchObject({ status: "already" });
    expect(calls.owner).toHaveLength(1);
    expect(calls.office).toHaveLength(1);
    expect(events("cancel_notice_sent")).toHaveLength(2);
    // Even without the event, the owner ledger's unique key refuses a second send for the same cancellation.
    db.workflow_events = db.workflow_events!.filter((e) => e.event_type !== "cancel_notice_sent");
    const ledger = await sendCancelNotices("j1", "admin-1", { owner: true, installer: false }, { cancelSeq: 0, installer: null });
    expect(ledger.owner).toMatchObject({ status: "held", detail: "already attempted — not resent" });
    expect(calls.owner).toHaveLength(1);
    // Reopened and cancelled again later: a new cancellation (cancel_seq 1) tells them again.
    seed(); calls.owner.length = 0; calls.office.length = 0;
    await cancelJobFully("j1", "Owner changed their mind", "admin-1", { tell: { owner: true, installer: false } });
    await reopenJob("j1", "Owner rang back", "admin-1");
    await cancelJobFully("j1", "Owner changed their mind again", "admin-1", { tell: { owner: true, installer: false } });
    expect(calls.owner.map((c) => c.key)).toEqual(["cancel-notice:v1:j1:0:owner", "cancel-notice:v1:j1:1:owner"]);
  });

  test("batch 2 F2: STOP retry after a failed first try (installer already released) emails that installer once", async () => {
    // First try: the job was closed and the assignment ended, then the release failed before job_cancel_released.
    const ENDED = new Date(Date.now() - 60_000).toISOString();
    job("j1").stage = "cancelled";
    Object.assign(byId("job_assignments", "a-inst"), { active: false, ended_at: ENDED, end_reason: "Job cancelled: Owner replied STOP" });
    db.job_assignments!.push({ id: "a-older", job_id: "j1", role: "installer", active: false, ended_at: PAST, end_reason: "Job cancelled: earlier", user_id: "u9", business_id: "b-other", profiles: { full_name: "Old Co", email: "old@x.test" }, businesses: { name: "Old Co", trading_name: null, email: "old@x.test", onboarding_notes: null } });
    await releaseCancelledJob("j1", "Owner replied STOP", null, { owner: false, installer: true });
    expect(calls.office).toHaveLength(1);
    expect(calls.office[0]).toMatchObject({ to: "office@reinsulate.test", businessId: "b-real" });
    // A later run (release now recorded) does not reach back to that installer again.
    await releaseCancelledJob("j1", "Owner replied STOP", null, { owner: false, installer: true });
    expect(calls.office).toHaveLength(1);
  });

  test("batch 2 F2: a normal cancel still tells the active installer, not one released at an earlier cancellation", async () => {
    db.job_assignments!.push({ id: "a-older", job_id: "j1", role: "installer", active: false, ended_at: PAST, end_reason: "Job cancelled: earlier", user_id: "u9", business_id: "b-other", profiles: { full_name: "Old Co", email: "old@x.test" }, businesses: { name: "Old Co", trading_name: null, email: "old@x.test", onboarding_notes: null } });
    await cancelJobFully("j1", "Owner changed their mind", "admin-1", { tell: { owner: false, installer: true } });
    expect(calls.office.map((c) => c.businessId)).toEqual(["b-real"]);
  });

  test("the sender module stays behind the existing guards and never talks to a provider itself", async () => {
    const { readFileSync } = await import("node:fs");
    const srv = readFileSync("src/lib/cancel-notice.server.ts", "utf8");
    expect(srv).not.toMatch(/resendSend\(|fetch\(|twilio|sendRealSms|sendTestSms/i);
    for (const t of ["sendTestEmail", "assertCustomerDeliveryAllowed", "sendGuardedOwnerEmail", "sendOfficeEmail", "CANCEL_NOTICE_EMAILS_APPROVED", "isTestPartner"]) expect(srv + readFileSync("src/lib/office-actions.server.ts", "utf8")).toContain(t);
    expect(readFileSync("src/lib/autoadvance.server.ts", "utf8")).not.toContain("cancel-notice");
  });

  test("keeps history: nothing deleted, earlier events still there, release summary logged", async () => {
    await cancelJobFully("j1", "Owner changed their mind", "admin-1", { note: "phoned 9am" });
    expect(deletes).toEqual([]);
    expect(db.workflow_events!.some((e) => e.id === "w-old")).toBe(true);
    expect(events("job_cancel_released")).toHaveLength(1);
    expect(job("j1").cancelled_reason).toBe("Owner changed their mind · phoned 9am");
  });

  test("refuses without a reason, on a completed job, and on an already cancelled job (no writes)", async () => {
    await expect(cancelJobFully("j1", " ", "admin-1")).rejects.toThrow(/reason/);
    await expect(cancelJobFully("j2", "Owner changed their mind", "admin-1")).rejects.toThrow(/complete/);
    await expect(cancelJobFully("j3", "Owner changed their mind", "admin-1")).rejects.toThrow(/already cancelled/);
    expect(updates).toEqual([]);
  });

  test("reopen goes to a safe stage (batch 1 task 6: install booked → PIESA pending, new safety check), with a reason, history kept", async () => {
    await cancelJobFully("j1", "Owner changed their mind", "admin-1");
    await expect(reopenJob("j1", "", "admin-1")).rejects.toThrow(/reason/);
    const r = await reopenJob("j1", "Owner rang back – go ahead", "admin-1");
    expect(r.stage).toBe("piesa_and_install_window_pending");
    expect(job("j1")).toMatchObject({ stage: "piesa_and_install_window_pending", prior_stage: null, cancelled_reason: null });
    const ev = events("stage_changed").at(-1)!;
    expect(ev).toMatchObject({ from: "cancelled", to: "piesa_and_install_window_pending" });
    expect(ev.summary).toBe("Reopened: Owner rang back – go ahead");
    expect(events("job_cancel_released")).toHaveLength(1);
    await expect(reopenJob("j2", "Owner rang back", "admin-1")).rejects.toThrow(/Completed jobs stay closed/);
  });

  test("reopen an ineligible job: back to confirm on site, logged with the earlier outcome", async () => {
    db.jobs!.push({ id: "j4", job_number: "HV-3120", stage: "new_enquiry", prior_stage: null, cancelled_reason: null, eligibility_outcome: "does_not_appear_eligible", source: "base44" });
    await reopenJob("j4", "Photos were of the garage", "admin-1");
    expect(job("j4")).toMatchObject({ stage: "new_enquiry", eligibility_outcome: "needs_onsite_confirmation", eligibility_decision_source: "admin" });
    const ev = events("eligibility_set").at(-1)!;
    expect((ev.details as Row).previous_outcome).toBe("does_not_appear_eligible");
    expect(events("job_reopened")).toHaveLength(1);
  });

  test("reopen a job marked as test restores its recorded source; a born-TEST job and a removed lead stay closed", async () => {
    db.jobs!.push({ id: "j5", job_number: "HV-3121", stage: "new_enquiry", prior_stage: null, source: "qa_test", eligibility_outcome: null });
    db.workflow_events!.push({ job_id: "j5", event_type: "marked_test", details: { prior_source: "base44" }, created_at: "2026-10-20T00:00:00Z" });
    await reopenJob("j5", "Was a real owner", "admin-1");
    expect(job("j5").source).toBe("base44");
    expect(events("unmarked_test")).toHaveLength(1);
    db.jobs!.push({ id: "j6", job_number: "HV-3122", stage: "new_enquiry", prior_stage: null, source: "qa_test", eligibility_outcome: null });
    await expect(reopenJob("j6", "Was a real owner", "admin-1")).rejects.toThrow(/TEST job/);
    db.workflow_events!.push({ job_id: "j3", event_type: "lead_removed", details: {}, created_at: "2026-10-20T00:00:00Z" });
    await expect(reopenJob("j3", "Was a real owner", "admin-1")).rejects.toThrow(/Removed leads/);
    expect(job("j6").source).toBe("qa_test");
    expect(job("j3").stage).toBe("cancelled");
  });

  test("mark as test records the earlier source so Reopen can put it back", async () => {
    const { markJobAsTest } = await import("../src/lib/office-actions.server");
    await markJobAsTest("j1", "Practice job", "admin-1");
    expect(job("j1").source).toBe("qa_test");
    expect((events("marked_test").at(-1)!.details as Row).prior_source).toBe("website");
  });
});
