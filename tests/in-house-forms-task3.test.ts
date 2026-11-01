import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as claims from "../src/lib/mitti-create-claim.core";

function fixture() {
  const tables: Record<string, any[]> = {
    jobs: [{ id: "j", stage: "ready_check_scheduled", source: "base44" }],
    job_assignments: [{ job_id: "j", role: "installer", user_id: "installer", business_id: "b", active: true, profiles: { email: "installer@example.invalid" } }, { job_id: "j", role: "electrician", user_id: "electrician", business_id: "b", active: true, profiles: { email: "electrician@example.invalid" } }],
    ceiling_measurements: [], assessments: [], workflow_events: [],
    bookings: [{ job_id: "j", kind: "ready_check", status: "confirmed", scheduled_start: "2026-11-03T00:00:00Z" }],
  };
  const creates: string[] = [], dates: any[] = [], handovers: any[] = [], apiCalls: string[] = [];
  let held = true, failed = false;
  const from = (t: string) => {
    const filters: ((r: any) => boolean)[] = []; let single = false, patch: any = null;
    const q: any = { select: () => q, eq: (k: string, v: any) => { filters.push(r => r[k] === v); return q; }, is: (k: string, v: any) => { filters.push(r => (r[k] ?? null) === v); return q; }, in: (k: string, v: any[]) => { filters.push(r => v.includes(r[k])); return q; }, neq: (k: string, v: any) => { filters.push(r => r[k] !== v); return q; }, order: () => q, limit: () => q, range: () => q, contains: (k: string, v: any) => { filters.push(r => Object.entries(v).every(([key,val]) => r[k]?.[key] === val)); return q; }, insert: (p: any) => { patch = p; return q; }, maybeSingle: () => { single = true; return q; }, single: () => { single = true; return q; }, then: (resolve: any, reject: any) => Promise.resolve().then(() => {
      const all = tables[t] ??= [];
      if (patch) { const rows = Array.isArray(patch) ? patch : [patch]; for (const r of rows) { if (all.some(x => x.id === r.id)) return { data: null, error: { code: "23505", message: "duplicate" } }; all.push(r); } }
      const rows = all.filter(r => filters.every(f => f(r))); return { data: single ? rows.at(-1) ?? null : rows, error: null, count: rows.length };
    }).then(resolve, reject) }; return q;
  };
  const deps: Record<string, any> = {
    "@/integrations/supabase/client.server": { supabaseAdmin: { from } },
    "./in-house-suppression.server": { readInHouseDispatchState: async () => ({ failed, held: new Set(held ? ["j"] : []) }) },
    "./mitti-create-claim.core": claims,
    "./visit-allocation.core": { currentAllocation: (events: any[], kind: string) => events.find(e => e.details?.visit === kind)?.details ?? null },
    "./piisa-a3.core": { leadWorkerId: (s: any) => s?.lead ?? null },
    "./worker-role.core": { mittiEmailFor: (p: any) => ({ email: p.ownEmail || p.businessEmail }) },
    "./onsite-ready-check.core": { TEST_MITTI_ASSIGNEE: "test@example.invalid" },
    "./mitti-create.server": { readyCheckFormFacts: async () => ({ booked: true, mittiInvited: true, autoSend: true, templateSet: true, installerUserId: "installer" }) },
    "./mitti-immediate.core": { bookedSkipReason: () => null },
    "./mitti.server": {
      realMittiCall: async (_m: string,p: string) => { apiCalls.push(p); throw new Error("Unexpected external call"); },
      createAssignMittiAudit: async (_j: string,_a: string,_c: any,o: any) => { const kind = o.readyCheck ? "readyCheck" : "piesa"; creates.push(kind); const auditId = kind === "readyCheck" ? "RC" : "A3"; (kind === "readyCheck" ? tables.ceiling_measurements : tables.assessments).push(kind === "readyCheck" ? {job_id:"j",is_current:true,external_source:"mitti",external_id:auditId,status:"draft"} : {job_id:"j",external_mitti_id:auditId,status:"draft"}); return { auditId }; },
      createPiisaMittiAudit: async (_j: string,_a: string,_c: any,o: any) => { creates.push("install"); expect(o.assignee.email).toBe("lead@example.invalid"); tables.workflow_events.push({job_id:"j",event_type:"mitti_piisa_audit_created",details:{audit_id:"A5"}}); return {auditId:"A5"}; },
      findMittiUserByEmail: async (email: string) => email,
      reassignMittiFormTo: async (p: any) => { handovers.push(p); },
    },
    "./mitti-pickup.server": { updateMittiFormDate: async (...p: any[]) => { dates.push(p); return {updated:true}; } },
    "./fixes-day.server": { existingRectificationForm: async () => { const e = tables.workflow_events.find(e => e.event_type === "fixes_form_created"); return e ? {auditId:e.details.audit_id,closed:false,round:"A3"} : null; }, createFixesForm: async () => { creates.push("fixes"); tables.workflow_events.push({job_id:"j",event_type:"fixes_form_created",details:{audit_id:"A4",rectification_round:"A3"}}); return {status:"created",auditId:"A4"}; } },
  };
  const api: any = {};
  const load = () => { new Function("exports","require",ts.transpile(readFileSync("src/lib/in-house-forms.server.ts","utf8"),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}))(api,(p:string) => { if (!(p in deps)) throw new Error(`Unexpected dependency ${p}`); return deps[p]; }); return api; };
  const lead = () => { tables.workflow_events.push({job_id:"j",event_type:"visit_allocated",details:{visit:"install",worker_id:"lead",mitti_user_id:"lead-mitti"}}); tables.partner_workers = [{id:"lead",business_id:"b",removed_at:null,email:"lead@example.invalid",worker_role:"lead",trade_role:"installer"}]; tables.bookings.push({job_id:"j",kind:"installation",status:"confirmed",scheduled_start:"2026-11-16T00:00:00Z"}); tables.jobs[0].stage="installation_booked"; };
  return {load,tables,creates,dates,handovers,apiCalls,lead,nonHouse:()=>{held=false;},outage:()=>{failed=true;}};
}
test("Ready Check booking creates RC A3 A4 once; a second call creates nothing", async () => { const f=fixture(),s=f.load(); expect(await s.ensureInHouseForms("j","actor")).toEqual({readyCheck:"RC",piesa:"A3",fixes:"A4"}); await s.ensureInHouseForms("j","actor"); expect(f.creates).toEqual(["readyCheck","piesa","fixes"]); });
test("A3 and A4 use the selected electrician", async () => { const f=fixture(); await f.load().ensureInHouseForms("j","actor"); expect(f.handovers.map(p=>[p.auditId,p.email])).toEqual([["A3","electrician@example.invalid"],["A4","electrician@example.invalid"]]); });
test("forms can be prepared before an electrician is selected without creating an assignment", async () => {const f=fixture(); f.tables.job_assignments.pop(); await f.load().ensureInHouseForms("j","actor"); expect(f.creates).toEqual(["readyCheck","piesa","fixes"]); expect(f.tables.job_assignments).toHaveLength(1); expect(f.handovers).toHaveLength(0);});
test("install booking creates A5 once for the Lead", async () => {const f=fixture(); f.lead(); const s=f.load(); expect(await s.ensureInstallForm("j","actor")).toBe("A5"); await s.ensureInstallForm("j","actor"); expect(f.creates).toEqual(["install"]);});
test("moving the installation updates only the open A5 date", async () => {const f=fixture(); f.lead(); const s=f.load(); await s.ensureInstallForm("j","actor"); f.tables.bookings.at(-1).scheduled_start="2026-11-17T00:00:00Z"; await s.syncInHouseForms("j","date"); expect(f.dates.map(p=>[p[1],p[4]?.auditId])).toEqual([["2026-11-17T00:00:00Z","A5"]]);});
test("changing the Lead hands the existing A5 to that Lead without creating another", async () => {const f=fixture(); f.lead(); const s=f.load(); await s.ensureInstallForm("j","actor"); await s.syncInHouseForms("j","crew"); expect(f.handovers).toContainEqual(expect.objectContaining({auditId:"A5",kind:"install",email:"lead@example.invalid"})); expect(f.creates).toEqual(["install"]);});
test("no upgrades closes only unused A4 once, retains its identity and adds one office note without any archive call", async () => {const f=fixture(),s=f.load(); await s.ensureInHouseForms("j","actor"); expect(await s.closeUnneededForms("j","no_upgrades")).toBe(1); expect(await s.closeUnneededForms("j","no_upgrades")).toBe(0); expect(f.tables.workflow_events.filter(e=>e.event_type==="installer_note")).toHaveLength(1); expect(f.tables.workflow_events.find(e=>e.event_type==="rectification_form_closed_unused").details.audit_id).toBe("A4"); expect(f.apiCalls).toEqual([]);});
test("cancel closes every unused form but never completed forms; replay adds nothing", async () => {const f=fixture(),s=f.load(); await s.ensureInHouseForms("j","actor"); f.lead(); await s.ensureInstallForm("j","actor"); f.tables.ceiling_measurements[0].status="complete"; expect(await s.closeUnneededForms("j","cancelled")).toBe(3); expect(await s.closeUnneededForms("j","cancelled")).toBe(0); expect(f.tables.workflow_events.filter(e=>e.event_type==="installer_note")).toHaveLength(1); expect(f.apiCalls).toEqual([]);});
test("non-in-house jobs are unchanged and failed partner reads refuse before creation", async () => {const f=fixture(); f.nonHouse(); expect(await f.load().ensureInHouseForms("j","actor")).toEqual({readyCheck:null,piesa:null,fixes:null}); expect(f.creates).toEqual([]); const g=fixture(); g.outage(); await expect(g.load().ensureInHouseForms("j","actor")).rejects.toThrow("partner"); expect(g.creates).toEqual([]);});