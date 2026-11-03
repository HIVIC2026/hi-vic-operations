// Explicit worker-only booking email; never installer-office SMS or coordination offers.
import {supabaseAdmin as admin} from '@/integrations/supabase/client.server';
import type {SupabaseClient} from '@supabase/supabase-js';
import {stableUuid} from './mitti-create-claim.core';
import {partnerEmailLayout} from './partner-email.core';
import {PIESA_BOOKED_EMAIL_APPROVED,ELECTRICIAN_ACCESS_ROWS_APPROVED,renderElectricianPiesaBooked,maskPiesaBookedLink} from './electrician-piesa-booked-email.core';
import type {BusinessContact} from './owner-wording.core';
import type {AccessPerson} from './rental-answers.core';
const db=admin as unknown as SupabaseClient;
// Task 4 (decision #39): with PIESA_BOOKED_EMAIL_APPROVED the email is the approved wording, sent to the electrician business OFFICE email
// (held while none is on file), with the job link; same key, so a booking is only ever one version. Flag off = the earlier email, unchanged.
// Task 9 (Jo 2 Nov 2026, answer 7): the person who lets the trades in (tenant / property manager) from the job's own rental
// answers, read only while ELECTRICIAN_ACCESS_ROWS_APPROVED is on (the email is Task 4's exactly otherwise); a failed read = no row.
export type BookedDeps={approved:boolean;accessRowsApproved:boolean;officeContact:(jobId:string)=>Promise<BusinessContact|null>;mintLink:(jobId:string,workerId:string)=>Promise<string|null>;mittiUrl:(jobId:string)=>Promise<string|null>;accessPerson:(jobId:string)=>Promise<AccessPerson|null>};
const defaultDeps=():BookedDeps=>({approved:PIESA_BOOKED_EMAIL_APPROVED,accessRowsApproved:ELECTRICIAN_ACCESS_ROWS_APPROVED,
 accessPerson:async jobId=>(await import('./rental-answers.server')).accessPersonFor(jobId),
 officeContact:async jobId=>(await import('./electrician-link.server')).electricianBusinessFor(jobId),
 mintLink:async(jobId,workerId)=>(await import('./electrician-link.server')).ensureElectricianLink(jobId,workerId),
 mittiUrl:async jobId=>{const a=await db.from('assessments').select('external_mitti_id').eq('job_id',jobId).maybeSingle();const id=(a.data as {external_mitti_id:string|null}|null)?.external_mitti_id;return id?(await import('./mitti-link.core')).mittiFormUrl(id):null;}});
