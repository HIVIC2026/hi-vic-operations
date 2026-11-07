// firmQuoteJobIdsFor: the id-based batched firm-quote check (Office Send, dispatch backlog). Real module, own database stub.
import { beforeEach, expect, mock, test } from "bun:test";
let liveAt: string | null = null;
let failedTable: string | null = null;
const realJobs = [{ id: "j0", source: "base44", created_at: "2026-11-06T06:00:00Z" }, { id: "j1", source: "base44", created_at: "2026-11-06T06:00:00Z" }];
let testJobs: unknown[] | null = null;
const reads: string[] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from(table: string) {
  reads.push(table);
  const q: Record<string, unknown> = {};
  Object.assign(q, { select: () => q, eq: () => q, in: () => q, order: () => q, range: () => q, limit: () => q, maybeSingle: () => q,
    then: (resolve: (r: unknown) => unknown) => Promise.resolve(failedTable === table ? { data: null, error: { code: "42501", message: "denied" } }
      : { data: table === "workflow_settings" ? { firm_quote_flow_live_at: liveAt } : table === "jobs" ? (testJobs ?? realJobs) : [{ job_id: "j0", kind: "intake_media", mime_type: "image/jpeg", storage_path: "j0/intake/a.jpg" }], error: null }).then(resolve) });
  return q;
} } }));
const { firmQuoteJobIdsFor } = await import("../src/lib/firm-quote.server?ids-batched");
beforeEach(() => { liveAt = null; failedTable = null; testJobs = null; reads.length = 0; });
test("switch off: real jobs never qualify (TEST exception still needs the job facts)", async () => {
  expect(await firmQuoteJobIdsFor(["j0", "j1"])).toEqual(new Set());
  expect(reads[0]).toBe("workflow_settings");
});
test("switch off: a TEST-exception job (qa_test, TEST owner email, after the cutoff) with media still qualifies", async () => {
  testJobs = [{ id: "j0", source: "qa_test", created_at: "2026-11-07T00:00:00Z", owners: { email: "qa.owner@hivic-test.example" } }];
  expect([...await firmQuoteJobIdsFor(["j0"])]).toEqual(["j0"]);
});
test("switch on: jobs and media read once per chunk of 100, not per job; only jobs with owner media qualify", async () => {
  liveAt = "2026-11-06T06:00:00Z";
  expect([...await firmQuoteJobIdsFor(Array.from({ length: 150 }, (_, i) => `j${i}`))]).toEqual(["j0"]);
  expect(reads.filter(t => t === "jobs")).toHaveLength(2);
  expect(reads.filter(t => t === "documents")).toHaveLength(2);
});
test("a failed jobs or media read blocks (fail closed)", async () => {
  liveAt = "2026-11-06T06:00:00Z";
  failedTable = "jobs"; await expect(firmQuoteJobIdsFor(["j0"])).rejects.toThrow();
  failedTable = "documents"; await expect(firmQuoteJobIdsFor(["j0"])).rejects.toThrow();
});
