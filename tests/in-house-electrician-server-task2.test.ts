import { expect, test } from "bun:test";
import ts from "typescript";
import { readFileSync } from "node:fs";
import * as compliance from "../src/lib/worker-compliance.core";
function fixture() {
  const worker = { id: "w", business_id: "b", profile_id: "electrician", full_legal_name: "Example Electrician", email: "e@example.invalid", trade_role: "electrician", approval_status: "approved", removed_at: null, licence_number: "A123", rec_number: "REC456", licence_expires_on: "2099-01-01", licence_verified_at: "2026-11-01" };
  const forms: unknown[] = [], writes: unknown[] = [], links: unknown[][] = [];
  let access = true;
  const admin = { from(table: string) {
    const q: any = {};
    let filters: unknown[][] = [];
    for (const key of ["select","eq","is","order","limit","range"]) q[key] = (...args: unknown[]) => { filters.push([key,...args]); return q; };
    q.maybeSingle = q.single = async () => ({ error: null, data: table === "partner_workers" ? (filters.some(x => x[1] === "business_id" && x[2] !== worker.business_id) ? null : worker) : table === "business_members" ? (access ? { user_id: "owner" } : null) : table === "assessments" ? { external_mitti_id: "A3" } : table === "workflow_events" ? { details: { worker_id: "w" } } : table === "job_assignments" ? { business_id: "b", user_id: "electrician" } : {source:"base44"} });
    q.then = (resolve: any) => Promise.resolve({data:[worker],error:null}).then(resolve);
    return q;
  }, async rpc(name: string, args: unknown) {writes.push({name,args});return {error:null,data:{already_allocated:false}};} };
  const deps: Record<string, unknown> = {
    "@/integrations/supabase/client.server": {supabaseAdmin:admin}, "./job-facts.server":{jobAdmin:admin}, "./worker-compliance.core":compliance,
    "./in-house-suppression.server":{readInHouseDispatchState:async()=>({failed:false,held:new Set(["j"])})},
    "./fixes-day.server":{existingRectificationForm:async()=>({auditId:"A4",closed:false})},
    "./electrician-link.server":{linkAfterAllocation:async(...a:unknown[])=>{links.push(a);}},
    "./mitti.server":{realMittiCall:()=>{},findMittiUserByEmail:async()=>"mitti-e",reassignMittiFormTo:async(p:unknown)=>forms.push(p)},
  };
  const api: any = {};
  return {worker,forms,writes,links,deny:()=>{access=false;},load:()=>{new Function("exports","require",ts.transpile(readFileSync("src/lib/in-house-electrician.server.ts","utf8"),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}))(api,(name:string)=>{if(!(name in deps))throw new Error(`Unexpected dependency ${name}`);return deps[name];});return api;}};
}
test("allocate unverified refuses with no assignment or form handover",async()=>{const f=fixture();f.worker.licence_verified_at="";await expect(f.load().allocateElectrician("j","owner","w")).rejects.toThrow("Electrician not verified");expect(f.writes).toEqual([]);expect(f.forms).toEqual([]);});
test("another business worker or user cannot allocate",async()=>{const f=fixture();f.worker.business_id="other";await expect(f.load().allocateElectrician("j","owner","w")).rejects.toThrow("That electrician is not on your Team");expect(f.writes).toEqual([]);const g=fixture();g.deny();await expect(g.load().allocateElectrician("j","outsider","w")).rejects.toThrow("This job is not assigned to your business");expect(g.forms).toEqual([]);});
test("verified allocation updates atomic assignment and hands A3 and A4 to selected person",async()=>{const f=fixture();await f.load().allocateElectrician("j","owner","w");expect(f.writes).toEqual([{name:"allocate_team_electrician",args:{_job:"j",_actor:"owner",_worker:"w"}}]);expect(f.forms).toEqual([
  {jobId:"j",auditId:"A3",kind:"piesa",mittiUserId:"mitti-e",email:"e@example.invalid",actorId:"owner"},
  {jobId:"j",auditId:"A4",kind:"rectification",mittiUserId:"mitti-e",email:"e@example.invalid",actorId:"owner"},
]);});
test("held booking refuses missing verification and remains read-only",async()=>{const f=fixture();f.worker.licence_verified_at="";expect(await f.load().inHousePiesaBookingBlockerFor("j")).toBe("Add a verified electrician to your Team before booking the safety check.");expect(f.writes).toEqual([]);expect(f.forms).toEqual([]);});
// Fix wave C1 (3 Nov 2026): electricians never log in, so a verified electrician with no profile and no Team login is
// still allowed, selectable and allocatable; "already allocated" / selected follows the latest in_house_electrician_allocated event.
test("C1: a verified electrician without a profile passes the server pre-check and is allocated (the RPC runs, forms are handed over)", async () => {
  const f = fixture(); f.worker.profile_id = null as unknown as string;
  // JOIN: Part 6's allocate_team_electrician v2 SQL removes the profile check in the RPC; this test covers the server side only.
  await f.load().allocateElectrician("j", "owner", "w");
  expect(f.writes).toEqual([{ name: "allocate_team_electrician", args: { _job: "j", _actor: "owner", _worker: "w" } }]);
  expect(f.forms.length).toBe(2);
});
test("C1: an electrician with no Mitti email is refused with 'Electrician needs a Mitti email' (nothing written)", async () => {
  const f = fixture(); f.worker.profile_id = null as unknown as string; f.worker.email = null as unknown as string;
  await expect(f.load().allocateElectrician("j", "owner", "w")).rejects.toThrow("Electrician needs a Mitti email");
  expect(f.writes).toEqual([]);
});
test("C1: picker and Add-a-job choices allow a no-profile verified electrician; selected follows the allocation event's worker_id", async () => {
  const f = fixture(); f.worker.profile_id = null as unknown as string;
  const api = f.load();
  const choices = await api.teamElectricianChoices("b");
  expect(choices).toEqual([{ id: "w", name: "Example Electrician", licence: "A123", allowed: true, reason: null }]); // licence: the Add a job choice record names it (join ruling)
  const picker = await api.electricianPicker("j", "owner");
  expect(picker.workers[0]).toMatchObject({ id: "w", allowed: true, reason: null, selected: true }); // fixture: latest event names "w"
  expect(await api.allocatedWorkerId("j")).toBe("w");
  expect(await api.inHousePiesaBookingBlockerFor("j")).toBeNull();
});
test("a verified allocation gives the electrician their job link after the assignment, and none when it is refused",async()=>{const f=fixture();await f.load().allocateElectrician("j","owner","w");expect(f.links).toEqual([["j","w","owner"]]);const g=fixture();g.worker.licence_verified_at="";await expect(g.load().allocateElectrician("j","owner","w")).rejects.toThrow();expect(g.links).toEqual([]);});
