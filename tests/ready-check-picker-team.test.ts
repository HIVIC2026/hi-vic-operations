// Part 7 Task 9 (Jo 5 Nov 2026): anyone on the installer's Team can do the Ready Check (it's just measuring up), so the
// Ready Check "who's going" picker lists the whole Team — Leads AND Crew, installers only (never an electrician). The
// install-day picker is unchanged: Lead Installers only. Jo's 5 Nov rule (PR #173, no stored role = Crew) is honoured by
// reading the role the Team reader already resolved (`workerRole`), never the stored column.
import {expect,test} from 'bun:test';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {memoryPostgrest} from './helpers/memory-postgrest';
import * as core from '../src/lib/in-house-booking.core';
import * as compliance from '../src/lib/worker-compliance.core';
import * as allocation from '../src/lib/visit-allocation.core';
import * as payments from '../src/lib/payments.core';
import {bookingWorkerBlocker,readyCheckChoices,installLeadChoices,type BookingWorker} from '../src/lib/in-house-booking.core';

// Deep's Team: 6 installers (2 Lead Installers, 4 Crew) and the business's electrician.
const team=[
 {id:'deep',name:'Deep',tradeRole:'installer',workerRole:'lead'},
 {id:'raj',name:'Raj',tradeRole:'installer',workerRole:'lead'},
 {id:'amit',name:'Amit',tradeRole:'installer',workerRole:'crew'},
 {id:'sunny',name:'Sunny',tradeRole:'installer',workerRole:'crew'},
 {id:'harpreet',name:'Harpreet',tradeRole:'installer',workerRole:'crew'},
 {id:'manny',name:'Manny',tradeRole:'installer',workerRole:'crew'},
 {id:'sparky',name:'Will',tradeRole:'electrician',workerRole:null},
] as const;
const worker=(w:typeof team[number]):BookingWorker=>({id:w.id,name:w.name,phone:null,tradeRole:w.tradeRole,workerRole:w.workerRole,cleared:true,
 reason:w.tradeRole==='installer'?allocation.allocationBlocker('install',{workerId:w.id,name:w.name,tradeRole:w.tradeRole,email:null,mobile:null,removedAt:null,workerRole:w.workerRole,businessEmail:null,clearance:{certStatus:'verified',level:'full',expiresOn:'2027-12-01'},whiteCard:null},'2026-11-05',{bookingCreatedAt:null}):null,
 crewAllowed:w.tradeRole==='installer',electricianVerified:w.tradeRole==='electrician',escRegistered:w.workerRole==='lead',escRegisteredAt:w.workerRole==='lead'?'2026-11-01':null});
const workers=team.map(worker);

test('Ready Check picker lists the whole Team (6 installers, Leads and Crew); the electrician is not on it',()=>{
 expect(readyCheckChoices(workers).map(w=>w.id)).toEqual(['deep','raj','amit','sunny','harpreet','manny']);
 for(const w of readyCheckChoices(workers))expect(bookingWorkerBlocker('ready_check',w)).toBeNull();
});
test('install picker still lists only the 2 Lead Installers',()=>{
 expect(installLeadChoices(workers).map(w=>w.id)).toEqual(['deep','raj']);
 expect(bookingWorkerBlocker('installation',worker(team[2]))).not.toBeNull();
});
test('an electrician cannot be booked as the Ready Check person (server gate); a Crew member can',()=>{
 expect(bookingWorkerBlocker('ready_check',worker(team[6]))).toBe(core.READY_CHECK_INSTALLER_ONLY_REASON);
 expect(bookingWorkerBlocker('ready_check',worker(team[2]))).toBeNull();
 // Crew with the install-day reason set (the Team reader sets it for everyone) is still fine for the Ready Check.
 expect(worker(team[2]).reason).not.toBeNull();
 // "Not sure yet" (G7): no person at all is still only refused by the pick-a-person line, as before.
 expect(bookingWorkerBlocker('ready_check',null)).toBe('Choose the person going before booking.');
});

// The Team reader itself (in-house-booking.server bookingTeam) with Deep's Team: all 6 come back for the Ready Check.
function fixture(){
 const rows:any={partner_workers:team.map(w=>({id:w.id,business_id:'b',trade_role:w.tradeRole,worker_role:w.workerRole,removed_at:null,esc_registered:w.workerRole==='lead',esc_registered_at:w.workerRole==='lead'?'2026-11-01':null,licence_number:w.tradeRole==='electrician'?'A1':null,rec_number:w.tradeRole==='electrician'?'R1':null,licence_expires_on:'2027-12-01',licence_verified_at:'2026-11-01'}))};
 const db=memoryPostgrest(rows);
 const deps:any={'@/integrations/supabase/client.server':{supabaseAdmin:db},'./in-house-booking.core':core,'./mitti-create-claim.core':{},
  './trade-view.server':{requireTradeJob:async()=>({boss:true,kind:'installer',biz:{id:'b'}})},
  './in-house-suppression.server':{readInHouseDispatchState:async()=>({held:new Set(['j']),failed:false})},
  './visit-allocation.server':{allocationCandidates:async()=>team.map(w=>({workerId:w.id,name:w.name,tradeRole:w.tradeRole,workerRole:w.workerRole,email:null,mobile:null,removedAt:null,businessEmail:null,clearance:{certStatus:'verified',level:'full',expiresOn:'2027-12-01'}}))},
  './worker-compliance.core':compliance,'./visit-allocation.core':allocation,'./payments.core':payments,
  './payments.server':{jobPaymentView:async()=>({steps:[]})},
  './piisa-a3.server':{loadCrew:async()=>({selection:null,staff:[]})}};
 const api:any={};new Function('exports','require',ts.transpile(readFileSync('src/lib/in-house-booking.server.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}))(api,(p:string)=>{if(!(p in deps))throw Error(`Unmocked ${p}`);return deps[p];});return api;
}
test('bookingTeam: Deep’s 6-person Team all list for the Ready Check, the 2 Leads for the install',async()=>{
 const out=await fixture().bookingTeam('j','office');
 expect(out.workers).toHaveLength(7);
 expect(readyCheckChoices(out.workers).map((w:BookingWorker)=>w.id)).toEqual(['deep','raj','amit','sunny','harpreet','manny']);
 expect(readyCheckChoices(out.workers).every((w:BookingWorker)=>bookingWorkerBlocker('ready_check',w)===null)).toBe(true);
 expect(installLeadChoices(out.workers).map((w:BookingWorker)=>w.id)).toEqual(['deep','raj']);
 expect(installLeadChoices(out.workers).every((w:BookingWorker)=>bookingWorkerBlocker('installation',w)===null)).toBe(true);
});
