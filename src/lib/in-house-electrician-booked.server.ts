// Explicit worker-only booking email; never installer-office SMS or coordination offers.
import {supabaseAdmin as admin} from '@/integrations/supabase/client.server';
import type {SupabaseClient} from '@supabase/supabase-js';
import {stableUuid} from './mitti-create-claim.core';
import {partnerEmailLayout} from './partner-email.core';
const db=admin as unknown as SupabaseClient;
export async function notifyInHouseElectricianBooked(jobId:string,bookingId:string,now=new Date()){
 const book=await db.from('bookings').select('contractor_id,scheduled_start').eq('id',bookingId).eq('job_id',jobId).eq('kind','assessment').eq('status','confirmed').maybeSingle();if(book.error)throw Error(book.error.message);if(!book.data)return;
 const worker=await db.from('partner_workers').select('email,full_legal_name,business_id').eq('profile_id',book.data.contractor_id).is('removed_at',null).maybeSingle();if(worker.error)throw Error(worker.error.message);if(!worker.data?.email)return;
 const job=await db.from('jobs').select('job_number,source,owners(phone),properties(address_line,suburb,postcode)').eq('id',jobId).is('deleted_at',null).maybeSingle();if(job.error)throw Error(job.error.message);if(!job.data)return;
 const key=`in-house-electrician-booked:v1:${bookingId}:${book.data.contractor_id}`;const id=await stableUuid(key);
 const prior=await db.from('workflow_events').select('details').eq('id',id).maybeSingle();if(prior.error)throw Error(prior.error.message);
 type State={status:string;booking_id:string;attempts:number;firstAttempt?:string;attemptAt?:string};
 let old=prior.data?.details as State|null;
 if(!old){const intent=await db.from('workflow_events').insert({id,job_id:jobId,actor_id:null,event_type:'in_house_electrician_booking_notice',summary:'PIESA booking email for the selected electrician',details:{status:'retry',booking_id:bookingId,attempts:0},internal:true});if(intent.error?.code==='23505')return;if(intent.error)throw Error(intent.error.message);old={status:'retry',booking_id:bookingId,attempts:0};}
 const state=old;
 const office=async(recovered=false)=>{const r=await db.from('workflow_events').insert({id:await stableUuid(`${id}:${recovered?'recovered':'failed'}`),job_id:jobId,actor_id:null,event_type:`in_house_form_sync_${recovered?'recovered':'failed'}`,summary:recovered?'Electrician booking email delivered':'Electrician booking email needs office attention',details:{work_id:id,reason:'Electrician booking email could not be confirmed',needs_office:!recovered},internal:true});if(r.error&&r.error.code!=='23505')throw Error(r.error.message);};
 if(state.status==='sent')return 'sent';
 if(state.status==='sending'&&state.attemptAt&&now.getTime()-Date.parse(state.attemptAt)<5*60000)return 'pending';
 if(state.firstAttempt&&now.getTime()-Date.parse(state.firstAttempt)>=23*3600000&&['unknown','sending'].includes(state.status)){await office();return 'office review';}
 if(!['retry','unknown','sending'].includes(state.status))return 'pending';
 if(await (await import('./trade-pause.server')).tradeMessagesPausedNow({businessId:worker.data.business_id})||await (await import('./qa-inbox.server')).qaDeliveryHeld(jobId)){
  const attempts=state.attempts+1;const r=await db.from('workflow_events').update({details:{...state,attempts}}).eq('id',id).contains('details',{status:state.status});if(r.error)throw Error(r.error.message);if(attempts>=3)await office();return 'blocked';
 }
 const attempts=state.attempts+1;
 // Freeze provider key/payload within its 24h deduplication window. An ambiguous
 // delivery outside that window is office review, never an unsafe second email.
 const claim=await db.from('workflow_events').update({details:{...state,status:'sending',attempts,firstAttempt:state.firstAttempt??now.toISOString(),attemptAt:now.toISOString()}}).eq('id',id).contains('details',state).select('id');if(claim.error)throw Error(claim.error.message);if(!claim.data?.length)return 'pending';
 const j=job.data as unknown as {job_number:string;source:string;owners:{phone:string|null}|null;properties:{address_line:string;suburb:string|null;postcode:string|null}|null};
 const when=new Date(book.data.scheduled_start).toLocaleString('en-AU',{timeZone:'Australia/Melbourne',weekday:'long',day:'numeric',month:'long',hour:'numeric',minute:'2-digit'});
 const address=[j.properties?.address_line,j.properties?.suburb,j.properties?.postcode].filter(Boolean).join(', ');
 const subject=`${j.job_number}: Pre Insulation Electrical Safety Assessment (PIESA) booked`;
 const text=`${j.job_number}: Pre Insulation Electrical Safety Assessment (PIESA) booked for ${when}. Address: ${address}. Owner phone: ${j.owners?.phone??'not recorded'}.`;
 const mail=partnerEmailLayout({subject,blocks:[{kind:'p',text}],test:j.source==='qa_test'});
 const result=j.source==='qa_test'?await (await import('./test-send.server')).sendTestEmail({jobId,jobSource:j.source,partnerIsTest:true,label:key,actorId:null},worker.data.email,subject,mail.html,mail.text):await (await import('./office-email.server')).sendOfficeEmail({actorId:null,recipient:'partner',to:worker.data.email,contactName:worker.data.full_legal_name,subject,message:text,...mail,label:'in_house_electrician_booked',record:{businessId:worker.data.business_id},idempotencyKey:key});
 const status=result.status==='sent'?'sent':result.status==='blocked'||result.status==='failed'&&/didn't accept|refused/i.test(result.detail??'')?'retry':'unknown';
 const saved=await db.from('workflow_events').update({details:{...state,status,attempts,booking_id:bookingId,firstAttempt:state.firstAttempt??now.toISOString(),attemptAt:now.toISOString()}}).eq('id',id);if(saved.error)throw Error(saved.error.message);
 if(attempts>=3&&status!=='sent')await office();if(status==='sent'&&state.attempts>=3)await office(true);return status;
}