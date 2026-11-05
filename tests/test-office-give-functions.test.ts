// Jo 5 Nov 2026: Choose installer "Give to installer" for the TEST office. The server functions check every job and the
// business through the TEST-office guards BEFORE the in-house server runs, and pass only that checked scope on. The real
// office (admin) path calls the in-house server exactly as before (no TEST scope).
import { expect, mock, test, beforeEach } from "bun:test";
let role: "admin" | "qa_office" = "qa_office";
const testJob = "00000000-0000-4000-8000-000000000001", realJob = "00000000-0000-4000-8000-000000000002";
const testBiz = "00000000-0000-4000-8000-000000000003", realBiz = "00000000-0000-4000-8000-000000000004";
const calls: { name: string; args: unknown[] }[] = [];
mock.module("@tanstack/react-start", () => ({ createServerFn: () => { let validate = (d: unknown) => d; const chain = { middleware: () => chain, inputValidator: (fn: unknown) => { const v = fn as { parse?: (d: unknown) => unknown }; validate = typeof fn === "function" ? fn as typeof validate : (d) => v.parse!(d); return chain; }, handler: (fn: (args: unknown) => unknown) => (args: { data: unknown; context: unknown }) => fn({ ...args, data: validate(args.data) }) }; return chain; } }));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
mock.module("../src/lib/workflow.server", () => ({ requireAdmin: async () => { if (role !== "admin") throw new Error("Admin only"); } }));
mock.module("../src/lib/qa-office-access.server", () => ({
  requireOfficeIdentity: async () => role,
  requireOfficeJob: async (_sb: unknown, jobId: string) => { if (role === "qa_office" && jobId !== testJob) throw new Error("Only fully isolated TEST jobs are available to TEST office."); return role; },
  requireOfficeBusiness: async (_sb: unknown, id: string) => { if (role === "qa_office" && id !== testBiz) throw new Error("Only fully isolated TEST businesses are available to TEST office."); },
  officeTestBusinessIds: async () => { if (role !== "qa_office") throw new Error("Dedicated TEST office required."); return [testBiz]; },
}));
mock.module("../src/lib/in-house-batch.server", () => ({
  sendInHouseBatch: async (...args: unknown[]) => { calls.push({ name: "send", args }); return { sent: [], refused: [] }; },
  inHouseGiveForJob: async (...args: unknown[]) => { calls.push({ name: "give", args }); return null; },
}));
const fns = await import("../src/lib/in-house-batch.functions");
const { TEST_GIVE_REFUSED } = await import("../src/lib/in-house-batch.core");
const invoke = (fn: unknown, data: unknown) => (fn as (args: unknown) => Promise<unknown>)({ data, context: { supabase: {}, userId: "actor" } });
beforeEach(() => { role = "qa_office"; calls.length = 0; });

test("TEST office give: every job and the business are checked, then only that scope is passed to the server", async () => {
  await invoke(fns.allocateInHouseBatch, { businessId: testBiz, jobIds: [testJob, testJob] });
  expect(calls).toEqual([{ name: "send", args: [{ businessId: testBiz, jobIds: [testJob, testJob], actorId: "actor" }, { testOffice: { jobIds: [testJob], businessIds: [testBiz] } }] }]);
});
test("TEST office give with a real job is refused before the server runs", async () => {
  await expect(invoke(fns.allocateInHouseBatch, { businessId: testBiz, jobIds: [testJob, realJob] })).rejects.toThrow(TEST_GIVE_REFUSED);
  expect(calls).toEqual([]);
});
test("TEST office give to a real business is refused before the server runs", async () => {
  await expect(invoke(fns.allocateInHouseBatch, { businessId: realBiz, jobIds: [testJob] })).rejects.toThrow(TEST_GIVE_REFUSED);
  expect(calls).toEqual([]);
});
test("TEST office job-page give offer: TEST job only, TEST businesses only", async () => {
  await invoke(fns.getInHouseGiveForJob, { jobId: testJob });
  expect(calls).toEqual([{ name: "give", args: [testJob, { testOffice: { jobIds: [testJob], businessIds: [testBiz] } }] }]);
  calls.length = 0;
  await expect(invoke(fns.getInHouseGiveForJob, { jobId: realJob })).rejects.toThrow(TEST_GIVE_REFUSED);
  expect(calls).toEqual([]);
});
test("real office (admin) path unchanged: no TEST scope is ever passed", async () => {
  role = "admin";
  await invoke(fns.allocateInHouseBatch, { businessId: realBiz, jobIds: [realJob] });
  await invoke(fns.getInHouseGiveForJob, { jobId: realJob });
  expect(calls).toEqual([{ name: "send", args: [{ businessId: realBiz, jobIds: [realJob], actorId: "actor" }] }, { name: "give", args: [realJob] }]);
});
test("the legacy batches page and take-back stay admin-only", async () => {
  await expect(invoke(fns.getInHouseBatches, undefined)).rejects.toThrow("Admin only");
  await expect(invoke(fns.takeBackInHouseJob, { jobId: testJob, reason: "x" })).rejects.toThrow("Admin only");
  expect(calls).toEqual([]);
});
