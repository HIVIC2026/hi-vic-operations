import { beforeEach, expect, mock, test } from "bun:test";
let role = "qa_office", reads: string[] = [], calls: string[] = [];
mock.module("@tanstack/react-start", () => ({ createServerFn: () => {
  let validate = (value: unknown) => value;
  const chain = { middleware: () => chain, inputValidator: (fn: typeof validate) => { validate = fn; return chain; },
    handler: (fn: (args: unknown) => unknown) => (args: { data: unknown; context: unknown }) => fn({ ...args, data: validate(args.data) }) };
  return chain;
} }));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: Error, requireAdmin: async () => { if (role !== "admin") throw new Error("Admin only."); } }));
mock.module("../src/lib/qa-office-access.server", () => ({ requireOfficeJob: async (_sb: unknown, job: string) => {
  calls.push(job); if (role === "qa_office" && job !== "00000000-0000-4000-8000-000000000001") throw new Error("Only TEST jobs."); return role;
} }));
mock.module("../src/lib/office-job-page.server", () => ({ loadJobPage: async (id: string) => { reads.push("job:" + id); return { id }; }, loadJobMoney: async (id: string) => { reads.push("money:" + id); return { id }; } }));
mock.module("../src/lib/office-actions.server", () => ({ logCallOrNote: async (id: string) => { reads.push("note:" + id); return { id }; } }));
mock.module("../src/lib/office-needs-snapshot.server", () => ({ getNeedsMeSnapshot: async () => { reads.push("needs"); return { total: 7 }; }, getEnquiriesListServed: async () => { reads.push("enquiries"); return { rows: [{ id: "real" }] }; }, getActiveJobsListServed: async () => { reads.push("active"); return { rows: [{ id: "real" }] }; } }));
const functions = await import("../src/lib/office-screens.functions");
const invoke = (fn: unknown, data: unknown) => (fn as (args: unknown) => Promise<unknown>)({ data, context: { supabase: {}, userId: "office" } });
const testJob = "00000000-0000-4000-8000-000000000001", realJob = "00000000-0000-4000-8000-000000000002";
beforeEach(() => { role = "qa_office"; reads = []; calls = []; });
for (const [name, fn, extra] of [
  ["job page", functions.getOfficeJobPage, {}], ["job Money card", functions.getOfficeJobMoney, {}],
  ["recorded call/note", functions.logOfficeCallOrNote, { what: "note", who: "owner", said: "TEST note", waitingFor: "nothing" }],
] as const) {
  test(`${name}: real id refused before reader/action; TEST allowed; admin unchanged`, async () => {
    await expect(invoke(fn, { jobId: realJob, ...extra })).rejects.toThrow("Only TEST"); expect(reads).toEqual([]);
    expect(await invoke(fn, { jobId: testJob, ...extra })).toEqual({ id: testJob }); expect(reads).toHaveLength(1);
    role = "admin"; expect(await invoke(fn, { jobId: realJob, ...extra })).toEqual({ id: realJob }); expect(reads).toHaveLength(2);
  });
}
for (const [name, fn, data] of [
  ["Needs me", functions.getNeedsMePage, {}], ["Enquiries", functions.getEnquiriesList, {}], ["Active jobs", functions.getActiveJobsList, {}],
] as const) test(`${name}: unconverted area refused before global cache; admin unchanged`, async () => {
  await expect(invoke(fn, data)).rejects.toThrow("Admin only"); expect(reads).toEqual([]);
  role = "admin"; await invoke(fn, data); expect(reads).toHaveLength(1);
});
test("unconverted Cancel and mark TEST remain denied before mutation", async () => {
  for (const fn of [functions.cancelOfficeJob, functions.markOfficeJobTest]) await expect(invoke(fn, { jobId: realJob, reason: "TEST reason" })).rejects.toThrow("Admin only");
  expect(reads).toEqual([]); expect(calls).toEqual([]);
});