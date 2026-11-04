// New job flow, Part 6, Task 6: the cancel writer the electrician's link uses is the existing visit-events path (record the
// trade cancellation, cancel the booking, release the trade, reopen the visit) — with no O74 (the owner email is Part 4's).
// The REAL visit-events.server runs against an in-memory database; only workflow.server (transition/logEvent) is a fake.
import { beforeEach, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const J = "00000000-0000-4000-8000-0000000000a1", ELEC = "00000000-0000-4000-8000-0000000000b2";
const tables: Tables = {};
class WorkflowError extends Error {}
const transitions: unknown[][] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => memoryPostgrest(tables).from(t) } }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError,
  transition: async (...a: unknown[]) => { transitions.push(a); const j = tables["jobs"]!.find((x) => x["id"] === a[0])!; j["stage"] = a[1]; },
  logEvent: async (jobId: string, actorId: string | null, eventType: string, summary: string, details: Record<string, unknown>) => {
    (tables["workflow_events"] ??= []).push({ job_id: jobId, actor_id: actorId, event_type: eventType, summary, details });
  },
}));
// O74 (decision 376) belongs to tradeCancelVisit only; the electrician's link path must never reach it.
const o74: unknown[] = [];
mock.module("../src/lib/visit-new-times.server", () => ({ notifyOwnerVisitNewTimes: async (p: unknown) => { o74.push(p); } }));
const ve = await import("../src/lib/visit-events.server");

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  transitions.length = 0; o74.length = 0;
  tables["jobs"] = [{ id: J, stage: "piesa_scheduled" }];
  tables["job_assignments"] = [{ id: "a2", job_id: J, business_id: ELEC, role: "electrician", active: true }];
  tables["bookings"] = [{ id: "bk1", job_id: J, kind: "assessment", status: "confirmed", scheduled_start: "2026-11-06T23:00:00.000Z", business_id: ELEC, assignment_id: "a2", contractor_id: null }];
  tables["partner_offers"] = [{ id: "o1", job_id: J, business_id: ELEC, status: "pending" }];
  tables["visit_events"] = [];
  tables["workflow_events"] = [];
});

test("cancels that business's confirmed safety check, records trade_cancelled, releases the electrician and reopens the visit", async () => {
  const r = await ve.cancelVisitFromElectricianLink(J, "assessment", ELEC, "Sick that week");
  expect(r).toEqual({ id: "bk1", scheduled_start: "2026-11-06T23:00:00.000Z" });
  expect(tables["bookings"]![0]!["status"]).toBe("cancelled");
  expect(tables["visit_events"]![0]).toMatchObject({ booking_id: "bk1", event: "trade_cancelled", counts_against: "trade", reason: "Sick that week" });
  expect(tables["job_assignments"]![0]!["active"]).toBe(false);
  expect(tables["partner_offers"]![0]!["status"]).toBe("withdrawn");
  expect(transitions[0]!.slice(0, 2)).toEqual([J, "piesa_and_install_window_pending"]);
  expect(o74).toHaveLength(0);
});
test("an upgrades day: the electrician is released too (not left on the job), the office is told", async () => {
  tables["jobs"]![0]!["stage"] = "rectification_booked";
  tables["bookings"]![0]!["kind"] = "rectification";
  const r = await ve.cancelVisitFromElectricianLink(J, "rectification", ELEC, "Van broke down");
  expect(r?.id).toBe("bk1");
  expect(tables["bookings"]![0]!["status"]).toBe("cancelled");
  expect(tables["job_assignments"]![0]!["active"]).toBe(false);
  expect(tables["workflow_events"]!.some((e) => e["event_type"] === "visit_needs_office")).toBe(true);
});
test("nothing of that kind booked for that business: null, nothing touched", async () => {
  expect(await ve.cancelVisitFromElectricianLink(J, "rectification", ELEC, "x")).toBeNull();
  expect(await ve.cancelVisitFromElectricianLink(J, "assessment", "someone-else", "x")).toBeNull();
  expect(tables["bookings"]![0]!["status"]).toBe("confirmed");
  expect(tables["visit_events"]).toHaveLength(0);
});
test("only that business's pending offers are withdrawn, not another trade's", async () => {
  tables["partner_offers"] = [{ id: "o1", job_id: J, business_id: ELEC, status: "pending" }, { id: "o2", job_id: J, business_id: "other-biz", status: "pending" }];
  await ve.cancelVisitFromElectricianLink(J, "assessment", ELEC, "Sick that week");
  expect(tables["partner_offers"]!.map((o) => o["status"])).toEqual(["withdrawn", "pending"]);
});
test("the existing trade cancel (tradeCancelVisit) still withdraws every pending offer on the job, as before: the scope is link-only", async () => {
  tables["bookings"]![0]!["contractor_id"] = "user-1";
  tables["partner_offers"] = [{ id: "o1", job_id: J, business_id: ELEC, status: "pending" }, { id: "o2", job_id: J, business_id: "other-biz", status: "pending" }];
  await ve.tradeCancelVisit(J, "user-1", "trade cancelled");
  expect(tables["partner_offers"]!.map((o) => o["status"])).toEqual(["withdrawn", "withdrawn"]);
});
