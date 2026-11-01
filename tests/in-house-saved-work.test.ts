import {expect,test} from 'bun:test';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {memoryPostgrest} from './helpers/memory-postgrest';
import {stableUuid} from '../src/lib/mitti-create-claim.core';
function load(deps:Record<string,unknown>){const api:any={};new Function('exports','require',ts.transpile(readFileSync('src/lib/in-house-saved-work.server.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}))(api,(p:string)=>{if(!(p in deps))throw Error(`Unmocked ${p}`);return deps[p];});return api;}
function fixture(){
 const rows:any={workflow_events:[],bookings:[{id:'b',job_id:'j',kind:'installation',status:'confirmed',scheduled_start:'2026-11-10T22:00:00Z'}]};
 const db:any=memoryPostgrest(rows);db.rpc=async(_name:string,p:any)=>{const e=rows.workflow_events.find((e:any)=>e.id===p._id);if(!e||e.details.status==='done'||e.details.status==='running')return{data:false,error:null};e.details={...e.details,status:'running',lease:p._lease};return{data:true,error:null};};
 let fail=true;const calls:string[]=[];
 const deps:any={'@/integrations/supabase/client.server':{supabaseAdmin:db},'./mitti-create-claim.core':{stableUuid},'./in-house-forms.server':{ensureInstallForm:async()=>{},ensureInHouseForms:async()=>{},syncInHouseForms:async()=>{calls.push('A5');if(fail)throw Error('Mitti unavailable');}},'./swms.server':{loadSwms:async()=>{calls.push('SWMS');}},'./swms-sign-text.server':{textSwmsSignLinks:async()=>{calls.push('worker notices');}},'./in-house-booking.server':{notifyOwnerBooked:async()=> 'sent; sent'},'./in-house-electrician-booked.server':{notifyInHouseElectricianBooked:async()=> 'sent'},'./invoice-dates.server':{setInstallDueDate:async()=>{}},'./esc.server':{regenerateEscNotification:async()=>{}},'./autoadvance.server':{autoAdvanceJob:async()=>{}},'./background.server':{runAfterResponse:()=> 'queue_only'}};
 return{api:load(deps),rows,calls,repair:()=>{fail=false;}};
}
test('saved crew work is durable without waiting on Mitti; retries raise and resolve one office task',async()=>{
 const f=fixture();const id=await f.api.recordInHouseSavedWork('j','actor',{type:'crew',bookingId:'b',oldWorkerId:'old',workerId:'new'},'version-1');
 expect(f.calls).toEqual([]);expect(f.rows.workflow_events.filter((e:any)=>e.event_type==='in_house_saved_work')).toHaveLength(1);
 for(let i=0;i<3;i++)await f.api.runInHouseSavedWork(id,new Date('2026-11-02T03:00:00Z'));
 expect(f.rows.workflow_events.filter((e:any)=>e.event_type==='in_house_form_sync_failed')).toHaveLength(1);
 f.repair();await f.api.runInHouseSavedWork(id,new Date('2026-11-02T03:01:00Z'));await f.api.runInHouseSavedWork(id);
 expect(f.calls.filter(x=>x==='SWMS')).toHaveLength(1);expect(f.rows.workflow_events.filter((e:any)=>e.event_type==='in_house_form_sync_recovered')).toHaveLength(1);
 expect(f.rows.workflow_events.find((e:any)=>e.id===id).details.status).toBe('done');
});
test('parallel retry claims run A5 and SWMS only once',async()=>{const f=fixture();f.repair();const id=await f.api.recordInHouseSavedWork('j','actor',{type:'crew',bookingId:'b',oldWorkerId:'old',workerId:'new'},'version-1');await Promise.all([f.api.runInHouseSavedWork(id),f.api.runInHouseSavedWork(id)]);expect(f.calls).toEqual(['A5','SWMS','worker notices']);});