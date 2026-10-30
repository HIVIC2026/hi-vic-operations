import { expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
const tables: Tables = {
  jobs: [{ id: "own", source: "qa_test", created_at: "2026-10-27T12:01:00Z" }, { id: "other", source: "qa_test", created_at: "2026-10-27T12:01:00Z" }, { id: "real", source: "website", created_at: "2026-10-27T12:01:00Z" }, { id: "old", source: "qa_test", created_at: "2026-10-26T12:01:00Z" }],
  partner_offers: ["own", "other", "real", "old"].map(job_id => ({ id: job_id, job_id, kind: "ready_check", status: "pending" })),
  job_assignments: [], businesses: [],
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: memoryPostgrest(tables) }));
const { cleanupJourney } = await import("../src/lib/journey.server");
test("cleanup cancels only this run's pending TEST offers; older TEST and real offers stay untouched", async () => {
  const ctx = { jobId: "own", startedAt: "2026-10-27T12:00:00Z", notes: {}, calculatorInterestId: null } as unknown as Parameters<typeof cleanupJourney>[0];
  await cleanupJourney(ctx);
  expect(tables.partner_offers?.find(o => o.job_id === "own")?.status).toBe("withdrawn");
  for (const jobId of ["other", "real", "old"]) {
    if (jobId !== "other") await cleanupJourney({ ...ctx, jobId });
    expect(tables.partner_offers?.find(o => o.job_id === jobId)?.status).toBe("pending");
  }
  expect(tables.jobs?.find(j => j.id === "own")?.stage).toBe("cancelled");
});