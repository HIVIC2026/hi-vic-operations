import { expect, test } from 'bun:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { memoryPostgrest } from './helpers/memory-postgrest';
import * as claims from '../src/lib/mitti-create-claim.core';
import * as roles from '../src/lib/worker-role.core';
import * as crew from '../src/lib/piisa-a3.core';
import * as allocation from '../src/lib/visit-allocation.core';
import * as swms from '../src/lib/swms.core';
import { mittiApi } from '../src/lib/mitti.core';
import { createHash } from 'node:crypto';
function load(path:string,deps:Record<string,any>){const api:any={};new Function('exports','require',ts.transpile(readFileSync(path,'utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}))(api,(p:string)=>{if(!(p in deps))throw Error(`Unmocked ${p}`);return deps[p];});return api;}
test('documented Mitti access removal revokes old direct access without changing the replacement owner',async()=>{
  const owners=new Map([['A5','new']]),access=new Set(['old','new']);
  const calls:any[]=[];const api=mittiApi(async(method,path)=>{calls.push([method,path]);if(method==='DELETE')access.delete('old');return {};});
  await api.removeInspectionUserAccess('A5','old');
  expect(calls).toEqual([['DELETE','/inspections/v1/inspections/A5/user/old/access']]);expect(access.has('old')).toBe(false);expect(access.has('new')).toBe(true);expect(owners.get('A5')).toBe('new');
});
test('saved Lead Installer replacement hands the existing A5 and SWMS to the new person; old person loses ownership and signing rights',async()=>{
  const rows:any={jobs:[{id:'j',job_number:'HV-1',source:'base44',property_id:'p'}],properties:[{id:'p',address_line:'1 Practice St',suburb:'Test',postcode:'3000',year_built:1990}],businesses:[{id:'b',name:'Practice',email:'office@example.invalid'}],job_assignments:[{job_id:'j',business_id:'b',user_id:'office',role:'installer',active:true}],partner_workers:[{id:'old',business_id:'b',email:'old@example.invalid',worker_role:'lead',trade_role:'installer',removed_at:null},{id:'new',business_id:'b',email:'new@example.invalid',worker_role:'lead',trade_role:'installer',removed_at:null}],bookings:[{job_id:'j',kind:'installation',status:'confirmed',scheduled_start:'2026-11-03T00:00:00Z'}],workflow_events:[{job_id:'j',event_type:'mitti_piisa_audit_created',created_at:'2026-11-01T00:00:00Z',details:{audit_id:'A5'}},{job_id:'j',event_type:'piisa_crew_selected',created_at:'2026-11-01T00:00:01Z',details:{selection:{lead:'old',additional:[]}}}]};
  const db=memoryPostgrest(rows),owner=new Map([['A5','old@example.invalid']]),access=new Set(['old@example.invalid']);
  const call:any=async(method:string,path:string)=>{if(method==='DELETE'&&path.endsWith('/user/old%40example.invalid/access'))access.delete('old@example.invalid');return {};};
  const shared:any={'@/integrations/supabase/client.server':{supabaseAdmin:db},'./workflow.server':{WorkflowError:Error},'./early-read':{early:(p:any)=>Promise.resolve(p)},'./piisa-a3.server':{loadCrew:async()=>({selection:rows.workflow_events.filter((e:any)=>e.event_type==='piisa_crew_selected').at(-1)?.details.selection,staff:[{workerId:'old',name:'Old Installer'},{workerId:'new',name:'New Installer'}]})}};
  const forms=load('src/lib/in-house-forms.server.ts',{...shared,'./mitti.core':{mittiApi},'./mitti-create-claim.core':claims,'./in-house-suppression.server':{readInHouseDispatchState:async()=>({held:new Set(['j']),failed:false})},'./visit-allocation.core':allocation,'./piisa-a3.core':crew,'./worker-role.core':roles,'./mitti.server':{mittiCallFor:async()=>call,findMittiUserByEmail:async(e:string)=>e,reassignMittiFormTo:async(p:any)=>{owner.set(p.auditId,p.mittiUserId);access.add(p.mittiUserId);},updateMittiInstallCrew:async()=>{}}});
  const safety=load('src/lib/swms.server.ts',{...shared,'node:crypto':{createHash},'./swms.core':swms,'./install-evidence.server':{melbourneDateOf:()=> '2026-11-03'},'./swms-house.core':{swmsHouseFacts:()=>({}),swmsHouseLines:()=>[],swmsHouseSteps:()=>[]}});
  const before=await safety.loadSwms('j');expect(before.plan.signers.map((p:any)=>p.key)).toEqual(['w:old']);
  rows.workflow_events.push({job_id:'j',event_type:'swms_signed',created_at:'2026-11-01T00:00:02Z',details:{key:'w:old',name:'Old Installer',typed_name:'Old Installer',plan_sha256:safety.swmsPlanSha(before.plan)}});
  const staff=[{workerId:'old',name:'Old Installer',eec:'CII-old',eecVerified:true,cleared:true,workerRole:'lead',level:'full',expiresOn:'2027-11-01'},{workerId:'new',name:'New Installer',eec:'CII-new',eecVerified:true,cleared:true,workerRole:'lead',level:'full',expiresOn:'2027-11-01'}];
  // Drive the actual crew-save wrapper, not a manufactured direct form handover.
  const visits=load('src/lib/visit-allocation.server.ts',{
    ...shared,'./worker-role.core':roles,'./worker-compliance.core':{melbourneToday:()=> '2026-11-02',CREW_CLEARANCE_REASON:{}},'./visit-allocation.core':allocation,'./piisa-a3.core':crew,
    './workflow.server':{WorkflowError:Error,logEvent:async(jobId:string,_actor:string,event_type:string,_summary:string,details:any)=>rows.workflow_events.push({job_id:jobId,event_type,details,created_at:new Date().toISOString()})},
    './trade-view.server':{requireTradeJob:async()=>({boss:true,kind:'installer',biz:{id:'b'},isTest:false})},
    './in-house-suppression.server':{readInHouseDispatchState:async()=>({held:new Set(['j']),failed:false})},
    './in-house-booking.server':{bookingTeam:async()=>({workers:[{id:'new',name:'New Installer',tradeRole:'installer',workerRole:'lead',cleared:true,reason:null,escRegistered:true,escRegisteredAt:'2026-11-01'}]}),recordLeadChange:async()=>{}},
    './in-house-booking.core':{bookingWorkerBlocker:()=>null},
    './piisa-a3.server':{crewStaff:async()=>staff,loadCrew:async()=>({staff,selection:rows.workflow_events.filter((e:any)=>e.event_type==='piisa_crew_selected').at(-1)?.details.selection}),saveCrewSelection:async(jobId:string,_actor:string,selection:any)=>{rows.workflow_events.push({job_id:jobId,event_type:'piisa_crew_selected',details:{selection},created_at:new Date().toISOString()});return {needsVerification:[]};}},
    './in-house-forms.server':forms,
    './schema-compat.core':{isMissingDbObject:()=>false},
    './mitti.server':{realMittiCall:call,findMittiUserByEmail:async(e:string)=>e,reassignMittiFormTo:async(p:any)=>{owner.set(p.auditId,p.mittiUserId);access.add(p.mittiUserId);}},
  });
  rows.workflow_events.push({job_id:'j',event_type:'visit_allocated',created_at:'2026-11-02T00:00:01Z',details:{visit:'install',worker_id:'old',worker_name:'Old Installer'}});
  rows.jobs[0].stage='installation_booked';
  rows.partner_workers.forEach((w:any)=>{w.full_legal_name=w.id==='old'?'Old Installer':'New Installer';w.mobile=null;w.declarations_due=false;w.profile_id=null;});
  await visits.saveCrewWithLead('j','office',{lead:'new',additional:[]},call);const after=await safety.loadSwms('j');
  expect(owner.get('A5')).toBe('new@example.invalid');expect(owner.get('A5')).not.toBe('old@example.invalid');
  expect(access.has('old@example.invalid')).toBe(false);expect(access.has('new@example.invalid')).toBe(true);
  expect(after.plan.signers.map((p:any)=>p.key)).toEqual(['w:new']);expect(swms.checkSwmsSign(after.plan,after.signatures,'w:old','Old Installer').ok).toBe(false);expect(swms.checkSwmsSign(after.plan,after.signatures,'w:new','New Installer').ok).toBe(true);expect(after.status.complete).toBe(false);
  expect(rows.workflow_events.filter((e:any)=>e.event_type==='swms_signed')).toHaveLength(1);expect(rows.workflow_events.filter((e:any)=>e.event_type==='mitti_piisa_audit_created')).toHaveLength(1);
});