// Task 6: specific in-house deposit messages only. No broad dispatch-suppression bypass.
// Existing invoice/payment/clearance readers and delivery boundaries remain authoritative.
import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import { readInHouseDispatchState } from './in-house-suppression.server';
import { depositReminderDue, depositRequestEligible, INSTALL_DEPOSIT_REQUEST_EVENT, installDepositRequestKey, type DepositReminder } from './deposit-request.core';
import { DEPOSIT_MESSAGES_V2_APPROVED, depositOwnerText, renderInstallDepositOwnerEmail, renderInstallerDepositPaidEmail, type DepositMessageFacts } from './deposit-request-email.core';
import { INSTALL_DEPOSIT_DUE_STAGES, isStepPaid } from './payments.core';
import { fullAddress } from './address';
import { CLEAR_TO_INSTALL_EMAIL_APPROVED, UPGRADES_NEEDED_EMAIL_APPROVED, type PiesaResultRoute } from './piesa-result-route.core';
import type { EmailAttachment } from './email-kit.core';
import type { DepositPaidArgs, DepositPaidInputs } from './deposit-paid-inputs.server';
import { SET_PASSWORD_BASE } from './set-password-link.core';

async function factsFor(jobId:string,now:Date) {
  const held=await readInHouseDispatchState([jobId]);
  if(held.failed)throw Error('Could not check deposit partner.');
  if(!held.held.has(jobId))return null;
  const [{data:job,error:je},{data:assignment,error:ae},c,v]=await Promise.all([
    admin.from('jobs').select('id,job_number,source,stage,deleted_at,qa_archived_at,owners(full_name,email,phone),properties(address_line,suburb,postcode)').eq('id',jobId).maybeSingle(),
    admin.from('job_assignments').select('business_id,businesses(name,trading_name,email)').eq('job_id',jobId).eq('role','installer').eq('active',true).maybeSingle(),
    (await import('./install-days.server')).installDayContext(jobId),
    (await import('./payments.server')).jobPaymentView(jobId,now),
  ]);
  if(je||ae)throw Error('Could not read deposit message safeguards.');
  if(!job||job.deleted_at||job.qa_archived_at||['cancelled','on_hold','complete'].includes(job.stage)||!v||!c.deadline||!assignment?.business_id)return null;
  const owner=job.owners as {full_name:string|null;email:string|null;phone:string|null}|null;
  const prop=job.properties as {address_line:string;suburb:string|null;postcode:string|null}|null;
  const biz=assignment.businesses as {name:string;trading_name:string|null;email:string|null}|null;
  const invoice=v.invoices.install;
  if(!owner||!biz||!invoice?.xero_invoice_id||v.plan.installDepositCents<=0)return null;
  const paid=isStepPaid(v.steps,'install_deposit');
  const link=await (await import('./veec-copy-email.server')).ownerMyJobLink(jobId);
  const f:DepositMessageFacts={name:owner.full_name?.split(' ')[0]||'there',installer:biz.trading_name||biz.name,jobNumber:job.job_number??'',address:prop?fullAddress(prop.address_line,prop.suburb,prop.postcode):'',ownerPhone:owner.phone,deadline:c.deadline,amountCents:v.steps.find(s=>s.key==='install_deposit')?.outstandingCents??v.plan.installDepositCents,link:link?`${link}${link.includes('?')?'&':'?'}screen=pay`:'',bank:v.bank,reference:v.reference,card:v.stripe.available};
  return{job,assignment,owner,biz,c,v,paid,f};
}
/** Jo 2 Nov (answer 21): the deposit opens on the recorded PIESA result, whatever it found. */
async function piesaOutcomeFor(jobId:string){
  const {clearanceFacts}=await import('./allocation.server');
  const o=(await clearanceFacts(jobId)).piesaOutcome;
  return o==='pass'?'all_clear' as const:o==='fail'?'upgrades_needed' as const:null;
}
async function requestRecord(jobId:string,invoiceId:string){
  const r=await admin.from('workflow_events').select('created_at,details').eq('job_id',jobId).eq('event_type',INSTALL_DEPOSIT_REQUEST_EVENT).contains('details',{invoice_id:invoiceId}).limit(1).maybeSingle();
  if(r.error)throw Error('Could not read deposit request history.');
  return r.data;
}
/** Deterministic event primary key gives a concurrency-safe claim without a new table or live migration. */
async function recordRequest(jobId:string,invoiceId:string,now:Date,deadline:string){
  const key=installDepositRequestKey(invoiceId);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key)))).map(x=>x.toString(16).padStart(2,'0')).join('');
  const id=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
  const r=await admin.from('workflow_events').insert({id,job_id:jobId,actor_id:null,event_type:INSTALL_DEPOSIT_REQUEST_EVENT,summary:'10% install deposit requested on the existing installation invoice',created_at:now.toISOString(),internal:true,details:{key,invoice_id:invoiceId,requested_at:now.toISOString(),deadline}});
  if(r.error&&r.error.code!=='23505')throw Error(r.error.message);
}
/** Part 4 Task 3 (#40): everything the "You're clear to install" send needs, injected so it is testable without PDFs or a database. */
export type ClearToInstallDeps={
  approved:boolean;
  /** UPGRADES_NEEDED_EMAIL_APPROVED: when on, the upgrades-needed email (not this request) carries the deposit for upgrades-still-to-come jobs. */
  upgradesApproved?:boolean;
  route:(jobId:string)=>Promise<PiesaResultRoute[]>;
  inputs:(jobId:string)=>Promise<{checkedOn:string;electrician:string;piesaRecordId:string;signedCopyId:string;attachments:EmailAttachment[]}|{held:string}>;
  /** Task 6: DEPOSIT_MESSAGES_V2_APPROVED (#43/#44/#45 wording). */
  v2?:boolean;
  /** Task 6 (#44): office phone + receipt + owner-confirmed PIESA for Deposit received. */
  paid?:(a:DepositPaidArgs)=>Promise<DepositPaidInputs|{held:string}>;
  record:(p:{jobId:string;recipient:'owner';piesaRecordId:string;signedCopyId:string;recipientUserId:string|null;to:string;detail:string})=>Promise<void>;
};
const CLEAR_HELD='Clear to install documents not ready';
export function defaultClearToInstallDeps():ClearToInstallDeps{
  return{
    approved:CLEAR_TO_INSTALL_EMAIL_APPROVED,
    upgradesApproved:UPGRADES_NEEDED_EMAIL_APPROVED,
    v2:DEPOSIT_MESSAGES_V2_APPROVED,
    paid:async a=>(await import('./deposit-paid-inputs.server')).depositPaidInputs(a),
    route:async j=>(await import('./piesa-delivery.server')).ownerPiesaRoute(j),
    inputs:async j=>(await import('./clear-to-install.server')).clearToInstallInputs(j),
    record:async p=>{
      // Idempotent: a replay after a provider-accepted send must not double-record.
      const have=await admin.from('piesa_deliveries').select('id',{count:'exact',head:true}).eq('piesa_record_id',p.piesaRecordId).eq('recipient','owner');
      if(have.error)throw Error('Could not read PIESA deliveries.');
      if(have.count)return;
      await (await import('./piesa-delivery.server')).recordDelivery(p);
    },
  };
}
type Facts=NonNullable<Awaited<ReturnType<typeof factsFor>>>;
async function ownerNotice(jobId:string,c:Facts,step:'request'|'paid'|DepositReminder,at:string,now:Date,deps:ClearToInstallDeps){
  // Quiet hours are checked before either channel; no deferred text at a different time to its email.
  if((await import('./quote-hold.core')).smsQuietReason(now.toISOString()))return 'quiet hours';
  // Upgrades still to come and that email is on: its button already carries the 10% deposit, so no second request (reminders unchanged).
  if(step==='request'&&deps.upgradesApproved&&(await deps.route(jobId)).includes('upgrades_needed'))return 'covered by the electrical upgrades needed email';
  const clear=step==='request'&&deps.approved&&(await deps.route(jobId)).includes('clear_to_install');
  // The clear-to-install email carries the owner's legal PIESA copy, so the 24h stale rule never holds it back.
  if(!clear&&(step==='request'||step==='paid') && now.getTime()-Date.parse(at)>86_400_000)return 'stale notice held';
  // The clear-to-install email carries the owner's PIESA copy, so it is a compliance send (purpose piesa_copy, also reaches unsubscribed owners).
  const purpose=clear?'piesa_copy':`install_deposit_${step}`;
  await (await import('./comms.server')).assertCustomerDeliveryAllowed(jobId,'Install deposit notice',...(clear?['piesa_copy' as const]:[]));
  const key=step==='request'?installDepositRequestKey(c.v.invoiceId):`install-deposit-${step}:v1:${c.v.invoiceId}`;
  if(!c.owner.email||(step!=='paid'&&!c.f.link))return 'owner email or link missing';
  let cf=c.f,attachments:EmailAttachment[]|undefined,piesa:{piesaRecordId:string;signedCopyId:string}|undefined;
  if(clear){
    const sent=await admin.from('customer_email_sends').select('status').eq('job_id',jobId).eq('idempotency_key',key).maybeSingle();
    if(sent.error)throw Error('Could not read clear-to-install history.');
    if(sent.data?.status==='sent'){
      // Sent but the owner delivery row never landed (crash after the provider accepted): record it now, idempotently.
      const rec=await admin.from('piesa_records').select('id').eq('job_id',jobId).eq('is_current',true).maybeSingle();
      if(rec.error)throw Error('Could not read PIESA record.');
      if(rec.data){
        const have=await admin.from('piesa_deliveries').select('id',{count:'exact',head:true}).eq('piesa_record_id',rec.data.id).eq('recipient','owner');
        if(have.error)throw Error('Could not read PIESA deliveries.');
        if(!have.count){
          const i=await deps.inputs(jobId);
          if(!('held' in i))await deps.record({jobId,recipient:'owner',piesaRecordId:i.piesaRecordId,signedCopyId:i.signedCopyId,recipientUserId:null,to:c.owner.email,detail:'with the "You\'re clear to install" email'});
        }
      }
      return 'already sent'; // no PDFs rebuilt on every tick once the delivery is recorded
    }
    const i=await deps.inputs(jobId);
    if('held' in i)return i.held||CLEAR_HELD;
    if(!i.attachments.length)return CLEAR_HELD;
    attachments=i.attachments;piesa={piesaRecordId:i.piesaRecordId,signedCopyId:i.signedCopyId};
    cf={...c.f,link:c.f.link.replace('screen=pay','screen=clear'),firstName:c.f.name,checkedOn:i.checkedOn,electrician:i.electrician,upgrades:(await piesaOutcomeFor(jobId))==='upgrades_needed'?'Done':'None'};
  }
  const v2=!!deps.v2&&!clear;
  let paidMail:{attachments:EmailAttachment[];receiptAttached:boolean}|undefined;
  if(v2&&step==='paid'&&deps.paid){
    // Office phone missing = held with a note (never a worker's mobile); the office email is independent and still goes.
    const p=await deps.paid({jobId,invoiceId:c.v.invoiceId,jobNumber:c.job.job_number??'',depositCents:c.v.plan.installDepositCents,balanceCents:c.v.plan.balanceCents});
    if('held' in p)return p.held;
    cf={...cf,officePhone:p.officePhone,balanceCents:p.balanceCents,depositCents:p.depositCents};
    paidMail={attachments:p.attachments,receiptAttached:p.receiptAttached};
  }
  if(v2&&(step==='day3'||step==='day7'))cf={...cf,upgradesToCome:(await deps.route(jobId)).includes('upgrades_needed')};
  const e=await (await import('./owner-email-send.server')).sendGuardedOwnerEmail({jobId,jobSource:c.job.source,to:c.owner.email,purpose,key,retryAfterDefiniteFailure:true,beforeSend:async()=>{
    await (await import('./comms.server')).assertCustomerDeliveryAllowed(jobId,'Install deposit notice',...(clear?['piesa_copy' as const]:[]));
    const fresh=await factsFor(jobId,new Date());
    if(!fresh || fresh.v.invoiceId!==c.v.invoiceId || (step==='paid'?!fresh.paid:fresh.paid) || fresh.c.booked)throw Error('Deposit state changed; notice held.');
  },build:()=>clear&&attachments?{...renderInstallDepositOwnerEmail(cf,'request',true),attachments}:paidMail?{...renderInstallDepositOwnerEmail(cf,step,false,true,{receiptAttached:paidMail.receiptAttached}),...(paidMail.attachments.length?{attachments:paidMail.attachments}:{})}:renderInstallDepositOwnerEmail(cf,step,false,v2)});
  if(clear&&piesa&&e==='sent')await deps.record({jobId,recipient:'owner',...piesa,recipientUserId:null,to:c.owner.email,detail:'with the "You\'re clear to install" email'});
  if(step==='paid')return e; // Jo 2 Nov: Deposit received is email only.
  // TEST jobs stay behind the canonical sender's TEST boundary (no real SMS).
  const s=await (await import('./sms.server')).sendRealSms({type:step==='request'?'install_deposit_request':'install_deposit_reminder',jobId,to:c.owner.phone,body:depositOwnerText(c.f,step),idempotencyKey:`${key}:sms`,event:{at,current:!c.paid}});
  return `${e}; sms ${s.status}`;
}
/** Clearance intent is recorded before invoice/payment reads; invoice-keyed request time remains unchanged. */
export async function requestInstallDeposit(jobId:string,now=new Date(),deps:ClearToInstallDeps=defaultClearToInstallDeps()):Promise<string>{
  const partner=await readInHouseDispatchState([jobId]);
  if(!partner.failed&&!partner.held.has(jobId))return 'not applicable';
  const {stableUuid}=await import('./mitti-create-claim.core');
  const id=await stableUuid(`install-deposit-pending:v1:${jobId}`);
  const pending=await admin.from('workflow_events').insert({id,job_id:jobId,actor_id:null,event_type:'install_deposit_request_pending',summary:'Installation deposit request awaiting invoice and clearance checks',internal:true,details:{attempts:0}});
  if(pending.error&&pending.error.code!=='23505')throw Error(pending.error.message);
  try{
    const c=await factsFor(jobId,now);
    if(!c)throw Error('Installation invoice or deposit facts not available yet.');
    if(!depositRequestEligible({piesaOutcome:await piesaOutcomeFor(jobId),paid:c.paid,booked:c.c.booked,deadline:c.c.deadline,now}))return 'not due';
    const prior=await requestRecord(jobId,c.v.invoiceId);
    if(!prior)await recordRequest(jobId,c.v.invoiceId,now,c.f.deadline);
    const record=prior??await requestRecord(jobId,c.v.invoiceId);
    if(!record)throw Error('Deposit request was not recorded.');
    const result=await ownerNotice(jobId,c,'request',record.created_at,now,deps);
    if(result.startsWith('sent')){
      const done=await admin.from('workflow_events').update({event_type:'install_deposit_request_resolved'}).eq('id',id);if(done.error)throw Error(done.error.message);
      await admin.from('workflow_events').update({event_type:'install_deposit_request_recovered'}).eq('job_id',jobId).eq('event_type','install_deposit_request_failed');
    }
    return result;
  }catch(e){
    const old=await admin.from('workflow_events').select('details').eq('id',id).maybeSingle();if(old.error)throw Error(old.error.message);
    const attempts=Number((old.data?.details as {attempts?:number}|null)?.attempts??0)+1;
    const details={attempts,reason:e instanceof Error?e.message:'Deposit facts unavailable'};
    const update=await admin.from('workflow_events').update({details}).eq('id',id);if(update.error)throw Error(update.error.message);
    if(attempts>=3){const alert=await admin.from('workflow_events').insert({id:await stableUuid(`install-deposit-failed:v1:${jobId}`),job_id:jobId,actor_id:null,event_type:'install_deposit_request_failed',summary:'Installation deposit request needs office attention',details,internal:true});if(alert.error&&alert.error.code!=='23505')throw Error(alert.error.message);}
    return `pending: ${details.reason}`;
  }
}
/** Shared by card and Xero receipt handling; each channel owns a durable once-only claim. */
export async function notifyInstallerDepositPaid(jobId:string,now=new Date(),deps:ClearToInstallDeps=defaultClearToInstallDeps()):Promise<string>{
  const c=await factsFor(jobId,now);if(!c||!c.paid||!c.c.clearance.cleared||c.c.booked)return 'not due';
  const r=await admin.from('workflow_events').select('created_at').eq('job_id',jobId).eq('event_type','install_deposit_received').contains('details',{invoice_id:c.v.invoiceId}).limit(1).maybeSingle();
  if(r.error)throw Error('Could not read deposit receipt.');if(!r.data)return 'receipt not recorded';
  // Independent channels: owner consent holds must not prevent an authorised trade-office notice.
  let owner:string;
  try{owner=await ownerNotice(jobId,c,'paid',r.data.created_at,now,deps);}catch(e){owner=`owner held: ${e instanceof Error?e.message:'delivery unavailable'}`;}
  // Office email only. Trade pause remains independent of the allowed in-house exception.
  if(await (await import('./trade-pause.server')).tradeMessagesPausedNow({businessId:c.assignment.business_id}))return `${owner}; installer held`;
  if(!c.biz.email)return `${owner}; installer email missing`;
  if(await (await import('./qa-inbox.server')).qaDeliveryHeld(jobId))return `${owner}; TEST browser delivery held`;
  const key=`install-deposit-paid-office:v1:${c.v.invoiceId}`;
  const prior=await admin.from('customer_email_sends').select('id,status,error').eq('job_id',jobId).eq('idempotency_key',key).maybeSingle();
  if(prior.error)throw Error('Could not read installer deposit email history.');
  if(prior.data&&prior.data.status!=='failed')return `${owner}; installer already attempted`;
  const claim=prior.data
    ?await admin.from('customer_email_sends').update({status:'sending',error:null}).eq('id',prior.data.id).eq('status','failed').select('id').maybeSingle()
    :await admin.from('customer_email_sends').insert({job_id:jobId,purpose:'install_deposit_paid_office',idempotency_key:key}).select('id').maybeSingle();
  if(claim.error?.code==='23505')return `${owner}; installer already attempted`;
  if(claim.error||!claim.data)throw Error('Could not reserve installer deposit email.');
  const v2=!!deps.v2;
  const m=renderInstallerDepositPaidEmail(v2?{...c.f,ownerFullName:c.owner.full_name||c.f.name,bookUrl:`${SET_PASSWORD_BASE}/field/${jobId}`}:{...c.f,name:c.owner.full_name||c.f.name},v2);
  const e=c.job.source==='qa_test'
    ?await (await import('./test-send.server')).sendTestEmail({jobId,jobSource:c.job.source,partnerIsTest:true,label:key,actorId:null},c.biz.email,m.subject,m.html,m.text)
    :await (await import('./office-email.server')).sendOfficeEmail({actorId:null,recipient:'partner',to:c.biz.email,contactName:c.f.installer,subject:m.subject,message:m.text,label:'install_deposit_paid_office',record:{businessId:c.assignment.business_id},html:m.html,text:m.text,idempotencyKey:key});
  await admin.from('customer_email_sends').update({status:e.status==='sent'?'sent':e.status==='blocked'||e.status==='failed'&&/didn't accept|refused this address or message/i.test(e.detail??'')?'failed':'delivered_unrecorded',sent_at:e.status==='sent'?now.toISOString():null,error:e.status==='sent'?null:e.detail}).eq('id',claim.data.id);
  return `${owner}; installer ${e.status}`;
}
export async function sweepDepositRequests(now=new Date(),deps:ClearToInstallDeps=defaultClearToInstallDeps()){
  const ids:string[]=[];
  for(let offset=0;;offset+=200){const pending=await admin.from('workflow_events').select('job_id').eq('event_type','install_deposit_request_pending').order('id').range(offset,offset+199);if(pending.error)throw Error(pending.error.message);for(const row of pending.data??[])if(row.job_id&&!ids.includes(row.job_id))ids.push(row.job_id);if((pending.data?.length??0)<200)break;}
  for(let from=0;;from+=200){
    // C1: the same stages as INSTALL_DEPOSIT_DUE_STAGES — upgrades-pending in-house jobs sit at rectification_* / variation.
    const r=await admin.from('jobs').select('id').in('stage',[...INSTALL_DEPOSIT_DUE_STAGES]).is('deleted_at',null).order('id').range(from,from+199);
    if(r.error||!r.data)throw Error('Could not read deposit candidates.');ids.push(...r.data.map(j=>j.id));if(r.data.length<200)break;
  }
  let checked=0;
  for(const jobId of ids){
    try{
      const pending=await admin.from('workflow_events').select('id').eq('job_id',jobId).eq('event_type','install_deposit_request_pending').limit(1).maybeSingle();if(pending.error)throw Error(pending.error.message);
      if(pending.data)await requestInstallDeposit(jobId,now,deps);
      const c=await factsFor(jobId,now);if(!c)continue;checked++;
      if(c.paid){await notifyInstallerDepositPaid(jobId,now,deps);continue;}
      if(!depositRequestEligible({piesaOutcome:await piesaOutcomeFor(jobId),paid:c.paid,booked:c.c.booked,deadline:c.c.deadline,now}))continue;
      const r=await requestRecord(jobId,c.v.invoiceId);
      // Retry only recorded intents; never release a historical clearance backlog on deployment.
      if(!r)continue;
      const due=depositReminderDue({requestedAt:r.created_at,paid:c.paid,now});
      if(due)await ownerNotice(jobId,c,due,r.created_at,now,deps);
      else await requestInstallDeposit(jobId,now,deps);
    }catch(e){console.error('Deposit request held',jobId,e instanceof Error?e.message:'read failed');}
  }
  return{checked};
}