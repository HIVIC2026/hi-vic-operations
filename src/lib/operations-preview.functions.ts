import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { requireAdmin } from './workflow.server';
export const getOperationsPreview = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { loadOperationsPreview } = await import('./operations-preview.server');
    return loadOperationsPreview(supabaseAdmin);
  });
// Admin-authenticated single-job read: the same loader/classifier filtered by job id
// before related facts load. Same authorization, exclusions and fail-closed behavior
// as the dashboard getter; the global getter is unchanged.
export const getOperationsJob = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { loadOperationsPreview } = await import('./operations-preview.server');
    return loadOperationsPreview(supabaseAdmin, data.jobId);
  });
