import { expect, mock, test } from "bun:test";

// The 15-minute pull's PIISA-declaration pass must skip cancelled / deleted / QA-archived jobs (same rule as the
// forms pass, Jo 23 Oct). Cause of the 30 Oct HTTP 500: six cancelled TEST jobs with old simulated PIISA ids were
// still read from real Mitti every run and refused (400).
const jobs: Record<string, { id: string; stage: string; deleted_at: string | null; qa_archived_at: string | null }> = {
  open: { id: "open", stage: "installation_booked", deleted_at: null, qa_archived_at: null },
  cancelled: { id: "cancelled", stage: "cancelled", deleted_at: null, qa_archived_at: null },
  deleted: { id: "deleted", stage: "installation_booked", deleted_at: "2026-10-01", qa_archived_at: null },
  archived: { id: "archived", stage: "installation_booked", deleted_at: null, qa_archived_at: "2026-10-01" },
};

function from(table: string) {
  const f: { col?: string; vals?: string[] } = {};
  const b: Record<string, unknown> = {};
  const chain = () => b;
  Object.assign(b, {
    select: chain, eq: chain, neq: chain, is: chain, not: chain,
    in: (col: string, vals: string[]) => { f.col = col; f.vals = vals; return b; },
    then: (resolve: (v: unknown) => unknown) => {
      if (table === "workflow_events") return resolve({ data: Object.keys(jobs).map((job_id) => ({ job_id })), error: null });
      if (table === "jobs") return resolve({ data: (f.vals ?? []).map((id) => jobs[id]).filter(Boolean), error: null });
      return resolve({ data: [], error: null }); // no pending assessment / measurement forms
    },
  });
  return b;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));

const synced: string[] = [];
mock.module("../src/lib/piisa-declaration.server", () => ({
  syncPiisaDeclaration: async (jobId: string) => { synced.push(jobId); return { status: "pending", message: "pending" }; },
}));

test("PIISA pass skips cancelled, deleted and QA-archived jobs; open jobs are still pulled", async () => {
  const { syncPendingMitti } = await import("../src/lib/mitti.server");
  const calls: string[] = [];
  const rows = await syncPendingMitti(null, async (method, path) => { calls.push(`${method} ${path}`); return {}; });
  expect(synced).toEqual(["open"]);
  expect(rows).toEqual([{ jobId: "open", ok: true, message: "pending" }]);
  expect(calls).toEqual([]);
});
