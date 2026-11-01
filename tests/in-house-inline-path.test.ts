import {expect,test} from 'bun:test';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {memoryPostgrest} from './helpers/memory-postgrest';

test('actual inline booking path validates before allocation and calls the canonical confirmer; two offices remain separate',async()=>{
 const tables:any={bookings:[]};const db=memoryPostgrest(tables);const calls:string[]=[];let blocked=false;
 const deps:any={
  '@/integrations/supabase/client.server':{supabaseAdmin:db},
  './booking.server':{validateBooking:async()=>{calls.push('validate');if(blocked)throw Error('Owner not signed');},confirmBooking:async(j:string,kind:string,start:string)=>{calls.push('confirm');tables.bookings.push({id:'b',job_id:j,kind,scheduled_start:start,status:'confirmed'});}},
  './in-house-booking.server':{prepareBookingWorker:async(_j:string,actor:string,_k:string,_w:string,_c:string[],options:any)=>{expect(options).toEqual({inline:true});if(actor!=='own-office')throw Error('Not your in-house job');calls.push('allocate');return{id:'w',name:'TEST'};},notifyOwnerBooked:async()=>{calls.push('notice captured');}},
  './visit-allocation.server':{saveCrewWithLeadInline:async(_j:string,actor:string)=>{if(actor!=='own-office')throw Error('Not your in-house job');calls.push('crew and forms captured');return{needsVerification:[]};}},
 };
 const api:any={};new Function('exports','require',ts.transpile(readFileSync('src/lib/in-house-inline-save.server.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}))(api,(p:string)=>{if(!(p in deps))throw Error(`Unmocked ${p}`);return deps[p];});
 const input={kind:'installation',start:'2026-11-10',workerId:'w',selection:{lead:'w',additional:[]}};
 blocked=true;await expect(api.saveInHouseVisitInline('j','own-office',input)).rejects.toThrow('Owner not signed');expect(tables.bookings).toHaveLength(0);expect(calls).toEqual(['validate']);
 blocked=false;calls.length=0;await expect(api.saveInHouseVisitInline('j','other-office',input)).rejects.toThrow('Not your in-house job');expect(tables.bookings).toHaveLength(0);
 calls.length=0;expect(await api.saveInHouseVisitInline('j','own-office',input)).toMatchObject({bookingId:'b'});expect(calls).toEqual(['validate','allocate','confirm','notice captured']);
 calls.length=0;await api.saveInHouseVisitInline('j','own-office',{...input,kind:'crew'});expect(calls).toEqual(['crew and forms captured']);
 await expect(api.saveInHouseVisitInline('j','other-office',{...input,kind:'crew'})).rejects.toThrow('Not your in-house job');expect(tables.bookings).toHaveLength(1);
});