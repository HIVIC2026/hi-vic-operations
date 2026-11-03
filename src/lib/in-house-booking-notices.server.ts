import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { partnerEmailLayout } from './partner-email.core';
import { stableUuid } from './mitti-create-claim.core';
const db=admin as unknown as SupabaseClient;
type Mail={to:string;subject:string;html:string;text:string};
type Claim={key:string;status:string;attempt:number;at:string;mail:Mail};
async function deliverOnce(jobId:string,key:string,mail:Mail,send:(mail:Mail)=>Promise<{status:string;detail?:string}>,now=new Date()){
  const id=await stableUuid(key);
  const {data:prior,error:readError}=await db.from('workflow_events').select('details').eq('id',id).maybeSingle();
  if(readError)throw Error(readError.message);
  const old=prior?.details as Claim|null;
  if(old&&(!['retry','blocked'].includes(old.status)||now.getTime()-Date.parse(old.at)>=23*3600000))return false;
  const details:Claim=old?{...old,status:'sending',attempt:old.attempt+1}:{key,status:'sending',attempt:1,at:now.toISOString(),mail};
  if(old){
    const {data,error}=await db.from('workflow_events').update({details}).eq('id',id).eq('details',JSON.stringify(old)).select('id');
    if(error)throw Error(error.message);if(!data?.length)return false;
  }else{
    const {error}=await db.from('workflow_events').insert({id,job_id:jobId,actor_id:null,event_type:'in_house_office_email_claimed',summary:'Office email reserved once',details,internal:true});
    if(error?.code==='23505')return false;if(error)throw Error(error.message);
  }
  // Freeze the payload on first attempt, including the whole paged list. Unknown outcomes never retry.
  const result=await send(details.mail);
  const status=result.status==='sent'?'sent':result.status==='blocked'?'blocked':result.status==='failed'&&/didn't accept|refused this address or message/i.test(result.detail??'')?'retry':'unknown';
  const {error}=await db.from('workflow_events').update({details:{...details,status}}).eq('id',id);
  if(error)throw Error(error.message);
  return status==='sent';
}
export async function notifyOfficeOwnerCancelled(jobId:string,reason:string,actorId:string){
  if(await (await import('./qa-inbox.server')).qaDeliveryHeld(jobId))return;
  const {data:j,error}=await admin.from('jobs').select('job_number,source').eq('id',jobId).maybeSingle();if(error)throw Error(error.message);if(!j)return;
  const {data:cancel,error:ce}=await db.from('workflow_events').select('id').eq('job_id',jobId).eq('event_type','job_cancel_released').order('created_at',{ascending:false}).limit(1).maybeSingle();if(ce)throw Error(ce.message);
  const key=`in-house-owner-cancelled:${jobId}:${cancel?.id??'initial'}`;
  const subject=`${j.job_number}: Owner cancelled`;const text=`${j.job_number}: Owner cancelled. Reason: ${reason}`;
  const mail={to:'info@homeinsulationvictoria.com.au',subject,...partnerEmailLayout({subject,blocks:[{kind:'p',text}],test:j.source==='qa_test'})};
  await deliverOnce(jobId,key,mail,async frozen=>(await import('./in-house-office-alert.server')).sendInHouseOfficeAlert({...frozen,jobId,jobSource:j.source,actorId,idempotencyKey:key}));
}
export async function notifyOfficeLeadChanged(jobId:string,changeId:string,line:string,actorId:string){
 const r=await admin.from('jobs').select('source').eq('id',jobId).maybeSingle();if(r.error||!r.data)throw Error('Could not read office alert safeguards.');
 const source=r.data.source;
 const key=`esc-lead-alert:${changeId}`;
 const mail={to:'info@homeinsulationvictoria.com.au',subject:line,...partnerEmailLayout({subject:line,blocks:[{kind:'p',text:line}],test:r.data.source==='qa_test'})};
 return deliverOnce(jobId,key,mail,frozen=>(import('./in-house-office-alert.server').then(m=>m.sendInHouseOfficeAlert({...frozen,jobId,jobSource:source,actorId,idempotencyKey:key}))));
}
// Part 7 Task 8 (Jo 2 Nov 2026): the 2pm "Tomorrow's installs — Lead Installer" office email was retired — replaced by the 9am
// two-days-before "Confirm or change your Lead Installer by 5pm today" email (lead-installer-confirm.server). Old
// `in-house-install-office:v1:{business}:{day}` claims stay as history and that sweep reads them so a day never gets both.
