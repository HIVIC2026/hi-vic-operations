import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { requireAdmin } from './workflow.server';
export const getOperationsPreview = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
    const { loadOperationsPreview } = await import('./operations-preview.server');
    return loadOperationsPreview(supabaseAdmin);
  });
