import { expect, test } from "bun:test";
import ts from "typescript";
import { readFileSync } from "node:fs";
import * as compliance from "../src/lib/worker-compliance.core";
function fixture() {
  const worker = { id: "w", business_id: "b", profile_id: "electrician", full_legal_name: "Example Electrician", email: "e@example.invalid", trade_role: "electrician", approval_status: "approved", removed_at: null, licence_number: "A123", rec_number: "REC456", licence_expires_on: "2099-01-01", licence_verified_at: "2026-11-01" };
  const forms: unknown[] = [], writes: unknown[] = [];
  let access = true;
  const admin = { from(table: string) {
    const q: any = {};
    let filters: unknown[][] = [];
    for (const key of ["select","eq","is","order","limit"]) q[key] = (...args: unknown[]) => { filters.push([key,...args]); return q; };
    q.maybeSingle = q.single = async () => ({ error: null, data: table === "partner_workers" ? (filters.some(x => x[1] === "business_id" && x[2] !== worker.business_id) ? null : worker) : table === "business_members" ? (access ? { user_id: "owner" } : null) : table === "assessments" ? { external_mitti_id: "A3" } : table === "job_assignments" ? { business_id: "b", user_id: "electrician" } : {source:"base44"} });
    q.then = (resolve: any) => Promise.resolve({data:[worker],error:null}).then(resolve);
    return q;
  }, async rpc(name: string, args: unknown) {writes.push({name,args});return {error:null,data:{already_allocated:false}};} };
  const deps: Record<string, unknown> = {
    "@/integrations/supabase/client.server": {supabaseAdmin:admin}, "./worker-compliance.core":compliance,
    "./in-house-suppression.server":{readInHouseDispatchState:async()=>({failed:false,held:new Set(["j"])})},
    "./fixes-day.server":{existingRectificationForm:async()=>({auditId:"A4",closed:false})},
    "./mitti.server":{realMittiCall:()=>{},findMittiUserByEmail:async()=>"mitti-e",reassignMittiFormTo:async(p:unknown)=>forms.push(p)},
  };
  const api: any = {};
  return {worker,forms,writes,deny:()=>{access=false;},load:()=>{new Function("exports","require",ts.transpile(readFileSync("src/lib/in-house-electrician.server.ts","utf8"),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}))(api,(name:string)=>{if(!(name in deps))throw new Error(`Unexpected dependency ${name}`);return deps[name];});return api;}};
}
test("allocate unverified refuses with no assignment or form handover",async()=>{const f=fixture();f.worker.licence_verified_at="";await expect(f.load().allocateElectrician("j","owner","w")).rejects.toThrow("Electrician not verified");expect(f.writes).toEqual([]);expect(f.forms).toEqual([]);});
test("another business worker or user cannot allocate",async()=>{const f=fixture();f.worker.business_id="other";await expect(f.load().allocateElectrician("j","owner","w")).rejects.toThrow("That electrician is not on your Team");expect(f.writes).toEqual([]);const g=fixture();g.deny();await expect(g.load().allocateElectrician("j","outsider","w")).rejects.toThrow("This job is not assigned to your business");expect(g.forms).toEqual([]);});
test("verified allocation updates atomic assignment and hands A3 and A4 to selected person",async()=>{const f=fixture();await f.load().allocateElectrician("j","owner","w");expect(f.writes).toEqual([{name:"allocate_team_electrician",args:{_job:"j",_actor:"owner",_worker:"w"}}]);expect(f.forms).toEqual([
  {jobId:"j",auditId:"A3",kind:"piesa",mittiUserId:"mitti-e",email:"e@example.invalid",actorId:"owner"},
  {jobId:"j",auditId:"A4",kind:"rectification",mittiUserId:"mitti-e",email:"e@example.invalid",actorId:"owner"},
]);});
test("held booking refuses missing verification and remains read-only",async()=>{const f=fixture();f.worker.licence_verified_at="";expect(await f.load().inHousePiesaBookingBlockerFor("j")).toBe("Add a verified electrician to your Team before booking the safety check.");expect(f.writes).toEqual([]);expect(f.forms).toEqual([]);});