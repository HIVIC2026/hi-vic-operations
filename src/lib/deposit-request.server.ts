// Task 6: specific in-house deposit messages only. No broad dispatch-suppression bypass.
// Existing invoice/payment/clearance readers and delivery boundaries remain authoritative.
import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import { readInHouseDispatchState } from './in-house-suppression.server';
import { depositReminderDue, depositRequestEligible, INSTALL_DEPOSIT_REQUEST_EVENT, installDepositRequestKey, type DepositReminder } from './deposit-request.core';
import { depositOwnerText, renderInstallDepositOwnerEmail, renderInstallerDepositPaidEmail, type DepositMessageFacts } from './deposit-request-email.core';
import { isStepPaid } from './payments.core';
import { fullAddress } from './address';

async function factsFor(jobId:string,now:Date) {
  const held=await readInHouseDispatchState([jobId]);
  if(held.failed || !held.held.has(jobId))return null;
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
type Facts=NonNullable<Awaited<ReturnType<typeof factsFor>>>;
async function ownerNotice(jobId:string,c:Facts,step:'request'|'paid'|DepositReminder,at:string,now:Date){
  // Quiet hours are checked before either channel; no deferred text at a different time to its email.
  if((await import('./quote-hold.core')).smsQuietReason(now.toISOString()))return 'quiet hours';
  await (await import('./comms.server')).assertCustomerDeliveryAllowed(jobId,'Install deposit notice');
  const key=step==='request'?installDepositRequestKey(c.v.invoiceId):`install-deposit-${step}:v1:${c.v.invoiceId}`;
  if(!c.owner.email||(step!=='paid'&&!c.f.link))return 'owner email or link missing';
  const e=await (await import('./owner-email-send.server')).sendGuardedOwnerEmail({jobId,jobSource:c.job.source,to:c.owner.email,purpose:`install_deposit_${step}`,key,retryAfterDefiniteFailure:true,beforeSend:()=> (import('./comms.server').then(m=>m.assertCustomerDeliveryAllowed(jobId,'Install deposit notice'))),build:()=>renderInstallDepositOwnerEmail(c.f,step)});
  // TEST jobs stay behind the canonical sender's TEST boundary (no real SMS).
  const s=await (await import('./sms.server')).sendRealSms({type:step==='paid'?'install_deposit_paid':step==='request'?'install_deposit_request':'install_deposit_reminder',jobId,to:c.owner.phone,body:depositOwnerText(c.f,step),idempotencyKey:`${key}:sms`,event:{at,current:step==='paid'?c.paid:!c.paid}});
  return `${e}; sms ${s.status}`;
}
export async function requestInstallDeposit(jobId:string,now=new Date()):Promise<string>{
  const c=await factsFor(jobId,now);if(!c)return 'not applicable';
  if(!depositRequestEligible({cleared:c.c.clearance.cleared,basis:c.c.clearance.basis,paid:c.paid,booked:c.c.booked,deadline:c.c.deadline,now}))return 'not due';
  const prior=await requestRecord(jobId,c.v.invoiceId);
  if(!prior)await recordRequest(jobId,c.v.invoiceId,now,c.f.deadline);
  const record=prior??await requestRecord(jobId,c.v.invoiceId);
  if(!record)throw Error('Deposit request was not recorded.');
  return ownerNotice(jobId,c,'request',record.created_at,now);
}
/** Shared by card and Xero receipt handling; each channel owns a durable once-only claim. */
export async function notifyInstallerDepositPaid(jobId:string,now=new Date()):Promise<string>{
  const c=await factsFor(jobId,now);if(!c||!c.paid||!c.c.clearance.cleared||c.c.booked)return 'not due';
  const r=await admin.from('workflow_events').select('created_at').eq('job_id',jobId).eq('event_type','install_deposit_received').contains('details',{invoice_id:c.v.invoiceId}).limit(1).maybeSingle();
  if(r.error)throw Error('Could not read deposit receipt.');if(!r.data)return 'receipt not recorded';
  const owner=await ownerNotice(jobId,c,'paid',r.data.created_at,now);
  // Office email only. Trade pause remains independent of the allowed in-house exception.
  if(await (await import('./trade-pause.server')).tradeMessagesPausedNow({businessId:c.assignment.business_id}))return `${owner}; installer held`;
  if(!c.biz.email)return `${owner}; installer email missing`;
  if(c.job.source==='qa_test')return `${owner}; TEST installer email held`;
  const key=`install-deposit-paid-office:v1:${c.v.invoiceId}`;
  const prior=await admin.from('customer_email_sends').select('id').eq('job_id',jobId).eq('idempotency_key',key).maybeSingle();
  if(prior.error)throw Error('Could not read installer deposit email history.');
  if(prior.data)return `${owner}; installer already attempted`;
  const claim=await admin.from('customer_email_sends').insert({job_id:jobId,purpose:'install_deposit_paid_office',idempotency_key:key}).select('id').maybeSingle();
  if(claim.error?.code==='23505')return `${owner}; installer already attempted`;
  if(claim.error||!claim.data)throw Error('Could not reserve installer deposit email.');
  const m=renderInstallerDepositPaidEmail({...c.f,name:c.owner.full_name||c.f.name});
  const e=await (await import('./office-email.server')).sendOfficeEmail({actorId:null,recipient:'partner',to:c.biz.email,contactName:c.f.installer,subject:m.subject,message:m.text,label:'install_deposit_paid_office',record:{businessId:c.assignment.business_id},html:m.html,text:m.text,idempotencyKey:key});
  await admin.from('customer_email_sends').update({status:e.status==='sent'?'sent':e.status==='blocked'?'failed':'delivered_unrecorded',sent_at:e.status==='sent'?now.toISOString():null,error:e.status==='sent'?null:e.detail}).eq('id',claim.data.id);
  return `${owner}; installer ${e.status}`;
}
export async function sweepDepositRequests(now=new Date()){
  const ids:string[]=[];
  for(let from=0;;from+=200){
    const r=await admin.from('jobs').select('id').eq('stage','installation_scheduling').is('deleted_at',null).order('id').range(from,from+199);
    if(r.error||!r.data)throw Error('Could not read deposit candidates.');ids.push(...r.data.map(j=>j.id));if(r.data.length<200)break;
  }
  let checked=0;
  for(const jobId of ids){
    try{
      const c=await factsFor(jobId,now);if(!c)continue;checked++;
      if(c.paid){await notifyInstallerDepositPaid(jobId,now);continue;}
      if(!depositRequestEligible({cleared:c.c.clearance.cleared,basis:c.c.clearance.basis,paid:c.paid,booked:c.c.booked,deadline:c.c.deadline,now}))continue;
      const r=await requestRecord(jobId,c.v.invoiceId);
      // Retry only recorded intents; never release a historical clearance backlog on deployment.
      if(!r)continue;
      const due=depositReminderDue({requestedAt:r.created_at,paid:c.paid,now});
      if(due)await ownerNotice(jobId,c,due,r.created_at,now);
      else await requestInstallDeposit(jobId,now);
    }catch(e){console.error('Deposit request held',jobId,e instanceof Error?e.message:'read failed');}
  }
  return{checked};
}