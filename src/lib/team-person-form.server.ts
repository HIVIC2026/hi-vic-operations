import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import { requireMember } from './pilot.server';
import { addPersonProblems } from './team-screen.core';
import { teamCertificatePath, type TeamPersonInput } from './team-person-form.core';
import { melbourneToday } from './melbourne-time.core';
import { crewMobileInput } from './swms-sign-text.core';

export async function teamPersonAccess(userId:string,businessId:string) {
  await requireMember(userId,businessId,true);
}
export async function readTeamPerson(userId:string,businessId:string,workerId:string) {
  await teamPersonAccess(userId,businessId);
  const {data:w,error}=await admin.from('partner_workers').select('id,business_id,full_legal_name,trade_role,worker_role,mobile,email,licence_number,rec_number,certification').eq('id',workerId).eq('business_id',businessId).is('removed_at',null).maybeSingle();
  if(error||!w)throw Error('Team member not found.');
  const {data:birth,error:birthError}=await admin.from('partner_worker_identity' as never).select('worker_id').eq('worker_id',workerId).maybeSingle();
  if(birthError)throw Error('Their details could not be checked. Try again.');
  const cert=w.certification as {eec_upload?:{number?:string;path?:string}}|null;
  return {workerId:w.id,name:w.full_legal_name,role:w.trade_role==='installer'?(w.worker_role==='crew'?'crew':'lead'):w.trade_role,mobile:w.mobile??'',email:w.email??'',licenceNumber:w.licence_number??'',recNumber:w.rec_number??'',hasDob:!!birth,certificateNumber:cert?.eec_upload?.number??'',hasCertificate:!!cert?.eec_upload?.path};
}
export async function saveTeamPerson(userId:string,p:TeamPersonInput) {
  await teamPersonAccess(userId,p.businessId);
  const current=p.workerId?await readTeamPerson(userId,p.businessId,p.workerId):null;
  const photoNeeded=p.role==='lead'||p.role==='crew';
  const mobile=crewMobileInput(p.mobile);
  if(!mobile.ok||!mobile.mobile)throw Error(mobile.ok?'Add their mobile number.':mobile.error);
  const problems=addPersonProblems({...p,hasDob:current?.hasDob===true,requireCertificate:photoNeeded,certificatePath:p.certificatePath||(current?.hasCertificate?'recorded':null),certificateNumber:p.certificateNumber||current?.certificateNumber||null},melbourneToday());
  if(problems.length)throw Error(problems[0]);
  let certificate=null;
  if(photoNeeded&&p.certificatePath) {
    if(!teamCertificatePath(p.businessId,p.certificatePath))throw Error('Invalid certificate upload.');
    const {data:proof,error:proofError}=await admin.from('admin_config_events').select('id').eq('actor_id',userId).eq('event_type','team_certificate_upload_checked').contains('details',{business_id:p.businessId,path:p.certificatePath}).limit(1).maybeSingle();
    if(proofError||!proof)throw Error('The certificate photo must finish uploading and checking before saving.');
    certificate={path:p.certificatePath,number:p.certificateNumber,uploaded_at:new Date().toISOString()};
  } else if(photoNeeded&&current&&p.certificateNumber!==current.certificateNumber)throw Error('Upload the certificate photo when changing its number.');
  const rpc=admin as unknown as import('@supabase/supabase-js').SupabaseClient;
  const {data,error}=await rpc.rpc('save_team_person_details',{_business:p.businessId,_actor:userId,_worker:p.workerId,_name:p.name,_role:p.role,_mobile:mobile.mobile,_email:p.email,_dob:photoNeeded?p.dateOfBirth:null,_licence:p.role==='electrician'?p.licenceNumber:null,_rec:p.role==='electrician'?p.recNumber:null,_certificate:certificate});
  if(error)throw Error(['PGRST202','42883'].includes(error.code)?'The Team update is not available yet. Your details have been kept.':"The person could not be saved. Your details have been kept; try again.");
  return {workerId:String(data)};
}