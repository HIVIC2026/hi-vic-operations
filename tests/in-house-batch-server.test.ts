import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as rules from "../src/lib/in-house-batch.core";
import * as inHouse from "../src/lib/in-house.core";
import * as membership from "../src/lib/mitti-membership.core";

// Execute real helper against fixtures, not a hosted client; no provider/network imports are allowed.
function fixture(failedTable?: string, failPage = -1) {
  const calls: { table: string; filters: unknown[][] }[] = [];
  const rpcCalls: unknown[] = [];
  const emailCalls: string[] = [];
  const data: Record<string, unknown[]> = {
    jobs: [{ id: "j", job_number: "HV-1", property_id: "p", stage: "preliminary_estimate_ready", source: "base44", deleted_at: null }],
    businesses: [{ id: "b", name: "Rapid", trading_name: "Rapid Insulation", in_house: true, is_active: true, service_postcodes: ["3199"], covers_all_victoria: false }],
    lead_campaign_responses: [{ job_id: "j", spot_saved_at: "2026-10-30" }], properties: [{ id: "p", address_line: "1 Example Street", postcode: "3199" }],
    partner_workers: [{ profile_id: "i", trade_role: "installer",created_at:"2026-10-01" },{ profile_id: "e", trade_role: "electrician", email: "e@example.invalid",created_at:"2026-10-01" }],
    business_members: [{ user_id: "i" }, { user_id: "e" }],
    partner_relationships: [{ electrician_business_id: "b", is_primary: true, preferred: true, active: true }],
    profiles: [{ id: "e", email: "e@example.invalid", mitti_checked_email: "e@example.invalid", mitti_user_id: "m", mitti_checked_at: "2026-10-30" }],
  };
  const admin = { from(table: string) {
    const call = { table, filters: [] as unknown[][] }; calls.push(call);
    const q: any = { then(resolve: (value: unknown) => unknown) {
      let result = data[table] ?? [];
      for (const [key, column, ids] of call.filters) if (key === "in") result = result.filter((r: any) => r[column as string] === undefined || (ids as unknown[]).includes(r[column as string]));
      const range = call.filters.find(([key]) => key === "range");
      const offset = range ? Number(range[1]) : 0;
      result = result.slice(offset, range ? Number(range[2]) + 1 : 1000);
      if (table === "businesses" && call.filters.some(([key, col, value]) => key === "eq" && col === "in_house" && value === true)) result = result.filter((b: any) => b.in_house === true);
      return Promise.resolve({ data: result, error: (table === failedTable || (table === "jobs" && offset === failPage)) ? { message: "read unavailable" } : null }).then(resolve); } };
    for (const key of ["select","in","eq","is","not","neq","order","range"]) q[key] = (...args: unknown[]) => { call.filters.push([key,...args]); return q; };
    return q;
  }, async rpc(name: string, input: unknown) { rpcCalls.push({ name, input }); return { data: { sent: true }, error: null }; } };
  const dependencies: Record<string, unknown> = {
    "@/integrations/supabase/client.server": { supabaseAdmin: admin }, "./in-house-batch.core": rules,
    "./in-house-batch-email.server": { sendInHousePartnerCall:async(id:string)=>{expect(rpcCalls.length).toBeGreaterThan(0);emailCalls.push(id);return "draft";} },
    "./sweep-batch.core": { chunkIds: (ids: unknown[], n: number) => Array.from({length:Math.ceil(ids.length/n)},(_,i)=>ids.slice(i*n,(i+1)*n)) },
    "./in-house.core": inHouse, "./mitti-membership.core": membership, "./melbourne-time.core": { melbourneToday: () => "2026-10-30" },
    "./installer-paid-electricians.server": { inHouseFactsFor: async () => ({ approvedElectricianWorkers: 1, hasActiveRateCardWithPiesa: true, mittiElectricianLogins: 1, mittiAccountInvited: true }) },
  };
  const output: any = {};
  const source = ts.transpile(readFileSync("src/lib/in-house-batch.server.ts","utf8"), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 });
  new Function("exports","require",source)(output,(name: string) => { if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`); return dependencies[name]; });
  return { api: output, data, calls, rpcCalls, emailCalls };
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
  expect(f.emailCalls).toEqual(["j"]);
  expect(f.rpcCalls[0]).toMatchObject({ name: "allocate_in_house_batch_job",input: { _business: "b",_job: "j",_actor: "office",_installer: "i",_electrician: "e" } });
});
test("failed reads propagate and never invoke an allocation", async () => {
  for (const table of ["jobs","businesses","job_assignments","lead_campaign_responses","customer_email_optouts","partner_workers","profiles"]) {
    const f = fixture(table);
    await expect(f.api.sendInHouseBatch({ businessId: "b",jobIds: ["j"],actorId: "office" })).rejects.toThrow("read unavailable");
    expect(f.rpcCalls).toHaveLength(0);
  }
});
test("electrician is earliest created approved worker; business relationship markers never select a different worker",async()=>{
  const f=fixture();
  f.data.partner_workers=[{profile_id:"i",trade_role:"installer",created_at:"2026-10-01"},{profile_id:"new",trade_role:"electrician",created_at:"2026-10-29",email:"new@example.invalid"},{profile_id:"e",trade_role:"electrician",created_at:"2026-10-01",email:"e@example.invalid"}];
  f.data.business_members?.push({user_id:"new"});f.data.profiles?.push({id:"new",email:"new@example.invalid",mitti_checked_email:"new@example.invalid",mitti_user_id:"n",mitti_checked_at:"2026-10-30"});
  await f.api.sendInHouseBatch({businessId:"b",jobIds:["j"],actorId:"office"});
  expect(f.rpcCalls[0]).toMatchObject({input:{_electrician:"e"}});
  expect(f.calls.some(c=>c.table==="partner_relationships")).toBe(false);
});
test("no self-team uses the partner's own worker without fabricating preferences", async () => {
  const f = fixture(); f.data.partner_relationships = [];
  expect((await f.api.sendInHouseBatch({ businessId: "b",jobIds: ["j"],actorId: "office" })).sent).toEqual(["j"]);
  expect(f.rpcCalls[0]).toMatchObject({ input: { _business: "b", _electrician: "e" } });
});
test("out-of-area and missing electrician membership are refused without writes", async () => {
  const f = fixture(); f.data.profiles=[];
  expect((await f.api.sendInHouseBatch({ businessId: "b",jobIds: ["j"],actorId: "office" })).refused).toHaveLength(1);
  expect(f.rpcCalls).toHaveLength(0);
  const outside = fixture(); outside.data.properties=[{ id: "p",postcode: "3000" }];
  expect((await outside.api.sendInHouseBatch({ businessId: "b",jobIds: ["j"],actorId: "office" })).refused).toEqual([{ jobId: "j",reason: "Outside this partner's coverage" }]);
  expect(outside.rpcCalls).toHaveLength(0);
});
test("payee-only Reinsulate is absent from batch partners/suggestions and send refuses before any allocation", async () => {
  const f = fixture();
  f.data.businesses = [{ id: "b", name: "Reinsulate", in_house: false, pays_own_electricians: true, is_active: true, service_postcodes: ["3199"] }];
  const screen = await f.api.loadInHouseBatches();
  expect(screen.partners).toEqual([]); expect(screen.suggestions).toEqual([]);
  expect(await f.api.sendInHouseBatch({ businessId: "b", jobIds: ["j"], actorId: "office" })).toEqual({ sent: [], refused: [{ jobId: "j", reason: "Partner is not active in-house" }] });
  expect(f.rpcCalls).toEqual([]); expect(f.emailCalls).toEqual([]);
});

function scaleFixture(failPage = -1) {
  const f = fixture(undefined, failPage);
  f.data.jobs = Array.from({ length: 1250 }, (_, i) => ({ id: `j${String(i).padStart(4,"0")}`, job_number: `HV-${i}`, property_id: `p${i}`, stage: "preliminary_estimate_ready", source: "base44", deleted_at: null }));
  f.data.properties = f.data.jobs.map((j: any) => ({ id: j.property_id, postcode: "3199", address_line: "TEST street" }));
  f.data.lead_campaign_responses = f.data.jobs.map((j: any) => ({ job_id: j.id, spot_saved_at: "2026-10-30" }));
  return f;
}
test("batch loader considers all 1250 jobs and every id filter is bounded at 200", async () => {
  const f = scaleFixture(); const screen = await f.api.loadInHouseBatches();
  expect(screen.jobs).toHaveLength(1250); expect(screen.suggestions[0].jobIds).toHaveLength(1250);
  expect(screen.suggestions[0].jobIds).toContain("j1249");
  for (const c of f.calls) for (const [key, _column, ids] of c.filters) if (key === "in") expect((ids as unknown[]).length).toBeLessThanOrEqual(200);
});
test("batch loader refuses partial results when the second jobs page fails", async () => {
  const f = scaleFixture(200);
  await expect(f.api.loadInHouseBatches()).rejects.toThrow("read unavailable");
  expect(f.rpcCalls).toEqual([]);
});
