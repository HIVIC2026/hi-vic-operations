import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { teamPersonSchema } from './team-person-form.core';
const identity=z.object({businessId:z.string().uuid(),workerId:z.string().uuid()});
export const readTeamPersonFn=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(d=>identity.parse(d)).handler(async({data,context})=>(await import('./team-person-form.server')).readTeamPerson(context.userId,data.businessId,data.workerId));
export const saveTeamPersonFn=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(d=>teamPersonSchema.parse(d)).handler(async({data,context})=>(await import('./team-person-form.server')).saveTeamPerson(context.userId,data));
