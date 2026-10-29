// Final review fix: spec C3 (owner phone hidden once this trade's own visits are done) is electrician-only. An
// installer on a Home Insulation Victoria lead keeps the owner's phone; the electrician still loses it.
import { expect, mock, test } from "bun:test";

let role = "installer";
const row = { id: "j1", channel: "hivic", stage: "installation_scheduling", property_id: "p1", owner_name: "Helen Test", owner_phone: "0400 000 001", owner_email: "h@example.test" };
const chain = (table: string): Record<string, unknown> => {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in"]) c[m] = () => c;
  c.maybeSingle = async () => ({ data: table === "job_overview" ? row : null, error: null });
  // own bookings: every visit done, so contactVisible would say no
  c.then = (r: (v: unknown) => unknown) => Promise.resolve({ data: table === "bookings" ? [{ status: "completed" }] : [], error: null }).then(r);
  return c;
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => chain(t), rpc: async () => ({ data: true, error: null }) } }));
mock.module("../src/lib/workflow.server", () => ({ requireJobRole: async () => role, WorkflowError: Error }));
mock.module("../src/lib/trade-view.server", () => ({ requireTradeJob: async () => ({ biz: { id: "b1" } }) }));

const { jobOverviewFor } = await import("../src/lib/job-overview.server");

test("installer on an HIV lead keeps owner_phone at installation_scheduling", async () => {
  role = "installer";
  const r = await jobOverviewFor({} as never, "u1", "j1");
  expect(r.row.owner_phone).toBe("0400 000 001");
});
test("electrician still loses owner_phone once their visits are done", async () => {
  role = "electrician";
  const r = await jobOverviewFor({} as never, "u1", "j1");
  expect(r.row.owner_phone).toBeNull();
});
