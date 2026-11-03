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
 f.deps['./payments.core']={isStepPaid:()=>true};
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
});// Decision #24 + Fix 5 (Jo 2 Nov 2026): the Ready Check "You're booked" uses the approved wording once
// OWNER_BOOKED_V2_APPROVED.ready_check is on; same purpose + key either way, so a booking gets one version.
function readyCheckFixture(){
 const f=fixture();
 f.rows.bookings[0]={id:'b',job_id:'j',kind:'ready_check',status:'confirmed',scheduled_start:'2026-11-03T22:00:00Z',created_at:f.now.toISOString()};
 f.rows.owners[0].full_name='Sarah Jones';
 f.rows.businesses[0]={id:'biz',name:'Rapid Insulation',trading_name:null,phone:'03 9000 0000',email:'office@rapid.example'};
 const built:any[]=[];
 f.deps['./owner-email-send.server']={sendGuardedOwnerEmail:async(p:any)=>{if(f.sends.some((x:any)=>x.key===p.key))return 'already attempted — not resent';const m=p.build();built.push(m);f.sends.push({channel:'email',key:p.key,purpose:p.purpose,subject:m.subject,html:m.html,text:m.text});return 'sent';}};
 f.deps['./sms.server']={sendRealSms:async(p:any)=>{if(!f.sends.some((x:any)=>x.key===p.idempotencyKey))f.sends.push({channel:'sms',key:p.idempotencyKey,type:p.type,to:p.to,body:p.body});return{status:'sent'};}};
 return{...f,built};
}
const ON={v2Approved:{ready_check:true,piesa:false,install:false}};
const who={id:'w',name:'John Smith',phone:'0411 111 111'};
test('Ready Check with the new wording on: approved #24 email + text, office phone only, same purpose and key',async()=>{
 const f=readyCheckFixture();
 expect(await f.api.notifyOwnerBooked('j','ready_check','2026-11-03T22:00:00Z',who,f.now,ON)).toBe('sent; sent');
 const [email,sms]=f.sends;
 expect(email).toMatchObject({channel:'email',key:'in-house-booked:v1:b:w',purpose:'in_house_booked',subject:"You're booked for your free Ready Check"});
 expect(email.text).toContain('Rapid Insulation · 03 9000 0000 · office@rapid.example');
 expect(email.text).toContain('Rebate certificates created by Home Insulation Victoria (Accredited Person A003654).');
 expect(email.html).toContain('Who');
 expect(sms).toMatchObject({key:'in-house-booked:v1:b:w:sms',type:'in_house_booked_owner',to:'0400000000'});
 expect(sms.body).toBe('Home Insulation Victoria: Hi Sarah, you\'re booked for your free Ready Check: Wed 4 Nov, 9:00am. John Smith from Rapid Insulation is coming. Need to change it? Call Rapid Insulation on 03 9000 0000.');
 expect(JSON.stringify(f.sends)).not.toContain('0411 111 111');
 expect(f.rows.workflow_events.some((e:any)=>e.event_type==='in_house_booked_notice_delivered')).toBe(true);
});
test('new wording off (as shipped): the Ready Check gets the current wording, same purpose and key',async()=>{
 const f=readyCheckFixture();
 expect(await f.api.notifyOwnerBooked('j','ready_check','2026-11-03T22:00:00Z',who,f.now)).toBe('sent; sent');
 const old=core.bookingNotice({kind:'ready_check',start:'2026-11-03T22:00:00Z',who,installer:'Rapid Insulation',phone:'03 9000 0000'});
 expect(f.sends[0]).toMatchObject({key:'in-house-booked:v1:b:w',purpose:'in_house_booked',subject:old.subject});
 expect(f.sends[1].body).toBe(old.sms);
});
test('a job that already had the old wording for this booking gets nothing more when the new wording turns on',async()=>{
 const f=readyCheckFixture();
 await f.api.notifyOwnerBooked('j','ready_check','2026-11-03T22:00:00Z',who,f.now);
 await f.api.notifyOwnerBooked('j','ready_check','2026-11-03T22:00:00Z',who,f.now,ON);
 expect(f.sends.filter((s:any)=>s.channel==='email')).toHaveLength(1);
 expect(f.sends.filter((s:any)=>s.channel==='sms')).toHaveLength(1);
});
test('new wording on, no office phone or business email → held with one office note per reason; sent once fixed',async()=>{
 const f=readyCheckFixture();
 f.rows.businesses[0].phone=null;
 for(let i=0;i<2;i++)expect(await f.api.notifyOwnerBooked('j','ready_check','2026-11-03T22:00:00Z',who,f.now,ON)).toBe('held: No office phone for Rapid Insulation');
 f.rows.businesses[0].phone='03 9000 0000';f.rows.businesses[0].email=null;
 expect(await f.api.notifyOwnerBooked('j','ready_check','2026-11-03T22:00:00Z',who,f.now,ON)).toBe('held: No business email for Rapid Insulation');
 expect(f.sends).toEqual([]);
 const notes=f.rows.workflow_events.filter((e:any)=>e.event_type==='owner_booked_held');
 // One note per reason: repeats reuse the same stable id (the real table's primary key refuses the copy; this shim doesn't).
 const byId=new Map(notes.map((e:any)=>[e.id,e.details.reason]));
 expect([...byId.values()]).toEqual(['No office phone for Rapid Insulation','No business email for Rapid Insulation']);
 expect(notes.every((e:any)=>e.internal===true)).toBe(true);
 f.rows.businesses[0].email='office@rapid.example';
 await f.api.sweepOwnerBookedNotices(f.now,ON);
 expect(f.sends.map((s:any)=>s.channel)).toEqual(['email','sms']);
 expect(f.sends[1].body).toContain('Call Rapid Insulation on 03 9000 0000.');
});
test('Change time (an earlier Ready Check booking was cancelled) → "Your time has changed"',async()=>{
 const f=readyCheckFixture();
 f.rows.bookings.push({id:'old',job_id:'j',kind:'ready_check',status:'cancelled',scheduled_start:'2026-11-02T22:00:00Z',created_at:'2026-11-01T00:00:00Z'});
 await f.api.notifyOwnerBooked('j','ready_check','2026-11-03T22:00:00Z',who,f.now,ON);
 expect(f.sends[0].subject).toBe('Your time has changed');
});
test('PIESA and install keep the current wording even with the Ready Check wording on (Part 4)',async()=>{
 const f=readyCheckFixture();
 f.rows.bookings[0]={id:'b',job_id:'j',kind:'installation',status:'confirmed',scheduled_start:'2026-11-03T22:00:00Z',created_at:f.now.toISOString()};
 await f.api.notifyOwnerBooked('j','install','2026-11-03T22:00:00Z',who,f.now,ON);
 expect(f.sends[0].subject).toBe("You're booked — install");
});
