import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
import {requireSupabaseAuth} from '@/integrations/supabase/auth-middleware';

export const getOwnMittiStatus = createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
 .inputValidator(d=>z.object({jobId:z.string().uuid()}).parse(d))
 .handler(async({data,context})=>(await import('./own-customer-mitti-choice.server')).ownMittiStatus(data.jobId,context.userId));

export const requestOwnMittiForm = createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
 .inputValidator(d=>z.object({jobId:z.string().uuid()}).parse(d))
 .handler(async({data,context})=>(await import('./own-customer-mitti-choice.server')).requestOwnMitti(data.jobId,context.userId));