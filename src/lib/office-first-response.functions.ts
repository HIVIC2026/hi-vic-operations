import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';
export const sendOfficeEnquiryFirstResponse = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { requireAdmin } = await import('./workflow.server');
    await requireAdmin(context.supabase);
    return (await import('./office-first-response.server')).sendOfficeFirstResponse(data.jobId, context.userId);
  });