import {expect,test} from 'bun:test';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {memoryPostgrest} from './helpers/memory-postgrest';
import {stableUuid} from '../src/lib/mitti-create-claim.core';
import * as crewCore from '../src/lib/piisa-a3.core';
import * as bookingCore from '../src/lib/in-house-booking.core';
test('Book and Change Lead Installer return saved results without awaiting any form or notice task; failed validation performs zero writes',async()=>{
 const tables:any={jobs:[{id:'j',stage:'installation_scheduling',updated_at:'2026-11-01T00:00:00Z',deleted_at:null}],bookings:[],workflow_events:[]};
 const raw:any=memoryPostgrest(tables);let writes=0,scheduled=0,invalid=false;
 raw.rpc=async(name:string)=>{if(name==='in_house_visit_revision')return{data:'revision',error:null};writes++;return{data:{bookingId:'saved-booking',workId:'saved-work',already:false},error:null};};
 const deps:any={'@/integrations/supabase/client.server':{supabaseAdmin:raw},'./mitti-create-claim.core':{stableUuid},'./piisa-a3.core':crewCore,'./in-house-booking.core':bookingCore,
 './booking.server':{validateBooking:async()=>{if(invalid)throw Error('Deposit not paid');}},
 './in-house-booking.server':{bookingTeam:async()=>({workers:[{id:'new',name:'Pat',tradeRole:'installer',workerRole:'lead',cleared:true,escRegistered:true,escRegisteredAt:'2026-11-01',reason:null}]})},
 './piisa-a3.server':{loadCrew:async()=>({staff:[{workerId:'new',name:'Pat',eecVerified:true,cleared:true,workerRole:'lead'}]})},
 './in-house-saved-work.server':{startInHouseSavedWork:()=>{scheduled++;return new Promise(()=>{});}}};
 const api:any={};new Function('exports','require',ts.transpile(readFileSync('src/lib/in-house-atomic-save.server.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}))(api,(p:string)=>{if(!(p in deps))throw Error(`Unmocked ${p}`);return deps[p];});
 invalid=true;await expect(api.saveInHouseVisit('j','actor',{kind:'installation',start:'2026-11-10',workerId:'new'})).rejects.toThrow('Deposit not paid');expect(writes).toBe(0);expect(scheduled).toBe(0);
 invalid=false;for(const kind of ['installation','crew']){const result=await Promise.race([api.saveInHouseVisit('j','actor',{kind,start:'2026-11-10',workerId:'new'}),new Promise(r=>setTimeout(()=>r('timed out'),2000))]);expect(result).toMatchObject({bookingId:'saved-booking'});}
 expect(writes).toBe(2);expect(scheduled).toBe(2);
});