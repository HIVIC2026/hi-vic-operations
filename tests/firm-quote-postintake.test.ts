import { expect, mock, test } from "bun:test";
let intelligence = 0;
let otherWork = 0;
const patches: Record<string, unknown>[] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  rpc: async () => ({ data: [{ id: "work", job_id: "job", attempts: 1, locked_at: "lease", facts_version: "firm_quote_requested", reason: "firm quote requested", work_type: "firm_quote_size_check" }], error: null }),
  from(table: string) {
    if (table !== "post_intake_work") { otherWork++; throw new Error("unexpected initial processing"); }
    const q = { update: (patch: Record<string, unknown>) => { patches.push(patch); return q; }, eq: () => q,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) };
    return q;
  },
} }));
mock.module("../src/lib/firm-quote-work.server", () => ({ processFirmQuoteSizeCheck: async (jobId: string) => { expect(jobId).toBe("job"); intelligence++; } }));
mock.module("../src/lib/lead-email-routing.server", () => ({ maybeAutoRouteLeadEmail: () => { otherWork++; throw new Error("no owner email route"); } }));
mock.module("../src/lib/autoadvance.server", () => ({ autoAdvanceJob: () => { otherWork++; throw new Error("no progression"); } }));
const { processPostIntakeWork } = await import("../src/lib/postintake.server");
test("actual post-intake dispatcher completes size work without initial Gate 1 or email follow-through", async () => {
  const result = await processPostIntakeWork();
  expect(result.results).toEqual([{ id: "work", job_id: "job", status: "complete" }]);
  expect(intelligence).toBe(1); expect(otherWork).toBe(0); expect(patches[0]?.status).toBe("complete");
});