import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import { logEvent } from './workflow.server';
import { mjEmail, esc } from './mail-mjml.core';
import type { CoesFileRef } from './coes-check.core';
import type { EmailAttachment } from './email-kit.core';

/** Called only after the certificate has been retained. Delivery claims remain with the guarded sender. */
export async function sendCoesOwnerCopy(jobId: string, ref: CoesFileRef): Promise<string> {
 const {data:job,error:je}=await admin.from('jobs').select('source,deleted_at,owners(email)').eq('id',jobId).maybeSingle();
 if(je) throw new Error('Could not read the certificate owner');
 const owner=job?.owners as {email:string|null}|null;
 if(!job || job.deleted_at || !owner?.email) return 'not sent — owner unavailable';
 const key=`coes-owner-copy:v1:${jobId}:${ref.key}`;
 const {data:prior,error:pe}=await admin.from('workflow_events').select('id').eq('job_id',jobId).eq('event_type','coes_owner_copy_delivered').contains('details',{key}).limit(1);
 if(pe) throw new Error('Could not check earlier certificate delivery');
 if(prior?.length) {await recordConsumerDocs(jobId,key);return 'already delivered';}
 const attachments:EmailAttachment[]=[];
 let size=0;
 for(const f of ref.files){
  if(!['application/pdf','image/jpeg','image/png'].includes(f.mimeType)) return 'not sent — unsupported certificate file';
  if(!f.storagePath.startsWith(`${jobId}/`)) return 'not sent — certificate file is not on this job';
  const {data:blob,error}=await admin.storage.from('job-files').download(f.storagePath);
  if(error || !blob) return 'not sent — certificate file unavailable';
  const bytes=new Uint8Array(await blob.arrayBuffer());size+=bytes.length;
  if(size>8*1024*1024) return 'not sent — certificate files too large';
  attachments.push({filename:`Certificate-of-Electrical-Safety-${attachments.length+1}.${f.mimeType==='application/pdf'?'pdf':f.mimeType==='image/png'?'png':'jpg'}`,content:Buffer.from(bytes).toString('base64'),contentType:f.mimeType});
 }
 if(!attachments.length) return 'not sent — no certificate';
 const build=(u:string|null)=>{const subject='Your Certificate of Electrical Safety';const text='Your Certificate of Electrical Safety is attached. Please keep it with your home records. Questions? Just reply to this email.';return {subject,text,html:mjEmail({subject,body:`<mj-section><mj-column><mj-text mj-class="h1">${esc(subject)}</mj-text><mj-text>${esc(text)}</mj-text></mj-column></mj-section>`,unsubscribe:u}),attachments};};
 await (await import('./comms.server')).assertCustomerDeliveryAllowed(jobId,'Certificate of Electrical Safety copy');
 const result=await (await import('./owner-email-send.server')).sendGuardedOwnerEmail({jobId,jobSource:job.source,to:owner.email,purpose:'coes_owner_copy',key,build,retryAfterDefiniteFailure:true});
 if(result==='sent'){
  await logEvent(jobId,null,'coes_owner_copy_delivered','Certificate of Electrical Safety emailed to the owner',{key,certificate_key:ref.key,paths:ref.files.map(f=>f.storagePath)});
  await recordConsumerDocs(jobId,key);
 }
 return result;
}
async function recordConsumerDocs(jobId:string,key:string) {
 const [{data:given,error:ge},{data:agreement,error:ae},{data:current,error:ce},{data:prior,error:re}]=await Promise.all([
  admin.from('workflow_events').select('id').eq('job_id',jobId).eq('event_type','veu_factsheet_provided').limit(1),
  admin.from('customer_agreements').select('id').eq('job_id',jobId).eq('status','signed').limit(1),
  admin.from('piesa_records').select('id').eq('job_id',jobId).eq('is_current',true).order('created_at',{ascending:false}).limit(1).maybeSingle(),
  admin.from('job_compliance_records').select('id').eq('job_id',jobId).eq('record_key','pre_install_consumer_docs').eq('reference',key).limit(1),
 ]);
 if(ge||ae||ce||re)throw new Error('Current consumer documents could not be checked');
 if(prior?.length||!given?.length||!agreement?.length||!current)return;
 const {data:delivery,error:de}=await admin.from('piesa_deliveries').select('id').eq('job_id',jobId).eq('piesa_record_id',current.id).eq('recipient','owner').limit(1);
 if(de)throw new Error('Current safety check delivery could not be checked');
 if(!delivery?.length)return;
 // Stable primary key allows parallel repairs to converge without duplicating the permanent record.
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('consumer-docs:'+key));
 const h=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 const id=`${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;
 const {error}=await admin.from('job_compliance_records').insert({id,job_id:jobId,record_key:'pre_install_consumer_docs',occurred_at:new Date().toISOString(),reference:key,notes:'Factsheet, signed consumer agreement, current PIESA copy and CoES copy delivery recorded.',recorded_by:null});
 if(error && error.code!=='23505')throw new Error('Certificate delivered; consolidated document record needs retry');
}
