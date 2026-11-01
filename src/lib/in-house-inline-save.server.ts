// Pre-saved-work deployment path. Canonical inline gates/providers remain authoritative.
import {supabaseAdmin as admin} from '@/integrations/supabase/client.server';
import type {BookingKind} from './booking.server';
import type {CrewSelection} from './piisa-a3.core';
export async function saveInHouseVisitInline(jobId:string,actorId:string,input:{kind:BookingKind|'crew';start?:string;workerId:string;selection?:CrewSelection}) {
 if(input.kind==='crew'){
  if(!input.selection)throw Error('Choose the Lead Installer.');
  const result=await (await import('./visit-allocation.server')).saveCrewWithLeadInline(jobId,actorId,input.selection);
  const {data:book,error}=await admin.from('bookings').select('id').eq('job_id',jobId).eq('kind','installation').eq('status','confirmed').order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(error)throw Error(error.message);
  return {bookingId:book?.id??null,already:false,...result};
 }
 const start=input.start??'';
 const booking=await import('./booking.server');
 // Refuse before any allocation/crew write, then confirmBooking rechecks before booking.
 await booking.validateBooking(jobId,input.kind,start,actorId,input.workerId);
 const service=await import('./in-house-booking.server');
 const who=await service.prepareBookingWorker(jobId,actorId,input.kind,input.workerId,input.selection?.additional.flatMap(w=>'workerId' in w?[w.workerId]:[])??[],{inline:true});
 const {data:existing,error:existingError}=await admin.from('bookings').select('id').eq('job_id',jobId).eq('kind',input.kind).eq('status','confirmed').eq('scheduled_start',start).order('created_at',{ascending:false}).limit(1).maybeSingle();
 if(existingError)throw Error(existingError.message);
 // Only Ready Check has the original idempotent same-time shortcut. Other visits
 // retain confirmBooking's full inline sequence, including ESC/invoice follow-through.
 if(!existing||input.kind!=='ready_check')await booking.confirmBooking(jobId,input.kind,start,actorId,'in-house partner');
 if(input.kind==='ready_check'){
  const {READY_CHECK_BOOKED}=await import('./installer-ready-check.core');
  const {error}=await admin.from('jobs').update({next_action:READY_CHECK_BOOKED}).eq('id',jobId);if(error)throw Error(error.message);
  await (await import('./mitti-create.server')).onReadyCheckBooked(jobId,actorId).catch(e=>console.error('Ready Check form retry failed',e));
  if(!existing){
   const {data:assignment,error:assignmentError}=await admin.from('job_assignments').select('business_id').eq('job_id',jobId).eq('role','installer').eq('active',true).maybeSingle();
   if(assignmentError)throw Error(assignmentError.message);
   await (await import('./workflow.server')).logEvent(jobId,actorId,'installer_ready_check_time_entered','Partner entered the Ready Check day and time (nothing sent to the owner)',{starts_at:start,business_id:assignment?.business_id??null});
  }
 }
 const {data:saved,error}=await admin.from('bookings').select('id').eq('job_id',jobId).eq('kind',input.kind).eq('status','confirmed').eq('scheduled_start',start).order('created_at',{ascending:false}).limit(1).single();
 if(error||!saved)throw Error(error?.message??'Booking could not be read back.');
 const noticeKind=input.kind==='installation'?'install':input.kind==='assessment'?'piesa':input.kind==='ready_check'?'ready_check':null;
 if(noticeKind)await service.notifyOwnerBooked(jobId,noticeKind,start,who).catch(e=>console.error('Booking confirmation held',e));
 return {bookingId:saved.id,already:!!existing,needsVerification:[]};
}