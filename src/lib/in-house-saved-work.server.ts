// Durable post-save work: transaction writes the intent; Worker lifecycle is an
// optimisation only. Scheduled retries recover expired claims, never re-book.
import {supabaseAdmin as admin} from '@/integrations/supabase/client.server';
import type {SupabaseClient} from '@supabase/supabase-js';
import {stableUuid} from './mitti-create-claim.core';
const db=admin as unknown as SupabaseClient;
export type SavedWork={type:'booking'|'crew';bookingId:string|null;kind?:string;workerId:string;oldWorkerId?:string|null;start?:string;oldStart?:string|null;who?:{id:string;name:string;phone:string|null};status?:string;attempts?:number;lease?:string;completed?:string[]};
async function checked<T>(q:PromiseLike<{data:unknown;error:{message:string}|null}>):Promise<T>{const r=await q;if(r.error)throw Error(r.error.message);return r.data as T;}
export async function recordInHouseSavedWork(jobId:string,actorId:string,details:SavedWork,version:string){
 const id=await stableUuid(`in-house-saved:${jobId}:${version}`);
 const r=await db.from('workflow_events').insert({id,job_id:jobId,actor_id:actorId,event_type:'in_house_saved_work',summary:'Saved visit follow-through pending',details:{...details,status:'pending',attempts:0},internal:true});
 if(r.error&&r.error.code!=='23505')throw Error(r.error.message);return id;
}
async function officeEvent(jobId:string,actor:string|null,id:string,type:'failed'|'recovered',reason:string){
 const r=await db.from('workflow_events').insert({id:await stableUuid(`${id}:${type}`),job_id:jobId,actor_id:actor,event_type:`in_house_form_sync_${type}`,summary:type==='failed'?'In-house forms need office attention':'In-house form follow-through recovered',details:{work_id:id,reason,needs_office:type==='failed'},internal:true});
 if(r.error&&r.error.code!=='23505')throw Error(r.error.message);
}
export async function runInHouseSavedWork(id:string,now=new Date()){
 const lease=crypto.randomUUID();const claim=await db.rpc('claim_in_house_saved_work',{_id:id,_lease:lease,_now:now.toISOString()});if(claim.error)throw Error(claim.error.message);if(!claim.data)return;
 const row=await checked<{job_id:string;actor_id:string|null;details:SavedWork}|null>(db.from('workflow_events').select('job_id,actor_id,details').eq('id',id).maybeSingle());if(!row)return;
 const d=row.details;const done=new Set(d.completed??[]);const attempts=(d.attempts??0)+1;
 const save=async(status:string)=>{await checked(db.from('workflow_events').update({details:{...d,completed:[...done],attempts,status,lease}}).eq('id',id).contains('details',{lease}));};
 const step=async(name:string,task:()=>Promise<unknown>)=>{if(done.has(name))return;await task();done.add(name);await save('running');};
 try{
  const book=d.bookingId?await checked<{id:string;scheduled_start:string;kind:string}|null>(db.from('bookings').select('id,scheduled_start,kind').eq('id',d.bookingId).eq('job_id',row.job_id).eq('status','confirmed').maybeSingle()):null;
  if(d.bookingId&&!book){await save('done');return;}
  const forms=await import('./in-house-forms.server');
  if(d.type==='crew'){
   await step('forms',async()=>{if(book)await forms.ensureInstallForm(row.job_id,row.actor_id);await forms.syncInHouseForms(row.job_id,'crew',row.actor_id,undefined,d.oldWorkerId);});
   await step('swms',()=>import('./swms.server').then(m=>m.loadSwms(row.job_id)));
   if(book)await step('worker-notices',()=>import('./swms-sign-text.server').then(m=>m.textSwmsSignLinks(row.job_id,book,now)));
  }else{
   await step('forms',async()=>{
    if(d.kind==='installation')await forms.ensureInstallForm(row.job_id,row.actor_id);
    if(d.kind==='ready_check')await forms.ensureInHouseForms(row.job_id,row.actor_id);
    await forms.syncInHouseForms(row.job_id,'person',row.actor_id);
    if(d.kind==='installation')await forms.syncInHouseForms(row.job_id,'crew',row.actor_id,undefined,d.oldWorkerId);
    await forms.syncInHouseForms(row.job_id,'date',row.actor_id);
   });
   if(d.kind==='installation'){
    await step('invoice-date',()=>import('./invoice-dates.server').then(m=>m.setInstallDueDate(row.job_id,d.start??book?.scheduled_start??'',row.actor_id??'')));
    await step('esc',()=>import('./esc.server').then(m=>m.regenerateEscNotification(row.job_id,row.actor_id??'')));
    await step('swms',()=>import('./swms.server').then(m=>m.loadSwms(row.job_id)));
    if(book)await step('worker-notices',()=>import('./swms-sign-text.server').then(m=>m.textSwmsSignLinks(row.job_id,book,now)));
   }
   if(d.kind==='assessment'&&d.bookingId){await step('electrician-intent',()=>import('./in-house-electrician-booked.server').then(m=>m.notifyInHouseElectricianBooked(row.job_id,d.bookingId??'')));}
   const kind=d.kind==='installation'?'install':d.kind==='assessment'?'piesa':d.kind==='ready_check'?'ready_check':null;
   if(kind&&book&&d.who){await step('owner-intent',()=>import('./in-house-booking.server').then(m=>m.notifyOwnerBooked(row.job_id,kind,book.scheduled_start,d.who??{id:d.workerId,name:'',phone:null},now)));}
   await step('progress',()=>import('./autoadvance.server').then(m=>m.autoAdvanceJob(row.job_id,row.actor_id,'booking confirmed')));
  }
  if((d.attempts??0)>=3)await officeEvent(row.job_id,row.actor_id,id,'recovered','Saved visit follow-through completed');
  await save('done');
 }catch(e){await save('retry');if(attempts>=3)await officeEvent(row.job_id,row.actor_id,id,'failed',e instanceof Error?e.message:'Saved visit follow-through failed');}
}
export function startInHouseSavedWork(id:string){return import('./background.server').then(m=>m.runAfterResponse(()=>runInHouseSavedWork(id)));}
export async function sweepInHouseSavedWork(now=new Date()){
 const rows:{id:string}[]=[];for(let from=0;;from+=200){const page=await checked<typeof rows>(db.from('workflow_events').select('id').eq('event_type','in_house_saved_work').order('id').range(from,from+199));rows.push(...page);if(page.length<200)break;}
 for(const r of rows)await runInHouseSavedWork(r.id,now);return{checked:rows.length};
}