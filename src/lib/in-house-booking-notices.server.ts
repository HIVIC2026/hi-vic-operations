import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import { tomorrowInstallDigest,type DigestInstall } from './in-house-booking.core';
import { partnerEmailLayout,type PartnerBlock } from './partner-email.core';
import { stableUuid } from './mitti-create-claim.core';
async function claim(jobId:string,key:string){const {error}=await admin.from('workflow_events').insert({id:await stableUuid(key),job_id:jobId,actor_id:null,event_type:'in_house_office_email_claimed',summary:'Installer office email reserved once',details:{key},internal:true});if(error?.code==='23505')return false;if(error)throw Error(error.message);return true;}
export async function notifyOfficeOwnerCancelled(jobId:string,reason:string,actorId:string){
  if(await (await import('./qa-inbox.server')).qaDeliveryHeld(jobId))return;
  const {data:j,error}=await admin.from('jobs').select('job_number,source').eq('id',jobId).maybeSingle();if(error)throw Error(error.message);if(!j)return;
  const key=`in-house-owner-cancelled:${jobId}`;if(!await claim(jobId,key))return;
  const subject=`${j.job_number}: Owner cancelled`;const text=`${j.job_number}: Owner cancelled. Reason: ${reason}`;
  if(j.source==='qa_test'){await (await import('./test-send.server')).sendTestEmail({jobId,jobSource:j.source,partnerIsTest:false,label:key,actorId},'info@homeinsulationvictoria.com.au',subject,partnerEmailLayout({subject,blocks:[{kind:'p',text}],test:true}).html,text);return;}
  await (await import('./office-email.server')).sendOfficeEmail({actorId,recipient:'applicant',to:'info@homeinsulationvictoria.com.au',contactName:'Home Insulation Victoria',subject,message:text,text,label:key,record:{},idempotencyKey:key});
}
export async function sweepInHouseInstallOfficeEmails(now=new Date()){
  const {data:bookings,error}=await admin.from('bookings').select('id,job_id,scheduled_start').eq('kind','installation').eq('status','confirmed').gte('scheduled_start',now.toISOString()).lte('scheduled_start',new Date(now.getTime()+48*3600000).toISOString()).order('id');if(error)throw Error(error.message);
  const groups=new Map<string,{email:string;name:string;rows:DigestInstall[];source:string|null}>();
  const state=await (await import('./in-house-suppression.server')).readInHouseDispatchState((bookings??[]).map(b=>b.job_id));if(state.failed)throw Error('Could not check in-house installs.');
  for(const b of bookings??[]){if(!state.held.has(b.job_id))continue;
    const [{data:j,error:je},{data:a,error:ae},crew]=await Promise.all([admin.from('jobs').select('job_number,source,deleted_at').eq('id',b.job_id).maybeSingle(),admin.from('job_assignments').select('business_id,businesses(email,name)').eq('job_id',b.job_id).eq('role','installer').eq('active',true).maybeSingle(),(await import('./piisa-a3.server')).loadCrew(b.job_id)]);if(je||ae)throw Error('Could not read tomorrow’s installs.');
    if(!j||j.deleted_at||j.source==='qa_test'||!a?.business_id||!a.businesses?.email)continue;
    const id=typeof crew.selection?.lead==='string'?crew.selection.lead:null;const name=crew.staff.find(w=>w.workerId===id)?.name??'Lead Installer not chosen';
    const row={jobId:b.job_id,jobNumber:j.job_number,start:b.scheduled_start,name,url:`${(await import('./set-password-link.core')).SET_PASSWORD_BASE}/field/${b.job_id}`};
    if(!tomorrowInstallDigest([row],now).length)continue;
    const g=groups.get(a.business_id)??{email:a.businesses.email,name:a.businesses.name,rows:[],source:j.source};g.rows.push(row);groups.set(a.business_id,g);
  }
  let sent=0;
  for(const [businessId,g] of groups){if(await (await import('./trade-pause.server')).tradeMessagesPausedNow({businessId}))continue;
    const day=(await import('./melbourne-time.core')).melbourneToday(new Date(g.rows[0]?.start??now));const key=`in-house-install-office:v1:${businessId}:${day}`;const first=g.rows[0];if(!first)continue;
    if(await (await import('./qa-inbox.server')).qaDeliveryHeld(first.jobId))continue;
    if(!await claim(first.jobId,key))continue;
    const blocks:PartnerBlock[]=g.rows.flatMap(r=>[{kind:'p',text:`${r.jobNumber} · ${new Date(r.start).toLocaleTimeString('en-AU',{timeZone:'Australia/Melbourne',hour:'numeric',minute:'2-digit'})} · Lead Installer: ${r.name}`},{kind:'button',label:'Keep or change Lead Installer',url:r.url}]);
    const subject='Tomorrow’s installs — Lead Installer';const mail=partnerEmailLayout({subject,blocks});
    await (await import('./office-email.server')).sendOfficeEmail({actorId:null,recipient:'partner',to:g.email,contactName:g.name,subject,message:mail.text,html:mail.html,text:mail.text,label:key,record:{businessId},idempotencyKey:key});sent++;
  }
  return{checked:groups.size,sent};
}