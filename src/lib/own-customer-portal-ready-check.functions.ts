import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
import {requireSupabaseAuth} from '@/integrations/supabase/auth-middleware';
import {portalReadyCheckSchema, portalRcFile} from './own-customer-portal-ready-check.core';

export const saveOwnCustomerReadyCheck = createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
 .inputValidator(d=>z.object({jobId:z.string().uuid(),values:portalReadyCheckSchema}).parse(d))
 .handler(async({data,context})=> (await import('./own-customer-portal-ready-check.server')).savePortalReadyCheck(data.jobId,context.userId,data.values));

export const getOwnCustomerReadyCheck = createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
 .inputValidator(d=>z.object({jobId:z.string().uuid()}).parse(d))
 .handler(async({data,context})=>(await import('./own-customer-portal-ready-check.server')).readPortalReadyCheck(data.jobId,context.userId));

export const portalReadyCheckUpload = createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
 .inputValidator(d=>z.object({jobId:z.string().uuid(),file:z.preprocess(v=>({...v as object,path:'upload'}),portalRcFile)}).parse(d))
 .handler(async({data,context})=>{
  await (await import('./own-customer-portal-ready-check.server')).requirePortalReadyCheck(data.jobId,context.userId);
  const {supabaseAdmin:db}=await import('@/integrations/supabase/client.server');
  const path=`${data.jobId}/portal-ready-check/${crypto.randomUUID()}_${data.file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
  const {data:signed,error}=await db.storage.from('job-files').createSignedUploadUrl(path);
  if(error || !signed) throw Error('The upload could not start. Try again.');
  return {path,token:signed.token};
 });