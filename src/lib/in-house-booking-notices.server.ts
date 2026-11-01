import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { tomorrowInstallDigest,type DigestInstall } from './in-house-booking.core';
import { partnerEmailLayout,type PartnerBlock } from './partner-email.core';
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
export async function sweepInHouseInstallOfficeEmails(now=new Date()){
  const bookings:{id:string;job_id:string;scheduled_start:string}[]=[];
  for(let offset=0;;offset+=200){
    const {data,error}=await admin.from('bookings').select('id,job_id,scheduled_start').eq('kind','installation').eq('status','confirmed').gte('scheduled_start',now.toISOString()).lte('scheduled_start',new Date(now.getTime()+48*3600000).toISOString()).order('id').range(offset,offset+199);
    if(error)throw Error(error.message);bookings.push(...data??[]);if((data?.length??0)<200)break;
  }
  const groups=new Map<string,{email:string;name:string;rows:DigestInstall[];source:string|null}>();
  const state=await (await import('./in-house-suppression.server')).readInHouseDispatchState((bookings??[]).map(b=>b.job_id));if(state.failed)throw Error('Could not check in-house installs.');
  for(const b of bookings??[]){if(!state.held.has(b.job_id))continue;
    const [{data:j,error:je},{data:a,error:ae},crew]=await Promise.all([admin.from('jobs').select('job_number,source,deleted_at').eq('id',b.job_id).maybeSingle(),admin.from('job_assignments').select('business_id,businesses(email,name,onboarding_notes)').eq('job_id',b.job_id).eq('role','installer').eq('active',true).maybeSingle(),(await import('./piisa-a3.server')).loadCrew(b.job_id)]);if(je||ae)throw Error('Could not read tomorrow’s installs.');
    if(!j||j.deleted_at||j.source==='qa_test'||!a?.business_id||!a.businesses?.email||(await import('./test-send.core')).isTestPartner(a.businesses))continue;
    const id=typeof crew.selection?.lead==='string'?crew.selection.lead:null;const name=crew.staff.find(w=>w.workerId===id)?.name??'Lead Installer not chosen';
    const row={jobId:b.job_id,jobNumber:j.job_number,start:b.scheduled_start,name,url:`${(await import('./set-password-link.core')).SET_PASSWORD_BASE}/field/${b.job_id}`};
    if(!tomorrowInstallDigest([row],now).length)continue;
    const g=groups.get(a.business_id)??{email:a.businesses.email,name:a.businesses.name,rows:[],source:j.source};g.rows.push(row);groups.set(a.business_id,g);
  }
  let sent=0;
  for(const [businessId,g] of groups){if(await (await import('./trade-pause.server')).tradeMessagesPausedNow({businessId}))continue;
    const day=(await import('./melbourne-time.core')).melbourneToday(new Date(g.rows[0]?.start??now));const key=`in-house-install-office:v1:${businessId}:${day}`;const first=g.rows[0];if(!first)continue;
    let deliveryHeld=false;for(const r of g.rows)if(await (await import('./qa-inbox.server')).qaDeliveryHeld(r.jobId)){deliveryHeld=true;break;}if(deliveryHeld)continue;
    const blocks:PartnerBlock[]=g.rows.flatMap(r=>[{kind:'p',text:`${r.jobNumber} · ${new Date(r.start).toLocaleTimeString('en-AU',{timeZone:'Australia/Melbourne',hour:'numeric',minute:'2-digit'})} · Lead Installer: ${r.name}`},{kind:'button',label:'Keep or change Lead Installer',url:r.url}]);
    const subject='Tomorrow’s installs — Lead Installer';const mail=partnerEmailLayout({subject,blocks});
    const existing=await db.from('workflow_events').select('details').eq('id',await stableUuid(key)).maybeSingle();if(existing.error)throw Error(existing.error.message);
    const original=existing.data?.details as Claim|null;
    if(original?.status==='sent'){
      for(const row of g.rows){
        if(original.mail.text.includes(row.url))continue;
        const lateKey=`${key}:late:${row.jobId}:${row.start}`;
        const lateSubject='Tomorrow’s installs — late booking';
        const lateMail=partnerEmailLayout({subject:lateSubject,blocks:[{kind:'p',text:`${row.jobNumber} · ${new Date(row.start).toLocaleTimeString('en-AU',{timeZone:'Australia/Melbourne',hour:'numeric',minute:'2-digit'})} · Lead Installer: ${row.name}`},{kind:'button',label:'Keep or change Lead Installer',url:row.url}]});
        if(await deliverOnce(row.jobId,lateKey,{to:g.email,subject:lateSubject,...lateMail},async frozen=>(await import('./office-email.server')).sendOfficeEmail({actorId:null,recipient:'partner',...frozen,contactName:g.name,message:frozen.text,label:lateKey,record:{businessId},idempotencyKey:lateKey}),now))sent++;
      }
    }else if(await deliverOnce(first.jobId,key,{to:g.email,subject,...mail},async frozen=>(await import('./office-email.server')).sendOfficeEmail({actorId:null,recipient:'partner',...frozen,contactName:g.name,message:frozen.text,label:key,record:{businessId},idempotencyKey:key}),now))sent++;
  }
  return{checked:groups.size,sent};
}