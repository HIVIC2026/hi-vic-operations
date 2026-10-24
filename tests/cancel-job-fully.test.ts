// Decision 227 (Jo 24 Oct 2026): Cancel at any time / reopen from Closed. Proves cancelJobFully and reopenJob against an
// in-memory backend: stage → cancelled (prior stage kept), every future booking (the held install day included) cancelled,
// open day offers superseded, pending trade offers withdrawn, installer/electrician assignments ended, unsent ESC notices
// cancelled (so no reminder or text goes out), the expected install week released, nothing deleted, nothing sent; reopen
// restores the prior stage with a reason. Run: bun test tests/cancel-job-fully.test.ts
import { beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, any>;
let db: Record<string, Row[]> = {};
const FUTURE = "2099-11-10T20:30:00.000Z";
const PAST = "2020-01-10T20:30:00.000Z";

function seed() {
  db = {
    jobs: [
      { id: "j1", job_number: "HV-3117", stage: "installation_booked", prior_stage: null, cancelled_reason: null, hold_reason: null, next_action: "Install booked", source: "website" },
      { id: "j2", job_number: "HV-3118", stage: "complete", prior_stage: null, cancelled_reason: null, hold_reason: null, next_action: null, source: "website" },
      { id: "j3", job_number: "HV-3119", stage: "cancelled", prior_stage: "pending_quote", cancelled_reason: "x", hold_reason: null, next_action: null, source: "website" },
    ],
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
      { id: "a-inst", job_id: "j1", role: "installer", active: true, ended_at: null, end_reason: null },
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
  const rows = () => (db[table] ??= []).filter((r) => filters.every((f) => f(r)));
  const run = () => {
    const hit = rows();
    if (patch) { for (const r of hit) Object.assign(r, patch); updates.push({ table, patch }); }
    return { data: hit.map((r) => ({ ...r })), error: null };
  };
  const api: any = {
    select: () => api, order: () => api, limit: () => api,
    update: (p: Row) => { patch = p; return api; },
    delete: () => { deletes.push(table); return api; },
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
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: q } }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError,
  logEvent: async (job_id: string, _a: unknown, event_type: string, summary: string, details: unknown, opts?: Row) => { db.workflow_events!.push({ job_id, event_type, summary, details, ...(opts ?? {}) }); },
}));
const { cancelJobFully, reopenJob } = await import("../src/lib/office-actions.server");

beforeEach(() => { seed(); updates.length = 0; deletes.length = 0; });
const job = (id: string) => db.jobs!.find((j) => j.id === id)!;
const byId = (t: string, id: string) => db[t]!.find((r) => r.id === id)!;
const events = (type: string) => db.workflow_events!.filter((e) => e.event_type === type);

describe("cancelJobFully (decision 227, mocked DB)", () => {
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

  test("stops reminders and texts: unsent ESC notices cancelled, sent ones kept; nothing sent even when ticked", async () => {
    const r = await cancelJobFully("j1", "Owner changed their mind", "admin-1", { tell: { owner: true, installer: true } });
    expect(byId("esc_notifications", "e-unsent").status).toBe("cancelled");
    expect(byId("esc_notifications", "e-sent").status).toBe("sent");
    expect(r.released.escNotices).toBe(1);
    expect(r.noticesSent).toBe(false);
    const n = events("cancel_notice_requested");
    expect(n).toHaveLength(1);
    expect((n[0]!.details as Row).wording_approved).toBe(false);
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

  test("reopen restores the stage it was at, with a reason, history kept", async () => {
    await cancelJobFully("j1", "Owner changed their mind", "admin-1");
    await expect(reopenJob("j1", "", "admin-1")).rejects.toThrow(/reason/);
    const r = await reopenJob("j1", "Owner rang back – go ahead", "admin-1");
    expect(r.stage).toBe("installation_booked");
    expect(job("j1")).toMatchObject({ stage: "installation_booked", prior_stage: null, cancelled_reason: null });
    const ev = events("stage_changed").at(-1)!;
    expect(ev).toMatchObject({ from: "cancelled", to: "installation_booked" });
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
