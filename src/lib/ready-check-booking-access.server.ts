import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import { ownerBookingAllowed, READY_CHECK_BOOKING_CLOSED } from './ready-check-booking-access.core';

export async function readyCheckBookingAccess(jobId: string) {
  const [settings, job] = await Promise.all([
    admin.from('workflow_settings').select('ready_check_booking_enabled').eq('id', 1).maybeSingle(),
    admin.from('jobs').select('stage, deleted_at, ready_check_booking_offered_at, ready_check_booking_offered_by').eq('id', jobId).maybeSingle(),
  ]);
  const enabled = !settings.error && settings.data?.ready_check_booking_enabled === true;
  const j = job.error ? null : job.data;
  return { enabled, offeredAt: j?.ready_check_booking_offered_at ?? null,
    allowed: ownerBookingAllowed(enabled, j?.ready_check_booking_offered_at, j?.ready_check_booking_offered_by, j?.stage ?? null, j?.deleted_at) };
}
export async function assertOwnerReadyCheckBooking(jobId: string) {
  if (!(await readyCheckBookingAccess(jobId)).allowed) throw new Error(READY_CHECK_BOOKING_CLOSED);
}