export async function notifyInHouseElectricianBooked(jobId:string,bookingId:string,now=new Date(),over:Partial<BookedDeps>={}){
 const d={...defaultDeps(),...over};
 const book=await db.from('bookings').select('contractor_id,scheduled_start').eq('id',bookingId).eq('job_id',jobId).eq('kind','assessment').eq('status','confirmed').maybeSingle();if(book.error)throw Error(book.error.message);if(!book.data)return;
 // The electrician: the worker named by the latest allocation event (electricians never log in, so the booking's contractor_id is usually NULL);
 // a legacy booking with a contractor_id still finds them by profile.
 const alloc=await db.from('workflow_events').select('details').eq('job_id',jobId).eq('event_type','in_house_electrician_allocated').order('created_at',{ascending:false}).limit(1).maybeSingle();if(alloc.error)throw Error(alloc.error.message);
 const allocatedRaw=(alloc.data?.details as {worker_id?:unknown}|null)?.worker_id;const allocatedId=typeof allocatedRaw==='string'&&allocatedRaw?allocatedRaw:null;
 const worker=allocatedId?await db.from('partner_workers').select('id,email,full_legal_name,business_id').eq('id',allocatedId).is('removed_at',null).maybeSingle():book.data.contractor_id?await db.from('partner_workers').select('id,email,full_legal_name,business_id').eq('profile_id',book.data.contractor_id).is('removed_at',null).maybeSingle():{data:null,error:null};
 if(worker.error)throw Error(worker.error.message);if(!worker.data||(!d.approved&&!worker.data.email))return;
 const job=await db.from('jobs').select('job_number,source,owners(full_name,phone),properties(address_line,suburb,postcode)').eq('id',jobId).is('deleted_at',null).maybeSingle();if(job.error)throw Error(job.error.message);if(!job.data)return;
 const key=`in-house-electrician-booked:v1:${bookingId}:${book.data.contractor_id??worker.data.id}`;const id=await stableUuid(key);
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
 // Approved wording goes to the electrician business office email only; none on file = held (nothing claimed, so it sends once one is added).
 const officeTo=d.approved?(await d.officeContact(jobId)):null;if(d.approved&&!officeTo?.email?.trim())return 'held';
 if(await (await import('./trade-pause.server')).tradeMessagesPausedNow({businessId:worker.data.business_id})||await (await import('./qa-inbox.server')).qaDeliveryHeld(jobId)){
  const attempts=state.attempts+1;const r=await db.from('workflow_events').update({details:{...state,attempts}}).eq('id',id).contains('details',{status:state.status});if(r.error)throw Error(r.error.message);if(attempts>=3)await office();return 'blocked';
 }
 const attempts=state.attempts+1;
 // Freeze provider key/payload within its 24h deduplication window. An ambiguous
 // delivery outside that window is office review, never an unsafe second email.
 const claim=await db.from('workflow_events').update({details:{...state,status:'sending',attempts,firstAttempt:state.firstAttempt??now.toISOString(),attemptAt:now.toISOString()}}).eq('id',id).contains('details',state).select('id');if(claim.error)throw Error(claim.error.message);if(!claim.data?.length)return 'pending';
 const j=job.data as unknown as {job_number:string;source:string;owners:{full_name:string|null;phone:string|null}|null;properties:{address_line:string;suburb:string|null;postcode:string|null}|null};
 const when=new Date(book.data.scheduled_start).toLocaleString('en-AU',{timeZone:'Australia/Melbourne',weekday:'long',day:'numeric',month:'long',hour:'numeric',minute:'2-digit'});
 const address=[j.properties?.address_line,j.properties?.suburb,j.properties?.postcode].filter(Boolean).join(', ');
 const test=j.source==='qa_test';
 let subject=`${j.job_number}: Pre Insulation Electrical Safety Assessment (PIESA) booked`;
 let text=`${j.job_number}: Pre Insulation Electrical Safety Assessment (PIESA) booked for ${when}. Address: ${address}. Owner phone: ${j.owners?.phone??'not recorded'}.`;
 let mail:{html:string;text:string}=partnerEmailLayout({subject,blocks:[{kind:'p',text}],test}); // Part 10's layout also returns its mjml source (design samples only); the send needs html + text
 let stored=text;let to=worker.data.email as string;let contactName:string|null=worker.data.full_legal_name;
 if(d.approved){
  // A failed link or Mitti lookup never stops the email: it goes without them.
  const jobUrl=await d.mintLink(jobId,worker.data.id).catch(()=>null);const mittiUrl=await d.mittiUrl(jobId).catch(()=>null);
  const ap=d.accessRowsApproved?await d.accessPerson(jobId).catch(e=>{console.error('PIESA booked email: access person not read',(e as Error).message);return null;}):null;
  const access=ap?{name:ap.name,role:ap.who==='property_manager'?'property manager':'tenant',phone:ap.mobile}:null;
  const r=renderElectricianPiesaBooked({jobNumber:j.job_number,firstName:(worker.data.full_legal_name??'').trim().split(/\s+/)[0]||null,startIso:book.data.scheduled_start,address,owner:{name:j.owners?.full_name?.trim()||'the owner',phone:j.owners?.phone??null},mittiUrl,jobUrl,access,test},{accessRowsApproved:d.accessRowsApproved});
  subject=r.subject;text=r.text;mail={html:r.html,text:r.text};stored=maskPiesaBookedLink(r.text);to=officeTo!.email!.trim();contactName=officeTo!.tradingName??officeTo!.name;
 }
 const result=test?await (await import('./test-send.server')).sendTestEmail({jobId,jobSource:j.source,partnerIsTest:true,label:key,actorId:null},to,subject,mail.html,mail.text):await (await import('./office-email.server')).sendOfficeEmail({actorId:null,recipient:'partner',to,contactName,subject,message:stored,...mail,label:'in_house_electrician_booked',record:{businessId:worker.data.business_id},idempotencyKey:key});
 const status=result.status==='sent'?'sent':result.status==='blocked'||result.status==='failed'&&/didn't accept|refused/i.test(result.detail??'')?'retry':'unknown';
 const saved=await db.from('workflow_events').update({details:{...state,status,attempts,booking_id:bookingId,firstAttempt:state.firstAttempt??now.toISOString(),attemptAt:now.toISOString()}}).eq('id',id);if(saved.error)throw Error(saved.error.message);
 if(attempts>=3&&status!=='sent')await office();if(status==='sent'&&state.attempts>=3)await office(true);return status;
}