// Only in-house office actions use this transaction; legacy confirmBooking stays unchanged.
import {supabaseAdmin as admin} from '@/integrations/supabase/client.server';
import type {SupabaseClient} from '@supabase/supabase-js';
import {bookingTeam} from './in-house-booking.server';
import {bookingWorkerBlocker} from './in-house-booking.core';
import {crewSelectionProblems,type CrewSelection} from './piisa-a3.core';
import {stableUuid} from './mitti-create-claim.core';
import type {BookingKind} from './booking.server';
import {isMissingDbObject,type DbErrorLike} from './schema-compat.core';
const db=admin as unknown as SupabaseClient;
async function read<T>(q:PromiseLike<{data:unknown;error:{message:string}|null}>):Promise<T>{const r=await q;if(r.error)throw Error(r.error.message);return r.data as T;}
export async function saveInHouseVisit(jobId:string,actorId:string,input:{kind:BookingKind|'crew';start?:string;workerId:string;selection?:CrewSelection}){
 // Capture BEFORE validation. The locked writer refuses a changed version/booking/crew.
 // Probe the read-only prerequisite BEFORE any writes. Only absent deployment objects
 // permit the original inline path; permission/network/commit failures never do.
 const revisionResult=await db.rpc('in_house_visit_revision',{_job:jobId});
 if(revisionResult.error){
  if(isMissingSavedWorkFunction(revisionResult.error,'in_house_visit_revision'))return (await import('./in-house-inline-save.server')).saveInHouseVisitInline(jobId,actorId,input);
  throw Error(revisionResult.error.message);
 }
 const revision=revisionResult.data as string;
 const [job,book,crew]=await Promise.all([
  read<{stage:string;updated_at:string}|null>(db.from('jobs').select('stage,updated_at').eq('id',jobId).is('deleted_at',null).maybeSingle()),
  read<{id:string;scheduled_start:string}|null>(db.from('bookings').select('id,scheduled_start').eq('job_id',jobId).eq('kind',input.kind==='crew'?'installation':input.kind).eq('status','confirmed').order('created_at',{ascending:false}).limit(1).maybeSingle()),
  read<{id:string;details:{selection?:CrewSelection}}|null>(db.from('workflow_events').select('id,details').eq('job_id',jobId).eq('event_type','piisa_crew_selected').order('created_at',{ascending:false}).order('id',{ascending:false}).limit(1).maybeSingle()),
 ]);
 if(!job)throw Error('Job unavailable');
 if(input.kind!=='crew')await (await import('./booking.server')).validateBooking(jobId,input.kind,input.start??'',actorId,input.workerId);
 const team=await bookingTeam(jobId,actorId);const who=team.workers.find(w=>w.id===input.workerId);const why=bookingWorkerBlocker(input.kind==='crew'?'installation':input.kind,who??null);if(why||!who)throw Error(why??'Not your Team member');
 let crewFacts:{needsVerification:string[];staff:unknown[]}={needsVerification:[],staff:[]};
 if(input.selection){const saved=await (await import('./piisa-a3.server')).loadCrew(jobId);const checked=crewSelectionProblems(input.selection,saved.staff);if(checked.problems.length)throw Error(checked.problems.join(' • '));crewFacts={needsVerification:checked.needsVerification,staff:saved.staff};}
 const id=await stableUuid(`in-house-save:${jobId}:${input.kind}:${book?.id??'none'}:${crew?.id??'none'}:${input.start??''}:${input.workerId}:${JSON.stringify(input.selection??null)}`);
 const committed=await db.rpc('commit_in_house_visit',{
  _job:jobId,_actor:actorId,_kind:input.kind,_start:input.start??null,_worker:input.workerId,
  _stage:job.stage,_version:job.updated_at,_booking:book?.id??null,_crew:crew?.id??null,
  _selection:input.selection??null,_crew_facts:{...crewFacts,revision},_work:id,
 });
 if(committed.error){
  // PGRST202 means dispatch never entered the function: no partial save exists.
  // Never interpret a missing table/function *inside* a deployed writer as fallback.
  if(isMissingSavedWorkFunction(committed.error,'commit_in_house_visit'))return (await import('./in-house-inline-save.server')).saveInHouseVisitInline(jobId,actorId,input);
  throw Error(committed.error.message);
 }
 const result=committed.data as {bookingId:string|null;workId?:string;already:boolean};
 const workId=result.workId;
 if(workId)void import('./in-house-saved-work.server').then(m=>m.startInHouseSavedWork(workId)).catch(()=>undefined);
 return {...result,needsVerification:crewFacts.needsVerification};
}
function isMissingSavedWorkFunction(error:DbErrorLike,name:string){
 return error?.code==='PGRST202'&&isMissingDbObject(error)&&!!error.message?.includes(name);
}