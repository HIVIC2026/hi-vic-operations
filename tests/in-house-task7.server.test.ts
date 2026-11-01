import {expect,test} from 'bun:test';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {memoryPostgrest} from './helpers/memory-postgrest';
import * as core from '../src/lib/in-house-booking.core';
import {stableUuid} from '../src/lib/mitti-create-claim.core';
function fixture(){
 const now=new Date('2026-11-02T03:00:00Z');
 const rows:any={bookings:[{id:'b',job_id:'j',kind:'installation',status:'confirmed',scheduled_start:'2026-11-02T21:00:00Z',created_at:now.toISOString()}],jobs:[{id:'j',job_number:'HV-1',source:'base44',stage:'installation_booked',deleted_at:null,owners:{email:'owner@example.invalid',phone:'0400000000'}}],job_assignments:[{job_id:'j',role:'installer',active:true,business_id:'biz',businesses:{name:'Example',trading_name:null,phone:'0399999999'}}],workflow_events:[]};
 rows.jobs[0].owner_id='o';rows.owners=[{id:'o',email:'owner@example.invalid',phone:'0400000000'}];rows.businesses=[{id:'biz',name:'Example',trading_name:null,phone:'0399999999'}];
 const sends:any[]=[];const shim=memoryPostgrest(rows);
 const deps:any={'@/integrations/supabase/client.server':{supabaseAdmin:shim},'./in-house-booking.core':core,'./mitti-create-claim.core':{stableUuid},'./in-house-suppression.server':{readInHouseDispatchState:async()=>({held:new Set(['j']),failed:false})},'./quote-hold.core':{smsQuietReason:()=>null},'./comms.server':{assertCustomerDeliveryAllowed:async()=>{}},'./partner-email.core':{partnerEmailLayout:()=>({html:'body',text:'body'})},'./owner-email-send.server':{sendGuardedOwnerEmail:async(p:any)=>{if(!sends.some(x=>x.key===p.key)){sends.push({channel:'email',key:p.key});}return 'sent';}},'./sms.server':{sendRealSms:async(p:any)=>{if(!sends.some(x=>x.key===p.idempotencyKey))sends.push({channel:'sms',key:p.idempotencyKey,to:p.to,body:p.body});return{status:'sent'};}},'./swms.server':{loadSwms:async()=>{sends.push({channel:'swms'});}},'./swms-sign-text.server':{textSwmsSignLinks:async()=>{sends.push({channel:'worker-usual-messages'});}},'./melbourne-time.core':{melbourneToday:()=> '2026-11-03'}};
 const api:any={};new Function('exports','require',ts.transpile(readFileSync('src/lib/in-house-booking.server.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}))(api,(p:string)=>{if(!(p in deps))throw Error(`Unmocked dependency ${p}`);return deps[p];});
 return{api,rows,sends,now,deps};
}
test('actual owner booking helper attempts one email and link-free owner text per booking/person replay',async()=>{const f=fixture();const who={id:'w',name:'Pat',phone:'0411111111'};for(let i=0;i<2;i++)await f.api.notifyOwnerBooked('j','install','2026-11-02T21:00:00Z',who,f.now);expect(f.sends.map(x=>x.channel)).toEqual(['email','sms']);expect(f.sends[1].to).toBe('0400000000');expect(f.sends[1].body).not.toMatch(/https?:/);});
test('no booking confirmation for a cancelled or no-longer-current booking',async()=>{const f=fixture();f.rows.bookings[0].status='cancelled';await f.api.notifyOwnerBooked('j','install','2026-11-02T21:00:00Z',{id:'w',name:'Pat',phone:null},f.now);expect(f.sends).toEqual([]);});
test('same-day live block clears only for acknowledgment of latest Lead Installer change',async()=>{const f=fixture();f.rows.workflow_events.push({id:'c',job_id:'j',event_type:'in_house_lead_changed',created_at:'2026-11-02T20:00:00Z',details:{start:'2026-11-02T21:00:00Z',worker_id:'w'}});expect(await f.api.leadNoticeBlocker('j',new Date('2026-11-02T21:00:00Z'))).toBe(core.LEAD_INSTALLER_NOTICE_WAIT);f.rows.workflow_events.push({id:'ack',job_id:'j',event_type:'in_house_esc_notice_updated',details:{change_id:'c'}});expect(await f.api.leadNoticeBlocker('j',new Date('2026-11-02T21:00:00Z'))).toBeNull();});
test('quiet-hours booking persists intent and sweep delivers at 7am once',async()=>{
 const f=fixture();let quiet=true;f.deps['./quote-hold.core'].smsQuietReason=()=>quiet?'quiet':null;
 await f.api.notifyOwnerBooked('j','install','2026-11-02T21:00:00Z',{id:'w',name:'Pat',phone:null},new Date('2026-11-02T10:00:00Z'));
 expect(f.sends).toHaveLength(0);expect(f.rows.workflow_events.some((e:any)=>e.event_type==='in_house_booked_notice_pending')).toBe(true);
 quiet=false;await f.api.sweepOwnerBookedNotices(new Date('2026-11-02T20:00:00Z'));await f.api.sweepOwnerBookedNotices(new Date('2026-11-02T20:00:00Z'));
 expect(f.sends.map((s:any)=>s.channel)).toEqual(['email','sms']);
});
test('paused booking notice resumes from recorded intent without rebooking',async()=>{
 const f=fixture();let paused=true;f.deps['./comms.server'].assertCustomerDeliveryAllowed=async()=>{if(paused)throw Error('paused');};
 await f.api.notifyOwnerBooked('j','install','2026-11-02T21:00:00Z',{id:'w',name:'Pat',phone:null},f.now);
 expect(f.sends).toHaveLength(0);paused=false;await f.api.sweepOwnerBookedNotices(f.now);expect(f.sends).toHaveLength(2);expect(f.rows.bookings).toHaveLength(1);
});
for(const lodged of [false,true])test(`Lead Installer swap ${lodged?'after':'before'} lodged notice raises only required office work`,async()=>{
 const f=fixture();
 f.deps['./trade-view.server']={requireTradeJob:async()=>({boss:true,kind:'installer',biz:{id:'biz'}})};
 f.deps['./visit-allocation.server']={allocationCandidates:async()=>[{workerId:'new',name:'Pat Smith',mobile:null,tradeRole:'installer',workerRole:'lead',clearance:{certStatus:'verified',level:'full',expiresOn:'2027-12-31'}}]};
 f.deps['./payments.server']={jobPaymentView:async()=>({steps:[]})};f.deps['./piisa-a3.server']={loadCrew:async()=>({selection:null})};
 f.deps['./worker-compliance.core']={crewClearance:()=>({cleared:true}),melbourneToday:()=> '2026-11-02',electricianVerified:()=>({ok:false})};
 f.deps['./visit-allocation.core']={allocationBlocker:()=>null};
 f.rows.partner_workers=[{id:'new',business_id:'biz',trade_role:'installer',esc_registered:true,esc_registered_at:'2026-10-01',removed_at:null}];
 f.rows.esc_notifications=lodged?[{id:'notice',job_id:'j',sent_at:'2026-11-01T00:00:00Z',submission_reference:'VEU-1',response:null}]:[];
 f.deps['./esc.core']={isWithdrawn:()=>false};
 f.deps['./esc.server']={regenerateEscNotification:async()=>f.sends.push({channel:'robot-queue'})};
 f.deps['./in-house-booking-notices.server']={notifyOfficeLeadChanged:async(_j:string,_c:string,line:string)=>f.sends.push({channel:'office-email',line})};
 await f.api.recordLeadChange('j','actor','old','new',f.now);
 expect(f.sends.filter(s=>s.channel==='office-email')).toHaveLength(lodged?1:0);
 expect(f.sends.filter(s=>s.channel==='robot-queue')).toHaveLength(lodged?1:0);
 if(lodged)expect(f.sends.find(s=>s.channel==='office-email')?.line).toBe('Update ESC: Lead Installer for HV-1 is now Pat Smith.');
 else expect(await f.api.leadNoticeBlocker('j',new Date('2026-11-02T21:00:00Z'))).toBeNull();
});