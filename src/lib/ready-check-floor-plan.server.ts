// Private idempotent file copies only; never prices, approves or sends.
import {supabaseAdmin as admin} from '@/integrations/supabase/client.server';
import {floorPlanFiles} from './ready-check-floor-plan.core';
import type {MittiMediaFetch} from './mitti.server';
export async function saveFloorPlanFiles(jobId:string,actorId:string|null,auditId:string,audit:unknown,fetchMedia:MittiMediaFetch):Promise<string[]> {
 const failures:string[]=[];
 for(const file of floorPlanFiles(audit)) {
  const mediaId=file.mediaId; if(!mediaId)continue;
  try {
   const key=`${auditId}:${mediaId}`;
   const {data:existing,error}=await admin.from('documents').select('id,storage_path').eq('job_id',jobId).eq('source_system','mitti').eq('external_id',key).maybeSingle();
   if(error)throw error;
   if(existing?.storage_path){const check=await admin.storage.from('job-files').download(existing.storage_path);if(!check.error&&check.data.size>0)continue;}
   const {bytes,contentType}=await fetchMedia(auditId,mediaId);
   if(!bytes.length)throw new Error('Empty floor plan');
   const ext=contentType.includes('pdf')?'pdf':contentType.includes('png')?'png':contentType.includes('jpeg')?'jpg':'bin';
   const path=existing?.storage_path||`${jobId}/mitti/floor-plans/${auditId}-${mediaId}.${ext}`;
   const upload=await admin.storage.from('job-files').upload(path,bytes,{contentType,upsert:false});
   if(upload.error&&!/exists|duplicate/i.test(upload.error.message))throw upload.error;
   const check=await admin.storage.from('job-files').download(path);if(check.error||!check.data.size)throw new Error('Floor plan copy could not be verified');
   if(!existing){const saved=await admin.from('documents').insert({job_id:jobId,kind:'floor_plan',title:'Ready Check floor plan',storage_path:path,mime_type:contentType,uploaded_by:actorId,source_system:'mitti',external_id:key,original_name:`floor-plan-${mediaId}.${ext}`,size_bytes:bytes.length});if(saved.error)throw saved.error;}
  }catch{failures.push('Floor plan file could not be saved – sync again to retry.');}
 }
 return failures;
}