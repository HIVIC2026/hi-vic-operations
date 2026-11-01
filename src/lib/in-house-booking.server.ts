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
  type Row={id:string;trade_role:string;licence_number:string|null;rec_number:string|null;licence_expires_on:string|null;licence_verified_at:string|null;esc_registered?:boolean;esc_registered_at?:string|null};
  const readWorkers = async () => {
    const rows: Row[] = [];
    for(let from=0;;from+=200){const page=await read<Row[]>(db.from('partner_workers').select('*').eq('business_id',c.biz.id).is('removed_at',null).order('id').range(from,from+199));rows.push(...page);if(page.length<200)break;}
    return rows;
  };
  // All depend only on the already checked job/business; no shared cross-user cache.
  const [candidates, rows, view, crew] = await Promise.all([
    import('./visit-allocation.server').then(m => m.allocationCandidates(c.biz.id)),
    readWorkers(),
    import('./payments.server').then(m => m.jobPaymentView(jobId)),
    import('./piisa-a3.server').then(m => m.loadCrew(jobId)),
  ]);
  const rowsById = new Map(rows.map(row => [row.id, row]));
  const {electricianVerified,crewClearance,melbourneToday}=await import('./worker-compliance.core');
  const {allocationBlocker}=await import('./visit-allocation.core');
  const workers:BookingWorker[]=candidates.map(w=>{const r=rowsById.get(w.workerId);return{id:w.workerId,name:w.name,phone:w.mobile,tradeRole:w.tradeRole,workerRole:w.workerRole??null,cleared:crewClearance(w.clearance??{certStatus:null,level:null,expiresOn:null},melbourneToday()).cleared,reason:w.tradeRole==='installer'?allocationBlocker('install',w,melbourneToday(),{bookingCreatedAt:null}):w.declarationsDue?'Worker declarations must be signed before booking.':null,electricianVerified:r?.trade_role==='electrician'&&electricianVerified(r).ok,escRegistered:r?.esc_registered===true,escRegisteredAt:r?.esc_registered_at??null};});
  const paid=!!view&&(await import('./payments.core')).isStepPaid(view.steps,'install_deposit');
  return{workers,depositPaid:paid,selection:crew.selection};
}
export async function prepareBookingWorker(jobId:string,userId:string,kind:string,workerId:string,crewIds:string[]=[],options?:{inline?:boolean}){
  const team=await bookingTeam(jobId,userId);const w=team.workers.find(w=>w.id===workerId)??null;
  const reason=bookingWorkerBlocker(kind,w);if(reason||!w)throw Error(reason??'Choose the person going.');
  if(kind==='installation'&&!team.depositPaid)throw Error('The owner must pay the 10% installation deposit before the install can be booked.');
  if(kind==='assessment'||kind==='rectification')await (await import('./in-house-electrician.server')).allocateElectrician(jobId,userId,workerId);
  else if(kind==='installation'){
    const allocation=await import('./visit-allocation.server');
    const save=options?.inline?allocation.saveCrewWithLeadInline:allocation.saveCrewWithLead;
    await save(jobId,userId,{lead:workerId,additional:crewIds.map(workerId=>({workerId}))});
  }
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
  const key=`in-house-booked:v1:${booking.id}:${who.id}`;
  const intentId=await stableUuid(`${key}:intent`);
  const intent=await db.from('workflow_events').insert({id:intentId,job_id:jobId,actor_id:null,event_type:'in_house_booked_notice_pending',summary:'Booking confirmation awaiting delivery',details:{kind,startIso,who,booking_id:booking.id},internal:true});
  if(intent.error&&intent.error.code!=='23505')throw Error(intent.error.message);
  if((await import('./quote-hold.core')).smsQuietReason(now.toISOString()))return 'quiet hours';
  try {
  await (await import('./comms.server')).assertCustomerDeliveryAllowed(jobId,'Booking confirmation');
  const b=a.businesses;const n=bookingNotice({kind,start:startIso,who,installer:b.trading_name||b.name,phone:b.phone});
  const {partnerEmailLayout}=await import('./partner-email.core');
  const email=await (await import('./owner-email-send.server')).sendGuardedOwnerEmail({jobId,jobSource:job.source,to:job.owners.email,purpose:'in_house_booked',key,retryAfterDefiniteFailure:true,beforeSend:async()=>{
    const current=await read<{id:string}|null>(db.from('bookings').select('id').eq('id',booking.id).eq('job_id',jobId).eq('status','confirmed').eq('scheduled_start',startIso).maybeSingle());
    if(!current)throw Error('Booking changed; confirmation held.');
    await (await import('./comms.server')).assertCustomerDeliveryAllowed(jobId,'Booking confirmation');
  },build:()=>({subject:n.subject,...partnerEmailLayout({subject:n.subject,blocks:[{kind:'p',text:n.text}],test:job.source==='qa_test'})})});
  const sms=await (await import('./sms.server')).sendRealSms({jobId,type:'in_house_booked_owner',to:job.owners.phone,body:n.sms,idempotencyKey:`${key}:sms`,event:{at:booking.created_at,current:true}});
  if(email==='sent'&&['sent','already','already_sent'].includes(sms.status)){
    const result=await db.from('workflow_events').update({event_type:'in_house_booked_notice_delivered'}).eq('id',intentId);if(result.error)throw Error(result.error.message);
  }
  return `${email}; ${sms.status}`;
  }catch(e){return `held: ${e instanceof Error?e.message:'delivery unavailable'}`;}
}
export async function sweepOwnerBookedNotices(now=new Date()){
  if((await import('./quote-hold.core')).smsQuietReason(now.toISOString()))return {checked:0};
  const rows:{job_id:string;details:{kind:'ready_check'|'piesa'|'install';startIso:string;who:Pick<BookingWorker,'id'|'name'|'phone'>}}[]=[];
  for(let offset=0;;offset+=200){const page=await read<typeof rows>(db.from('workflow_events').select('job_id,details').eq('event_type','in_house_booked_notice_pending').order('id').range(offset,offset+199));rows.push(...page);if(page.length<200)break;}
  for(const row of rows)await notifyOwnerBooked(row.job_id,row.details.kind,row.details.startIso,row.details.who,now);
  const workers:{job_id:string;details:{booking_id?:string;status?:string}}[]=[];
  for(let offset=0;;offset+=200){const pending=await db.from('workflow_events').select('job_id,details').eq('event_type','in_house_electrician_booking_notice').order('id').range(offset,offset+199);if(pending.error)throw Error(pending.error.message);workers.push(...(pending.data??[]) as typeof workers);if((pending.data?.length??0)<200)break;}
  for(const row of workers)if(row.job_id&&row.details.booking_id&&row.details.status!=='sent')await (await import('./in-house-electrician-booked.server')).notifyInHouseElectricianBooked(row.job_id,row.details.booking_id,now);
  return {checked:rows.length};
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
  const notices=await read<{id:string;sent_at:string|null;submission_reference:string|null;response:unknown}[]>(db.from('esc_notifications').select('id,sent_at,submission_reference,response').eq('job_id',jobId).not('sent_at','is',null).order('created_at',{ascending:false}));
  const {isWithdrawn}=await import('./esc.core');
  const sent=notices.find(n=>n.sent_at&&n.submission_reference&&!isWithdrawn(n));
  const j=await read<{job_number:string}|null>(db.from('jobs').select('job_number').eq('id',jobId).maybeSingle());
  const id=await stableUuid(`lead-change:${jobId}:${book.id}:${oldWorkerId}:${newWorkerId}:${now.toISOString()}`);
  const line=`Update ESC: Lead Installer for ${j?.job_number??jobId} is now ${w.name}.`;
  if(sent){
    const {error}=await db.from('workflow_events').insert({id,job_id:jobId,actor_id:actorId,event_type:'in_house_lead_changed',summary:line,details:{start:book.scheduled_start,worker_id:newWorkerId,name:w.name,old_worker_id:oldWorkerId,booking_id:book.id,notification_id:sent.id,update_same_id:true},internal:true});if(error&&error.code!=='23505')throw Error(error.message);
    await (await import('./esc.server')).regenerateEscNotification(jobId,actorId);
    const {partnerEmailLayout}=await import('./partner-email.core');
    const {OFFICE_REPLY_TO}=await import('./office-email.core');
    await (await import('./in-house-office-alert.server')).sendInHouseOfficeAlert({jobId,jobSource:null,actorId,to:OFFICE_REPLY_TO,subject:line,...partnerEmailLayout({subject:line,blocks:[{kind:'p',text:line}]}),idempotencyKey:`esc-lead-alert:${id}`});
  }
  // SWMS derives its signer list from the newly saved crew; old signatures never authorise the replacement.
  await (await import('./swms.server')).loadSwms(jobId);
  await (await import('./swms-sign-text.server')).textSwmsSignLinks(jobId,book,now);
}