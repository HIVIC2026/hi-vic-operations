import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { closeStoppedEnquiries } from "../src/lib/sms-stop.server";

type Row = { id: string; stage: string; owner_phone: string; office_bucket: string; source: string; deleted_at: string | null };
let rows: Row[] = [], assignments: string[] = [], pendingOffers: string[] = [];
let stageNow: Record<string, string> = {};
let updates: string[] = [], events: Record<string, unknown>[] = [];
const cancelCalls: unknown[][] = [];
let failFor: string | null = null;
mock.module("../src/lib/office-actions.server", () => ({ cancelJobFully: async (...a: unknown[]) => { cancelCalls.push(a); if (a[0] === failFor) throw new Error("Cancelled, but releasing the job's bookings failed"); } }));
afterAll(() => mock.restore());

const db = { from(table: string) {
  const filters: Array<(r: any) => boolean> = [];
  let payload: any, op = "read";
  const result = () => {
    if (table === "lead_campaign_responses") return { data: rows.map((r) => ({ job_id: r.id })), error: null };
    if (table === "job_assignments") return { data: assignments.map((job_id) => ({ job_id, active: true })).filter((r) => filters.every((f) => f(r))), error: null };
    if (table === "partner_offers") return { data: pendingOffers.map((job_id) => ({ job_id, status: "pending" })).filter((r) => filters.every((f) => f(r))), error: null };
    if (table === "jobs" && op === "read") return { data: rows.filter((r) => filters.every((f) => f(r))).map((r) => ({ ...r, stage: stageNow[r.id] ?? r.stage })), error: null };
    if (table === "workflow_events") { events.push(payload); return { data: null, error: null }; }
    const selected = rows.filter((r) => filters.every((f) => f(r)));
    if (op === "update") { for (const r of selected) { updates.push(r.id); Object.assign(r, payload); r.office_bucket = "closed"; } }
    return { data: selected.map((r) => ({ ...r })), error: null };
  };
  const q: any = {
    select: () => q, eq: (k: string, v: any) => { filters.push((r) => r[k] === v); return q; },
    neq: (k: string, v: any) => { filters.push((r) => r[k] !== v); return q; },
    is: (k: string, v: any) => { filters.push((r) => r[k] === v); return q; },
    not: () => q, in: () => q, order: () => q, limit: () => q, range: () => q,
    update: (v: any) => { payload = v; op = "update"; return q; }, insert: (v: any) => { payload = v; op = "insert"; return q; },
    maybeSingle: async () => { const r = result(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; },
    then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
  };
  return q;
} };
const saved = (id: string): Row => ({ id, stage: "ready_check_ready_to_schedule", owner_phone: "0491 234 567", office_bucket: "active", source: "base44", deleted_at: null });
beforeEach(() => { failFor = null; stageNow = {}; rows = []; assignments = []; pendingOffers = []; updates = []; events = []; cancelCalls.length = 0; });

test("saved spot with an active installer assignment goes through cancelJobFully, telling the installer, with no direct close", async () => {
  rows = [saved("j1")]; assignments = ["j1"];
  await closeStoppedEnquiries(db, "+61491234567", "sid", "2026-10-28T00:00:00Z");
  expect(cancelCalls).toEqual([["j1", "Opted out (replied STOP)", null, { tell: { owner: false, installer: true } }]]);
  expect(updates).toEqual([]); expect(events).toHaveLength(0);
});

test("a pending installer offer also uses cancelJobFully", async () => {
  rows = [saved("j1")]; pendingOffers = ["j1"];
  await closeStoppedEnquiries(db, "+61491234567", null, "2026-10-28T00:00:00Z");
  expect(cancelCalls).toHaveLength(1); expect(updates).toEqual([]); expect(events).toHaveLength(0);
});

test("no assignment and no pending offer keeps the direct close and its one history row", async () => {
  rows = [saved("j1")];
  await closeStoppedEnquiries(db, "+61491234567", "sid", "2026-10-28T00:00:00Z");
  expect(cancelCalls).toHaveLength(0); expect(updates).toEqual(["j1"]); expect(events).toHaveLength(1);
  expect(events[0]?.event_type).toBe("stage_changed");
});

test("shared phone: each job is handled its own way", async () => {
  rows = [saved("booked"), saved("plain")]; assignments = ["booked"];
  await closeStoppedEnquiries(db, "+61491234567", "sid", "2026-10-28T00:00:00Z");
  expect(cancelCalls.map((c) => c[0])).toEqual(["booked"]);
  expect(updates).toEqual(["plain"]); expect(events).toHaveLength(1); expect(events[0]?.job_id).toBe("plain");
});

test("one failing cancel does not stop the next job; failure is logged once and rethrown after the loop", async () => {
  rows = [saved("bad"), saved("good")]; assignments = ["bad", "good"]; failFor = "bad";
  await expect(closeStoppedEnquiries(db, "+61491234567", "sid", "2026-10-28T00:00:00Z")).rejects.toThrow("releasing the installer failed");
  expect(cancelCalls.map((c) => c[0])).toEqual(["bad", "good"]);
  expect(events.filter((e) => e.event_type === "stop_installer_release_failed")).toHaveLength(1);
  expect(events[0]?.job_id).toBe("bad");
});

test("a job whose stage changed or is a test job is not cancelled", async () => {
  rows = [saved("moved"), { ...saved("qa"), source: "qa_test" }]; assignments = ["moved", "qa"]; stageNow = { moved: "ready_check_scheduled" };
  await closeStoppedEnquiries(db, "+61491234567", "sid", "2026-10-28T00:00:00Z");
  expect(cancelCalls).toHaveLength(0);
});
