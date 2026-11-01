import {expect,test} from 'bun:test';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {memoryPostgrest} from './helpers/memory-postgrest';
import {stableUuid} from '../src/lib/mitti-create-claim.core';
import * as crewCore from '../src/lib/piisa-a3.core';
import * as bookingCore from '../src/lib/in-house-booking.core';
import * as schemaCompat from '../src/lib/schema-compat.core';

function fixture(error:{code:string;message:string},missingAt='in_house_visit_revision') {
 const raw:any=memoryPostgrest({jobs:[{id:'j',stage:'installation_scheduling',updated_at:'2026-11-01',deleted_at:null}],bookings:[],workflow_events:[]});
 const calls:string[]=[]; let invalid=false;
 raw.rpc=async(name:string)=>name===missingAt?{data:null,error}:{data:name==='in_house_visit_revision'?'revision':null,error:null};
 const deps:any={
  '@/integrations/supabase/client.server':{supabaseAdmin:raw},'./schema-compat.core':schemaCompat,
  './mitti-create-claim.core':{stableUuid},'./piisa-a3.core':crewCore,'./in-house-booking.core':bookingCore,
  './booking.server':{validateBooking:async()=>{calls.push('validate');if(invalid)throw Error('Deposit not paid');}},
  './in-house-booking.server':{bookingTeam:async()=>({workers:[{id:'new',name:'Pat',tradeRole:'installer',workerRole:'lead',cleared:true,escRegistered:true,escRegisteredAt:'2026-11-01',reason:null}]})},
  './piisa-a3.server':{loadCrew:async()=>({staff:[{workerId:'new',name:'Pat',eecVerified:true,cleared:true,workerRole:'lead'}]})},
  './in-house-inline-save.server':{saveInHouseVisitInline:async(_j:string,_a:string,input:any)=>{calls.push(input.kind==='crew'?'inline crew':'inline book');return {bookingId:'old-booking',already:false,needsVerification:[]};}},
 };
 const api:any={};new Function('exports','require',ts.transpile(readFileSync('src/lib/in-house-atomic-save.server.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}))(api,(p:string)=>{if(!(p in deps))throw Error(`Unmocked ${p}`);return deps[p];});
 return {api,calls,invalidate:()=>{invalid=true;}};
}
for(const kind of ['installation','crew'])test(`recorded live missing-function response uses inline ${kind} path without providers`,async()=>{
 const evidence=JSON.parse(readFileSync('docs/applied-migrations/2026-11-02_saved-work-dispatch.json','utf8'));
 expect(evidence.status).toBe(404);
 expect(evidence.code).toBe('PGRST202');
 const f=fixture(evidence);
 expect(await f.api.saveInHouseVisit('j','a',{kind,start:'2026-11-10',workerId:'new'})).toMatchObject({bookingId:'old-booking'});
 expect(f.calls).toEqual([kind==='crew'?'inline crew':'inline book']);
});
for(const kind of ['installation','crew'])test(`missing saved-work function uses inline ${kind} path`,async()=>{
 const f=fixture({code:'PGRST202',message:'Could not find the function public.in_house_visit_revision'});
 expect(await f.api.saveInHouseVisit('j','a',{kind,start:'2026-11-10',workerId:'new'})).toMatchObject({bookingId:'old-booking'});
 expect(f.calls).toContain(kind==='crew'?'inline crew':'inline book');
});
test('permission errors never fall back to a second writer',async()=>{
 const f=fixture({code:'42501',message:'permission denied'});
 await expect(f.api.saveInHouseVisit('j','a',{kind:'installation',start:'2026-11-10',workerId:'new'})).rejects.toThrow('permission denied');expect(f.calls).toEqual([]);
});
test('missing commit dispatch uses inline booking after validation',async()=>{
 const f=fixture({code:'PGRST202',message:'Could not find the function public.commit_in_house_visit'},'commit_in_house_visit');
 expect(await f.api.saveInHouseVisit('j','a',{kind:'installation',start:'2026-11-10',workerId:'new'})).toMatchObject({bookingId:'old-booking'});
 expect(f.calls).toEqual(['validate','inline book']);
});
test('missing table inside a deployed commit never retries through the inline writer',async()=>{
 const f=fixture({code:'42P01',message:'relation invoices does not exist'},'commit_in_house_visit');
 await expect(f.api.saveInHouseVisit('j','a',{kind:'installation',start:'2026-11-10',workerId:'new'})).rejects.toThrow('relation invoices');expect(f.calls).toEqual(['validate']);
});
test('a missing commit function falls back only after canonical validation; invalid deposit writes nothing',async()=>{
 const f=fixture({code:'PGRST202',message:'Could not find the function public.commit_in_house_visit'},'commit_in_house_visit');
 f.invalidate();await expect(f.api.saveInHouseVisit('j','a',{kind:'installation',start:'2026-11-10',workerId:'new'})).rejects.toThrow('Deposit not paid');expect(f.calls).toEqual(['validate']);
});