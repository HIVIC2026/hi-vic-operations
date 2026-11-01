// One authorised business Team read and paged job facts for the entire To book list.
import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readByJobIds } from './sweep-batch.server';
import { crewClearance,electricianVerified,melbourneToday } from './worker-compliance.core';
import { allocationBlocker } from './visit-allocation.core';
import type { BookingWorker } from './in-house-booking.core';
const db=admin as unknown as SupabaseClient;
export async function inHouseBookingList(userId:string,jobIds:string[]){
 const c=await (await import('./trade-view.server')).bossOrThrow(userId);
 if(c.kind!=='installer')throw Error('Only the installer office can book these visits.');
 const ids=[...new Set(jobIds)];
 const assignments=await readByJobIds<{job_id:string}>('booking access',ids,chunk=>db.from('job_assignments').select('job_id').in('job_id',chunk).eq('business_id',c.biz.id).eq('role','installer').eq('active',true));
 const own=ids.filter(id=>assignments.some(a=>a.job_id===id));
 const live=await readByJobIds<{id:string}>('booking jobs',own,chunk=>db.from('jobs').select('id').in('id',chunk).is('deleted_at',null).neq('source','qa_test'));
 const state=await (await import('./in-house-suppression.server')).readInHouseDispatchState(live.map(j=>j.id));if(state.failed)throw Error('Could not check booking partners.');
 const allowed=live.filter(j=>state.held.has(j.id)).map(j=>j.id);
 if(!allowed.length)return {};
 const [candidates,rows,bookings,selections,paid]=await Promise.all([
  (await import('./visit-allocation.server')).allocationCandidates(c.biz.id),
  readByJobIds<Record<string,any>>('booking Team',[c.biz.id],chunk=>db.from('partner_workers').select('*').in('business_id',chunk).is('removed_at',null)),
  readByJobIds<{job_id:string;id:string;kind:string;scheduled_start:string|null;status:string}>('booking dates',allowed,chunk=>db.from('bookings').select('job_id,id,kind,scheduled_start,status').in('job_id',chunk).neq('status','cancelled').order('created_at',{ascending:false})),
  readByJobIds<{job_id:string;details:{selection:import('./piisa-a3.core').CrewSelection}}>('booking crew',allowed,chunk=>db.from('workflow_events').select('job_id,details').in('job_id',chunk).eq('event_type','piisa_crew_selected').order('created_at',{ascending:false})),
  (await import('./install-deposit-list.server')).installDepositPaidForJobs(allowed),
 ]);
 const workers:BookingWorker[]=candidates.map(w=>{const r=rows.find(r=>r['id']===w.workerId);return {id:w.workerId,name:w.name,phone:w.mobile,tradeRole:w.tradeRole,workerRole:w.workerRole??null,cleared:crewClearance(w.clearance??{certStatus:null,level:null,expiresOn:null},melbourneToday()).cleared,reason:w.tradeRole==='installer'?allocationBlocker('install',w,melbourneToday(),{bookingCreatedAt:null}):w.declarationsDue?'Worker declarations must be signed before booking.':null,electricianVerified:r?.['trade_role']==='electrician'&&electricianVerified(r as unknown as import('./worker-compliance.core').ElectricianVerification).ok,escRegistered:r?.['esc_registered']===true,escRegisteredAt:r?.['esc_registered_at']??null};});
 return Object.fromEntries(allowed.map(id=>[id,{allowed:true,bookings:bookings.filter(b=>b.job_id===id),team:{workers,depositPaid:paid.get(id)===true,selection:selections.find(s=>s.job_id===id)?.details.selection??null}}]));
}