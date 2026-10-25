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

/** Decision 389: Jo's Release IS the office's per-job "open Ready Check booking" (the separate job-page button was
 *  removed 24 Oct 2026, decision 53 audit), so releasing a spot records the office opening for this job — same columns,
 *  same `owner_ready_check_booking_offered` event as the old office action (offer_owner_ready_check_booking), once.
 *  Night test run 25 Oct 2026: without it every Release, installer offer and owner time pick was refused ("Your spot
 *  hasn't been released yet"). The global switch (workflow_settings.ready_check_booking_enabled) still applies, and a
 *  closed or deleted job is never opened. */
export async function openOwnerReadyCheckBooking(jobId: string, actorId: string | null): Promise<{ opened: boolean }> {
  if (!actorId) throw new Error('Only the office can open a Ready Check booking.');
  const [settings, job] = await Promise.all([
    admin.from('workflow_settings').select('ready_check_booking_enabled').eq('id', 1).maybeSingle(),
    admin.from('jobs').select('stage, deleted_at, ready_check_booking_offered_at').eq('id', jobId).maybeSingle(),
  ]);
  if (settings.error || settings.data?.ready_check_booking_enabled !== true) throw new Error("Owner Ready Check booking is switched off, so the spot can't be released.");
  const j = job.data;
  if (job.error || !j || j.deleted_at || ['cancelled', 'complete'].includes(j.stage)) throw new Error('This job is not waiting for a Ready Check booking.');
  if (j.ready_check_booking_offered_at) return { opened: false };
  const { data: changed, error } = await admin.from('jobs').update({ ready_check_booking_offered_at: new Date().toISOString(), ready_check_booking_offered_by: actorId }).eq('id', jobId).is('ready_check_booking_offered_at', null).select('id');
  if (error) throw new Error(error.message);
  if (!changed?.length) return { opened: false };
  const { logEvent } = await import('./workflow.server');
  await logEvent(jobId, actorId, 'owner_ready_check_booking_offered', 'Office opened Ready Check booking by releasing the spot (nothing sent)', { via: 'spot_release', decision: 389 }, { internal: true });
  return { opened: true };
}