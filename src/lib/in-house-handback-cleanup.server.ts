// Recovery from the recorded, authorised handback. No owner/trade messages.
import {supabaseAdmin as admin} from '@/integrations/supabase/client.server';
import type {SupabaseClient} from '@supabase/supabase-js';
import {stableUuid} from './mitti-create-claim.core';
const db=admin as unknown as SupabaseClient;
export async function finishInHouseHandback(jobId:string,actorId:string){
 const back=await db.from('workflow_events').select('id,details').eq('job_id',jobId).eq('event_type','in_house_pulled_back').order('created_at',{ascending:false}).limit(1).maybeSingle();if(back.error)throw Error(back.error.message);if(!back.data)return;
 const id=await stableUuid(`handback-cleanup:${back.data.id}`);
 const done=await db.from('workflow_events').select('id').eq('id',id).maybeSingle();if(done.error)throw Error(done.error.message);if(done.data)return;
 try{
  const details=back.data.details as {business_id:string};
  const forms=await import('./in-house-forms.server');const audits=await forms.handbackFormIds(jobId);
  await forms.closeUnneededForms(jobId,'handed_back',actorId);
  const [workers,business,job]=await Promise.all([db.from('partner_workers').select('email').eq('business_id',details.business_id).is('removed_at',null),db.from('businesses').select('email').eq('id',details.business_id).maybeSingle(),db.from('jobs').select('source').eq('id',jobId).maybeSingle()]);
  if(workers.error||business.error||job.error)throw Error('Could not read returned trade access.');
  // TEST forms use the simulator identity only, never look up real practice-person emails.
  const emails=job.data?.source==='qa_test'?[(await import('./onsite-ready-check.core')).TEST_MITTI_ASSIGNEE]:[...new Set([business.data?.email,...(workers.data??[]).map(w=>w.email)].filter((e):e is string=>!!e))];
  const mitti=await import('./mitti.server');
  for(const email of emails){const call=await mitti.mittiCallFor(mitti.realMittiCall,email);const user=await mitti.findMittiUserByEmail(email,call);if(!user)throw Error('Could not identify returned trade in Mitti.');for(const audit of audits)await (await import('./mitti.core')).mittiApi(call).removeInspectionUserAccess(audit,user);}
  const saved=await db.from('workflow_events').insert({id,job_id:jobId,actor_id:actorId,event_type:'in_house_form_sync_recovered',summary:'Returned trade form access removed',details:{handback_id:back.data.id},internal:true});if(saved.error&&saved.error.code!=='23505')throw Error(saved.error.message);
 }catch(e){const reason=e instanceof Error?e.message:'Handback cleanup failed';const r=await db.from('workflow_events').insert({id:await stableUuid(`handback-failed:${back.data.id}`),job_id:jobId,actor_id:actorId,event_type:'in_house_form_sync_failed',summary:'Returned trade form access needs office attention',details:{reason,handback_id:back.data.id},internal:true});if(r.error&&r.error.code!=='23505')throw Error(r.error.message);throw e;}
}
export async function sweepInHouseHandbacks(){
 const rows:{job_id:string;actor_id:string|null}[]=[];
 for(let offset=0;;offset+=200){const r=await db.from('workflow_events').select('job_id,actor_id').eq('event_type','in_house_pulled_back').order('id').range(offset,offset+199);if(r.error)throw Error(r.error.message);for(const row of r.data??[])if(row.job_id)rows.push({job_id:row.job_id,actor_id:row.actor_id});if((r.data?.length??0)<200)break;}
 for(const row of rows)await finishInHouseHandback(row.job_id,row.actor_id??'').catch(e=>console.error('Handback cleanup held',e));return {checked:rows.length};
}