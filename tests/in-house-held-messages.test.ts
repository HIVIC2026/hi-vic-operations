import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as inHouse from '../src/lib/in-house.core';

// Executes the real sender bodies and shared held reader. Every external delivery
// boundary is a local double; unexpected imports throw before any provider can run.
function fixture(held: boolean, payee = false, failed = false) {
  const calls: string[] = [], writes: string[] = [];
  const job = { id:'j', job_number:'HV-9000', source:'qa_test', channel:'hivic_sourced', stage:'installation_scheduling', owner_id:'o', property_id:'p', owners:{full_name:'Test Owner',phone:'0400000000'}, properties:{address_line:'1 Test St',suburb:'Test'} };
  const biz = { in_house:held, pays_own_electricians:payee, name:'Test Partner', phone:'0400000000', email:'test@example.test' };
  const tables: Record<string,any[]> = { jobs:[job], job_assignments:[{id:'a',job_id:'j',business_id:'b',role:'installer',active:true,businesses:biz,profiles:{email:'test@example.test'},user_id:'u'}], owners:[{full_name:'Test Owner',email:'test@example.test'}], properties:[job.properties], customer_estimate_links:[{token:'test',status:'active'}], bookings:[{scheduled_start:'2026-11-04T00:00:00Z'}], workflow_events:[], appointment_proposals:[{id:'w',starts_at:'2026-11-04T00:00:00Z',status:'accepted',responded_by:'o',responded_at:'2026-10-30'}], piesa_records:[{created_at:'2026-10-30T00:00:00Z'}] };
  const admin = { from(table:string) {
    let single=false, head=false, select='', offset=0; const q:any={};
    q.select=(s:string,o?:any)=>{select=s;head=!!o?.head;return q;}; q.range=(a:number)=>{offset=a;return q;};
    for(const n of ['eq','is','neq','in','order','limit','contains','not','gte','lt']) q[n]=()=>q;
    for(const n of ['insert','upsert','update']) q[n]=()=>{writes.push(table);return q;};
    q.maybeSingle=q.single=()=>{single=true;return q;};
    q.then=(resolve:any)=>{let rows=tables[table]??[];if(table==='job_assignments'&&select.includes('in_house'))rows=offset?[]:tables.job_assignments;
      return Promise.resolve({data:head?null:single?rows[0]??null:rows,count:0,error:failed&&select.includes('in_house')?{message:'held lookup failed'}:null}).then(resolve);};return q;
  }};
  const delivered = async()=>{calls.push('message');return {status:'sent',detail:'mock'};};
  const modules:Record<string,any>={
    '@/integrations/supabase/client.server':{supabaseAdmin:admin}, './in-house.core':inHouse,
    './workflow.server':{logEvent:async()=>writes.push('event'), WorkflowError:class extends Error{}, piesaStatus:async()=>({})},
    './install-days.server':{installDayContext:async()=>({clearance:{cleared:true,timingDate:'2026-10-30',basis:'initial_piesa'},asg:{id:'a'},deadline:'2026-11-29',booked:false})},
    './test-send.server':{sendTestEmail:delivered,sendTestSms:delivered}, './office-email.server':{sendOfficeEmail:delivered}, './sms.server':{sendRealSms:delivered},
    './test-send.core':{isTestPartner:()=>true}, './set-password-link.core':{SET_PASSWORD_BASE:'https://example.test'},
    './worker-links.core':{firstName:()=> 'Test'}, './estimatelink.core':{linkUsable:()=>true}, './engagement.core':{CUSTOMER_BASE:'https://example.test'},
    './address':{fullAddress:()=> '1 Test St'}, './veec-copy-email.server':{ownerMyJobLink:async()=> 'https://example.test'},
    './ready-check-times.server':{readyCheckTurnFor:async()=> 'owner_to_answer'}, './quote-hold.core':{smsQuietReason:()=>null},
    './mitti.core':{isClosedOrArchivedJob:()=>false}, './payments.server':{jobPaymentView:async()=>null},
    './approved-owner-emails.server':new Proxy({}, {get:(_,key)=>key==='then'?undefined:async()=>{calls.push('message');return 'sent';}}),
    './booking.server':{confirmBooking:async()=>{writes.push('booking');return 'b';}},
  };
  const cache:Record<string,any>={};
  function load(name:string, extra=''):any {
    const code=ts.transpile(readFileSync(`src/lib/${name}.ts`,'utf8')+extra,{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}); const out:any={};
    new Function('exports','require',code)(out,(dep:string)=>{
      if(dep in modules)return modules[dep];
      if(dep.startsWith('./')&&dep.endsWith('.core'))return require(`../src/lib/${dep.slice(2)}.ts`);
      if(dep.startsWith('./')) {const key=dep.slice(2);return cache[key]??(cache[key]=load(key));}
      throw new Error(`Unexpected dependency ${dep}`);
    });return out;
  }
  return {load,calls,writes,modules,tables};
}
const entries = [
  {file:'install-clearance.server',fn:'notifyInstallerClearance',args:['j']},
  {file:'ready-check-times-email.server',fn:'emailOwnerReadyCheckTimes',args:['j',['2026-11-04T00:00:00Z']]},
  {file:'ready-check-booked-email.server',fn:'emailOwnerReadyCheckBooked',args:['j','2026-11-04T00:00:00Z']},
  {file:'owner-email-triggers.server',fn:'onInstallDaysOffered',args:['j',['2026-11-04T00:00:00Z'],'2026-11-29']},
  {file:'owner-email-triggers.server',fn:'onSafetyCheckBooked',args:['j','2026-11-04T00:00:00Z',false]},
  {file:'owner-email-triggers.server',fn:'onInstallDayMoved',args:['j','2026-11-04T00:00:00Z','2026-11-03T00:00:00Z']},
  {file:'approved-texts.server',fn:'textOwnerReadyCheckTimes',args:['j','e','2026-10-30T00:00:00Z',new Date('2026-10-30T00:00:00Z')]},
  {file:'installer-texts.server',fn:'textInstallerOwnerSuggestedDays',args:['j','e','2026-10-30T00:00:00Z']},
  {file:'installer-texts.server',fn:'textTradeOwnerChangedVisit',args:[{jobId:'j',kind:'installation',triggerEventId:'e',changedAt:'2026-10-30T00:00:00Z',wasIso:'2026-11-04T00:00:00Z'}]},
];
for(const entry of entries) {
  for(const failure of [false,true]) test(`${entry.fn}: ${failure?'failed held read':'held partner'} stops before any message/event`,async()=>{
    const f=fixture(true,false,failure);const out=await f.load(entry.file)[entry.fn](...entry.args);
    expect(out).toBe(failure?'in_house_read_failed':'in_house');expect(f.calls).toEqual([]);expect(f.writes).toEqual([]);
  });
}
for(const payee of [false,true]) {
  for(const entry of entries.filter(e=> !['textInstallerOwnerSuggestedDays'].includes(e.fn))) test(`${entry.fn}: ${payee?'payee-only':'non-held'} keeps existing delivery`,async()=>{
    const f=fixture(false,payee);await f.load(entry.file)[entry.fn](...entry.args);expect(f.calls.length).toBeGreaterThan(0);
  });
}
test('clearance sweep skips held partner without a delivery claim',async()=>{
  const f=fixture(true);expect(await f.load('install-clearance.server').sweepInstallClearance(new Date('2026-10-30'))).toMatchObject({notified:0});expect(f.calls).toEqual([]);expect(f.writes).toEqual([]);
});
