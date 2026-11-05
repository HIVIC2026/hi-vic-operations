import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { teamPersonSchema, teamCertificatePath } from './team-person-form.core';
const identity=z.object({businessId:z.string().uuid(),workerId:z.string().uuid()});
export const readTeamPersonFn=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(d=>identity.parse(d)).handler(async({data,context})=>(await import('./team-person-form.server')).readTeamPerson(context.userId,data.businessId,data.workerId));
export const saveTeamPersonFn=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(d=>teamPersonSchema.parse(d)).handler(async({data,context})=>(await import('./team-person-form.server')).saveTeamPerson(context.userId,data));
export const teamCertificateSlot=createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
 .inputValidator(d=>z.object({businessId:z.string().uuid(),mime:z.enum(['image/jpeg','image/png']),size:z.number().int().min(1).max(10*1024*1024)}).parse(d))
 .handler(async({data,context})=>{
  await (await import('./team-person-form.server')).teamPersonAccess(context.userId,data.businessId);
  const {supabaseAdmin:admin}=await import('@/integrations/supabase/client.server');
  const path=`team-certificates/${data.businessId}/${crypto.randomUUID()}.${data.mime==='image/png'?'png':'jpg'}`;
  const {data:signed,error}=await admin.storage.from('partner-files').createSignedUploadUrl(path);
  if(error||!signed)throw Error('The upload could not be prepared. Try again.');
  return {path,token:signed.token};
 });
export const checkTeamCertificate=createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
 .inputValidator(d=>z.object({businessId:z.string().uuid(),path:z.string()}).parse(d))
 .handler(async({data,context})=>{
  await (await import('./team-person-form.server')).teamPersonAccess(context.userId,data.businessId);
  if(!teamCertificatePath(data.businessId,data.path))throw Error('Invalid certificate upload.');
  await (await import('./upload-safety.server')).verifyStoredUpload('partner-files',data.path,data.path.endsWith('.png')?'image/png':'image/jpeg');
  const {supabaseAdmin:admin}=await import('@/integrations/supabase/client.server');
  const {error}=await admin.from('admin_config_events').insert({actor_id:context.userId,event_type:'team_certificate_upload_checked',summary:'Team certificate photo checked',details:{business_id:data.businessId,path:data.path}});
  if(error)throw Error('The upload check could not be saved. Try again.');
  return {path:data.path};
 });