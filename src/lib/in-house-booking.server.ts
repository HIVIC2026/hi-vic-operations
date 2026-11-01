import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { bookingWorkerBlocker, bookingNotice, leadNoticePending, LEAD_INSTALLER_NOTICE_WAIT, type BookingWorker } from './in-house-booking.core';
import { stableUuid } from './mitti-create-claim.core';
const db=admin as unknown as SupabaseClient;
async function read<T>(q:PromiseLike<{data:unknown;error:{message:string}|null}>):Promise<T>{const r=await q;if(r.error)throw Error(r.error.message);return r.data as T;}
export async function bookingTeam(jobId:string,userId:string){
  const c=await (await import('./trade-view.server')).requireTradeJob(userId,jobId);
  if(!c.boss||c.kind!=='installer')throw Error('Only the installer office can book these visits.');
  const held=await (await import('./in-house-suppression.server')).readInHouseDispatchState([jobId]);
  if(held.failed||!held.held.has(jobId))throw Error('This job is not assigned to your in-house business.');
  const candidates=await (await import('./visit-allocation.server')).allocationCandidates(c.biz.id);
  type Row={id:string;trade_role:string;licence_number:string|null;rec_number:string|null;licence_expires_on:string|null;licence_verified_at:string|null;esc_registered?:boolean;esc_registered_at?:string|null};
  let rows:Row[]=[];
  for(let from=0;;from+=200){const page=await read<Row[]>(db.from('partner_workers').select('*').eq('business_id',c.biz.id).is('removed_at',null).order('id').range(from,from+199));rows.push(...page);if(page.length<200)break;}
  const {electricianVerified,crewClearance,melbourneToday}=await import('./worker-compliance.core');
  const {allocationBlocker}=await import('./visit-allocation.core');
  const workers:BookingWorker[]=candidates.map(w=>{const r=rows.find(r=>r.id===w.workerId);return{id:w.workerId,name:w.name,phone:w.mobile,tradeRole:w.tradeRole,workerRole:w.workerRole,cleared:crewClearance(w.clearance??{certStatus:null,level:null,expiresOn:null},melbourneToday()).cleared,reason:w.tradeRole==='installer'?allocationBlocker('install',w,melbourneToday(),{bookingCreatedAt:null}):w.declarationsDue?'Worker declarations must be signed before booking.':null,electricianVerified:r?.trade_role==='electrician'&&electricianVerified(r).ok,escRegistered:r?.esc_registered===true,escRegisteredAt:r?.esc_registered_at??null};});
  const view=await (await import('./payments.server')).jobPaymentView(jobId);
  const paid=!!view&&(await import('./payments.core')).isStepPaid(view.steps,'install_deposit');
  const crew=await (await import('./piisa-a3.server')).loadCrew(jobId);
  return{workers,depositPaid:paid,selection:crew.selection};
}
export async function prepareBookingWorker(jobId:string,userId:string,kind:string,workerId:string,crewIds:string[]=[]){
  const team=await bookingTeam(jobId,userId);const w=team.workers.find(w=>w.id===workerId)??null;
  const reason=bookingWorkerBlocker(kind,w);if(reason||!w)throw Error(reason??'Choose the person going.');
  if(kind==='installation'&&!team.depositPaid)throw Error('The owner must pay the 10% installation deposit before the install can be booked.');
  if(kind==='assessment'||kind==='rectification')await (await import('./in-house-electrician.server')).allocateElectrician(jobId,userId,workerId);
  else if(kind==='installation')await (await import('./visit-allocation.server')).saveCrewWithLead(jobId,userId,{lead:workerId,additional:crewIds.map(workerId=>({workerId}))});
  else await (await import('./visit-allocation.server')).allocateVisit(jobId,userId,'ready_check',workerId);
  return w;
}
export async function notifyOwnerBooked(jobId:string,kind:'ready_check'|'piesa'|'install',startIso:string,who:Pick<BookingWorker,'id'|'name'|'phone'>,now=new Date()){
  const held=await (await import('./in-house-suppression.server')).readInHouseDispatchState([jobId]);
  if(held.failed||!held.held.has(jobId))return 'held';
  const bookingKind={ready_check:'ready_check',piesa:'assessment',install:'installation'}[kind];
  const booking=await read<{id:string;created_at:string}|null>(db.from('bookings').select('id,created_at').eq('job_id',jobId).eq('kind',bookingKind).eq('status','confirmed').eq('scheduled_start',startIso).order('created_at',{ascending:false}).limit(1).maybeSingle());
  if(!booking||Date.parse(startIso)<=now.getTime())return 'not current';
  const job=await read<{source:string;deleted_at:string|null;stage:string;owners:{email:string|null;phone:string|null}|null}|null>(db.from('jobs').select('source,deleted_at,stage,owners(email,phone)').eq('id',jobId).maybeSingle());
  const a=await read<{businesses:{name:string;trading_name:string|null;phone:string|null}|null}|null>(db.from('job_assignments').select('businesses(name,trading_name,phone)').eq('job_id',jobId).eq('role','installer').eq('active',true).maybeSingle());
  if(!job||job.deleted_at||job.stage==='cancelled'||!job.owners?.email||!a?.businesses)return 'held';
  if((await import('./quote-hold.core')).smsQuietReason(now.toISOString()))return 'quiet hours';
  await (await import('./comms.server')).assertCustomerDeliveryAllowed(jobId,'Booking confirmation');
  const b=a.businesses;const n=bookingNotice({kind,start:startIso,who,installer:b.trading_name||b.name,phone:b.phone});
  const key=`in-house-booked:v1:${booking.id}:${who.id}`;
  const email=await (await import('./owner-email-send.server')).sendGuardedOwnerEmail({jobId,jobSource:job.source,to:job.owners.email,purpose:'in_house_booked',key,retryAfterDefiniteFailure:true,build:async()=>{const {partnerEmailLayout}=await import('./partner-email.core');return partnerEmailLayout({subject:n.subject,blocks:[{kind:'p',text:n.text}],test:job.source==='qa_test'});}});
  const sms=await (await import('./sms.server')).sendRealSms({jobId,type:'in_house_booked_owner',to:job.owners.phone,body:n.sms,idempotencyKey:`${key}:sms`,event:{at:booking.created_at,current:true}});
  return `${email}; ${sms.status}`;
}
export async function latestLeadNotice(jobId:string){
  const change=await read<{id:string;created_at:string;summary:string;details:{start:string;worker_id:string;name:string}}|null>(db.from('workflow_events').select('id,created_at,summary,details').eq('job_id',jobId).eq('event_type','in_house_lead_changed').order('created_at',{ascending:false}).limit(1).maybeSingle());
  if(!change)return null;
  const ack=await read<{id:string}|null>(db.from('workflow_events').select('id').eq('job_id',jobId).eq('event_type','in_house_esc_notice_updated').contains('details',{change_id:change.id}).limit(1).maybeSingle());
  return{...change,acknowledged:!!ack};
}
export async function leadNoticeBlocker(jobId:string,now=new Date()){
  const n=await latestLeadNotice(jobId);return n&&leadNoticePending({id:n.id,start:n.details.start,at:n.created_at},n.acknowledged?n.id:null,now)?LEAD_INSTALLER_NOTICE_WAIT:null;
}
export async function recordLeadChange(jobId:string,actorId:string,oldWorkerId:string|null,newWorkerId:string,now=new Date()){
  if(!oldWorkerId||oldWorkerId===newWorkerId)return;
  const team=await bookingTeam(jobId,actorId);const w=team.workers.find(w=>w.id===newWorkerId);if(!w)throw Error('Not your Team member.');
  const book=await read<{id:string;scheduled_start:string}|null>(db.from('bookings').select('id,scheduled_start').eq('job_id',jobId).eq('kind','installation').eq('status','confirmed').order('created_at',{ascending:false}).limit(1).maybeSingle());if(!book)return;
  const j=await read<{job_number:string}|null>(db.from('jobs').select('job_number').eq('id',jobId).maybeSingle());
  const id=await stableUuid(`lead-change:${jobId}:${book.id}:${oldWorkerId}:${newWorkerId}:${now.toISOString()}`);
  const {error}=await db.from('workflow_events').insert({id,job_id:jobId,actor_id:actorId,event_type:'in_house_lead_changed',summary:`Update the ESC install notice: Lead Installer changed to ${w.name} for ${j?.job_number??jobId} on ${(await import('./melbourne-time.core')).melbourneToday(new Date(book.scheduled_start))}`,details:{start:book.scheduled_start,worker_id:newWorkerId,name:w.name,old_worker_id:oldWorkerId,booking_id:book.id},internal:true});if(error)throw Error(error.message);
  // SWMS derives its signer list from the newly saved crew; old signatures never authorise the replacement.
  await (await import('./swms.server')).loadSwms(jobId);
  await (await import('./swms-sign-text.server')).textSwmsSignLinks(jobId,book,now);
}