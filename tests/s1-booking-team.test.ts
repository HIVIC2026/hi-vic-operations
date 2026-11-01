import {expect,test} from 'bun:test';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {memoryPostgrest} from './helpers/memory-postgrest';
import * as core from '../src/lib/in-house-booking.core';
import * as compliance from '../src/lib/worker-compliance.core';
import * as allocation from '../src/lib/visit-allocation.core';
import * as payments from '../src/lib/payments.core';
function fixture(){
 const rows:any={partner_workers:Array.from({length:405},(_,i)=>({id:`w${i}`,business_id:'b',trade_role:'installer',removed_at:null,esc_registered:true,esc_registered_at:'2026-11-01'}))};
 const db=memoryPostgrest(rows),from=db.from.bind(db);let pages=0;const started=new Set<string>();let open=0,maxOpen=0;
 const delay=async<T>(name:string,value:T)=>{started.add(name);open++;maxOpen=Math.max(maxOpen,open);await new Promise(r=>setTimeout(r,25));open--;return value;};
 db.from=(t:string)=>{const q=from(t),run=q.run.bind(q);q.run=async()=>{pages++;return delay('workers',await run());};return q;};
 const deps:any={'@/integrations/supabase/client.server':{supabaseAdmin:db},'./in-house-booking.core':core,'./mitti-create-claim.core':{},'./trade-view.server':{requireTradeJob:async(u:string,j:string)=>{if(u!=='office'||j!=='j')throw Error('Forbidden');return{boss:true,kind:'installer',biz:{id:'b'}};}},'./in-house-suppression.server':{readInHouseDispatchState:async()=>({held:new Set(['j']),failed:false})},'./visit-allocation.server':{allocationCandidates:async()=>delay('candidates',rows.partner_workers.map((w:any)=>({workerId:w.id,name:w.id,tradeRole:'installer',workerRole:'lead',clearance:{certStatus:'verified',level:'full',expiresOn:'2027-12-01'}})))},'./worker-compliance.core':compliance,'./visit-allocation.core':allocation,'./payments.core':payments,'./payments.server':{jobPaymentView:async()=>delay('payment',{steps:[{key:'install_deposit',state:'paid'}]})},'./piisa-a3.server':{loadCrew:async()=>delay('crew',{selection:{lead:'w1',additional:[]}})}};
 const api:any={};new Function('exports','require',ts.transpile(readFileSync('src/lib/in-house-booking.server.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}))(api,(p:string)=>{if(!(p in deps))throw Error(`Unmocked ${p}`);return deps[p];});return{api,started,pages:()=>pages,max:()=>maxOpen};
}
test('booking picker overlaps independent candidate/payment/crew reads; retains all 405 Team members in three pages',async()=>{const f=fixture();const start=performance.now();const response=f.api.bookingTeam('j','office');await new Promise(r=>setTimeout(r,8));expect([...f.started].sort()).toEqual(['candidates','crew','payment','workers']);const out=await response;expect(out.workers).toHaveLength(405);expect(f.pages()).toBe(3);expect(out.depositPaid).toBe(true);expect(out.selection.lead).toBe('w1');expect(f.max()).toBeLessThanOrEqual(6);console.log(`S1 booking Team 405: ${(performance.now()-start).toFixed(1)}ms (25ms/read)`);});
test('two different installers cannot read each other’s Team',async()=>{const f=fixture();await expect(f.api.bookingTeam('j','other-office')).rejects.toThrow('Forbidden');expect(f.started.size).toBe(0);});
