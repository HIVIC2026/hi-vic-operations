import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

export const getOfficeReadyCheckBooking = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import('./workflow.server');
    await requireAdmin(context.supabase);
    const { readyCheckBookingAccess } = await import('./ready-check-booking-access.server');
    return readyCheckBookingAccess(data.jobId);
  });
export const offerOwnerReadyCheckBooking = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ jobId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import('./workflow.server');
    await requireAdmin(context.supabase);
    const { error } = await context.supabase.rpc('offer_owner_ready_check_booking', { _job: data.jobId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
export const setOwnerReadyCheckBookingEnabled = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
  .inputValidator(d => z.object({ enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { requireAdmin } = await import('./workflow.server');
    await requireAdmin(context.supabase);
    const { error } = await context.supabase.rpc('set_ready_check_booking_enabled', { _enabled: data.enabled });
    if (error) throw new Error(error.message);
    return { ok: true };
  });