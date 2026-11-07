// Jo 7 Nov 2026 (~9:50am): the TEST office may see TEST job details in Choose installer, but must still never see a
// real job. The job-details read (getJobFile) and the Give read refuse a real job before any job data is built.
import { expect, mock, test, beforeEach } from "bun:test";
const testJob = "00000000-0000-4000-8000-000000000011", realJob = "00000000-0000-4000-8000-000000000012";
let qaOffice = true;
const built: { jobId: string; role: string }[] = [];
mock.module("@tanstack/react-start", () => ({ createServerFn: () => { let validate = (d: unknown) => d; const chain = { middleware: () => chain, inputValidator: (fn: unknown) => { validate = fn as typeof validate; return chain; }, handler: (fn: (args: unknown) => unknown) => (args: { data: unknown; context: unknown }) => fn({ ...args, data: validate(args.data) }) }; return chain; } }));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
mock.module("../src/lib/office-boundary-context", () => ({ officeBoundaryFor: () => (qaOffice ? { roles: ["qa_office"] } : undefined) }));
mock.module("../src/lib/workflow.server", () => ({
  requireAdmin: async () => { if (qaOffice) throw new Error("Admin only"); },
  requireJobRole: async () => { if (qaOffice) throw new Error("Not allowed"); return "admin"; },
}));
mock.module("../src/lib/file-links.server", () => ({ signFile: async () => null }));
mock.module("../src/lib/qa-office-access.server", () => ({
  requireOfficeJob: async (_sb: unknown, jobId: string) => { if (jobId !== testJob) throw new Error("Only fully isolated TEST jobs are available to TEST office."); return "qa_office"; },
}));
mock.module("../src/lib/jobfile.server", () => ({ buildJobFile: async (jobId: string, role: string) => { built.push({ jobId, role }); return { jobId }; } }));
const { getJobFile } = await import("../src/lib/jobfile.functions");
const invoke = (jobId: string) => (getJobFile as unknown as (a: unknown) => Promise<unknown>)({ data: { jobId }, context: { supabase: {}, userId: "qa-office" } });
beforeEach(() => { qaOffice = true; built.length = 0; });

test("TEST office sees a TEST job's details in Choose installer", async () => {
  await expect(invoke(testJob)).resolves.toEqual({ jobId: testJob });
  expect(built).toEqual([{ jobId: testJob, role: "admin" }]);
});
test("TEST office still cannot see a real job: refused before any job details are built", async () => {
  await expect(invoke(realJob)).rejects.toThrow("Only fully isolated TEST jobs");
  expect(built).toEqual([]);
});
test("real office path unchanged: normal job-role check, no TEST check", async () => {
  qaOffice = false;
  await expect(invoke(realJob)).resolves.toEqual({ jobId: realJob });
  expect(built).toEqual([{ jobId: realJob, role: "admin" }]);
});
