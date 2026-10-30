import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as rules from "../src/lib/in-house-batch.core";
import * as inHouse from "../src/lib/in-house.core";
import * as teaming from "../src/lib/teaming.core";
import * as membership from "../src/lib/mitti-membership.core";

// Execute real helper against fixtures, not a hosted client; no provider/network imports are allowed.
function fixture(failedTable?: string) {
  const calls: { table: string; filters: unknown[][] }[] = [];
  const rpcCalls: unknown[] = [];
  const data: Record<string, unknown[]> = {
    jobs: [{ id: "j", job_number: "HV-1", property_id: "p", stage: "preliminary_estimate_ready", source: "base44", deleted_at: null }],
    businesses: [{ id: "b", name: "Rapid", trading_name: "Rapid Insulation", in_house: true, is_active: true, service_postcodes: ["3199"], covers_all_victoria: false }],
    lead_campaign_responses: [{ job_id: "j", spot_saved_at: "2026-10-30" }], properties: [{ id: "p", address_line: "1 Example Street", postcode: "3199" }],
    partner_workers: [{ profile_id: "i", trade_role: "installer" },{ profile_id: "e", trade_role: "electrician", email: "e@example.invalid" }],
    business_members: [{ user_id: "i" }, { user_id: "e" }],
    profiles: [{ id: "e", email: "e@example.invalid", mitti_checked_email: "e@example.invalid", mitti_user_id: "m", mitti_checked_at: "2026-10-30" }],
  };
  const admin = { from(table: string) {
    const call = { table, filters: [] as unknown[][] }; calls.push(call);
    const q: any = { then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: data[table] ?? [], error: table === failedTable ? { message: "read unavailable" } : null }).then(resolve); } };
    for (const key of ["select","in","eq","is","not","neq","order"]) q[key] = (...args: unknown[]) => { call.filters.push([key,...args]); return q; };
    return q;
  }, async rpc(name: string, input: unknown) { rpcCalls.push({ name, input }); return { data: { sent: true }, error: null }; } };
  const dependencies: Record<string, unknown> = {
    "@/integrations/supabase/client.server": { supabaseAdmin: admin }, "./in-house-batch.core": rules, "./teaming.core": teaming,
    "./in-house.core": inHouse, "./mitti-membership.core": membership, "./melbourne-time.core": { melbourneToday: () => "2026-10-30" },
    "./installer-paid-electricians.server": { inHouseFactsFor: async () => ({ approvedElectricianWorkers: 1, hasActiveRateCardWithPiesa: true, mittiElectricianLogins: 1 }) },
  };
  const output: any = {};
  const source = ts.transpile(readFileSync("src/lib/in-house-batch.server.ts","utf8"), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 });
  new Function("exports","require",source)(output,(name: string) => { if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; });
  return { api: output, data, calls, rpcCalls };
}
test("real loader excludes deleted/TEST jobs in its query and maps saved spots with opt-out protection", async () => {
  const f = fixture();
  const result = await f.api.loadInHouseBatches();
  expect(result.suggestions).toEqual([{ businessId: "b",jobIds: ["j"] }]);
  expect(f.calls.find(c => c.table === "jobs")?.filters).toContainEqual(["is","deleted_at",null]);
  expect(f.calls.find(c => c.table === "jobs")?.filters).toContainEqual(["neq","source","qa_test"]);
  f.data.customer_email_optouts = [{ job_id: "j" }];
  expect((await f.api.loadInHouseBatches()).suggestions).toEqual([]);
});
test("actual send uses same-business approved workers, binds actor and deduplicates job input", async () => {
  const f = fixture();
  expect(await f.api.sendInHouseBatch({ businessId: "b",jobIds: ["j","j"],actorId: "office" })).toEqual({ sent: ["j"],refused: [] });
  expect(f.rpcCalls).toHaveLength(1);
  expect(f.rpcCalls[0]).toMatchObject({ name: "allocate_in_house_batch_job",input: { _business: "b",_job: "j",_actor: "office",_installer: "i",_electrician: "e" } });
});
test("failed reads propagate and never invoke an allocation", async () => {
  for (const table of ["jobs","businesses","job_assignments","lead_campaign_responses","customer_email_optouts","partner_workers","profiles"]) {
    const f = fixture(table);
    await expect(f.api.sendInHouseBatch({ businessId: "b",jobIds: ["j"],actorId: "office" })).rejects.toThrow("read unavailable");
    expect(f.rpcCalls).toHaveLength(0);
  }
});
test("out-of-area and missing electrician membership are refused without writes", async () => {
  const f = fixture(); f.data.profiles=[];
  expect((await f.api.sendInHouseBatch({ businessId: "b",jobIds: ["j"],actorId: "office" })).refused).toHaveLength(1);
  expect(f.rpcCalls).toHaveLength(0);
  const outside = fixture(); outside.data.properties=[{ id: "p",postcode: "3000" }];
  expect((await outside.api.sendInHouseBatch({ businessId: "b",jobIds: ["j"],actorId: "office" })).refused).toEqual([{ jobId: "j",reason: "Outside this partner's coverage" }]);
  expect(outside.rpcCalls).toHaveLength(0);
});