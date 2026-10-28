import { beforeEach, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
const tables: Tables = {};
const writes: string[] = [];
let texts = 0;
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => memoryPostgrest(tables).from(t) } }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: class extends Error {}, piesaRequestFacts: async () => ({}), logEvent: async (job: string, _a: unknown, type: string, _s: unknown, details: unknown) => { writes.push(job); (tables["workflow_events"] ??= []).push({ job_id: job, event_type: type, details, created_at: new Date().toISOString() }); } }));
mock.module("../src/lib/piesa-times-reminder.server", () => ({ remindTradeToOfferTimes: async () => { texts++; } }));
const { sweepCoordination } = await import("../src/lib/allocation.server");
beforeEach(() => {
  writes.length = 0; texts = 0;
  for (const k of Object.keys(tables)) delete tables[k];
  tables["jobs"] = [{ id: "test-a", source: "qa_test" }, { id: "test-b", source: "qa_test" }, { id: "real", source: "website" }];
  tables["job_assignments"] = ["test-a", "test-b", "real"].map(id => ({ id: `a-${id}`, active: true, booking_confirmed_at: null }));
  tables["contact_releases"] = ["test-a", "test-b", "real"].map(id => ({ job_id: id, assignment_id: `a-${id}`, job_assignment_id: `a-${id}`, visit_kind: "piesa", revoked_at: null, released_at: new Date(Date.now() - 25 * 3600000).toISOString() }));
  tables["appointment_proposals"] = []; tables["workflow_events"] = [];
});
test("ONE TEST job filter leaves another TEST job and real job untouched, even on replay", async () => {
  expect(await sweepCoordination(null, "test-a")).toEqual({ reminders: 1 });
  expect(await sweepCoordination(null, "test-a")).toEqual({ reminders: 0 });
  expect(writes).toEqual(["test-a"]);
});
test("scoped PIESA check never invokes the text sender", async () => {
  await sweepCoordination(null, "test-a");
  expect(texts).toBe(0);
});
test("real or empty filter fails closed before writes", async () => {
  await expect(sweepCoordination(null, "real")).rejects.toThrow("one TEST job");
  await expect(sweepCoordination(null, "")).rejects.toThrow("TEST job id");
  expect(writes).toEqual([]);
});