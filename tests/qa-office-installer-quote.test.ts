import { beforeEach, expect, mock, test } from "bun:test";
// Jo 28 Oct 22:23 UTC: TEST office may view/send installer quotes on TEST jobs only.
let role = "qa_office", sends: string[] = [], reads: string[] = [];
const testJob = "00000000-0000-4000-8000-000000000001", realJob = "00000000-0000-4000-8000-000000000002", quoteId = "00000000-0000-4000-8000-000000000009";
const REFUSAL = "Only fully isolated TEST jobs are available to TEST office.";
mock.module("@tanstack/react-start", () => ({ createServerFn: () => {
  let validate = (d: unknown) => d;
  const chain = { middleware: () => chain, inputValidator: (fn: typeof validate) => { validate = fn; return chain; }, handler: (fn: (a: unknown) => unknown) => (a: { data: unknown; context: unknown }) => fn({ ...a, data: validate(a.data) }) };
  return chain;
} }));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: Error, logEvent: async () => {}, requireAdmin: async () => { if (role !== "admin") throw new Error("Admin only"); } }));
mock.module("../src/lib/qa-office-access.server", () => ({ requireOfficeJob: async (_sb: unknown, jobId: string) => { if (role === "qa_office" && jobId !== testJob) throw new Error(REFUSAL); if (role === "none") throw new Error("Admin only"); return role; } }));
const chainable = (result: unknown) => { const o: Record<string, unknown> = { then: (f: (x: unknown) => unknown) => Promise.resolve(result).then(f) }; for (const m of ["select", "eq", "in", "order", "limit"]) o[m] = () => o; o.single = async () => result; o.maybeSingle = async () => ({ data: null, error: null }); return o; };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => { reads.push(t); return chainable({ data: t === "jobs" ? { channel: "installer_sourced" } : null, error: null }); } } }));
mock.module("../src/lib/office-quote-review.server", () => ({ sendOfficeReviewedQuote: async (jobId: string) => { sends.push(jobId); return { delivery: "ready_to_send" }; }, officeQuoteBlockers: async () => [] }));
const fns = await import("../src/lib/installer-quote.functions");
const policy = await import("../src/lib/qa-office-policy.core");
const invoke = (fn: unknown, data: unknown) => (fn as (a: unknown) => Promise<unknown>)({ data, context: { supabase: {}, userId: "office" } });
beforeEach(() => { role = "qa_office"; sends = []; reads = []; });

test("allowlist names exactly the quote card load and send; other intake functions stay denied", () => {
  for (const n of ["getInstallerQuoteDraft", "sendInstallerQuote"]) expect(policy.qaOfficeFunctionAllowed("src/lib/installer-quote.functions.ts", n)).toBe(true);
  for (const n of ["getInstallerIntake", "officeIntakeAction", "clearSiteConditionsHold"]) expect(policy.qaOfficeFunctionAllowed("src/lib/installer-quote.functions.ts", n)).toBe(false);
});
test("TEST office on a TEST job: draft loads and send runs the normal guarded path", async () => {
  expect(await invoke(fns.getInstallerQuoteDraft, { jobId: testJob })).toMatchObject({ applies: true, quote: null });
  expect(await invoke(fns.sendInstallerQuote, { jobId: testJob, quoteId })).toEqual({ delivery: "ready_to_send" });
  expect(sends).toEqual([testJob]);
});
test("TEST office on a real job is refused before any read or send", async () => {
  await expect(invoke(fns.getInstallerQuoteDraft, { jobId: realJob })).rejects.toThrow(REFUSAL);
  await expect(invoke(fns.sendInstallerQuote, { jobId: realJob, quoteId })).rejects.toThrow(REFUSAL);
  expect(reads).toEqual([]); expect(sends).toEqual([]);
});
test("real office unchanged: admin loads and sends real jobs; non-office still refused", async () => {
  role = "admin";
  expect(await invoke(fns.getInstallerQuoteDraft, { jobId: realJob })).toMatchObject({ applies: true });
  expect(await invoke(fns.sendInstallerQuote, { jobId: realJob, quoteId })).toEqual({ delivery: "ready_to_send" });
  role = "none";
  await expect(invoke(fns.sendInstallerQuote, { jobId: realJob, quoteId })).rejects.toThrow("Admin only");
});
