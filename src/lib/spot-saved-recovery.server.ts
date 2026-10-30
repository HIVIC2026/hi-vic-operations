import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import { logEvent } from './workflow.server';
import { sendSpotSavedConfirmation } from './spot-saved-send.server';

const PAGE = 200;
/** A completion means both applicable channels own a delivery claim, not merely that an attempt ran. */
export function spotSavedConfirmationHandled(result: { email: { status: string }; sms: { status: string } }, emailOnly = false) {
  const handled = (status: string) => ['sent', 'already', 'uncertain', 'sent_unknown'].includes(status);
  return handled(result.email.status) && (emailOnly || handled(result.sms.status));
}

/** Recover durable saved responses, including the gap before the queue event was written.
 * Never changes the save/stage, never retries a claimed/uncertain delivery, and never bypasses sender policy.
 */
export async function sweepSpotSavedConfirmations() {
  const candidates: { jobId: string; queued: boolean; emailOnly: boolean; lastAttempt: string }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from('lead_campaign_responses')
      .select('job_id, spot_saved_at, jobs!inner(source, stage, deleted_at, qa_archived_at)')
      .not('spot_saved_at', 'is', null).is('opted_out_at', null)
      .or('source.is.null,source.neq.qa_test', { referencedTable: 'jobs' })
      .is('jobs.deleted_at', null).is('jobs.qa_archived_at', null).neq('jobs.stage', 'cancelled')
      .order('id').range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const live = (data ?? []).filter(r => r.jobs.source !== 'qa_test' && !r.jobs.deleted_at && !r.jobs.qa_archived_at && r.jobs.stage !== 'cancelled');
    const ids = live.map(r => r.job_id);
    const events: { job_id: string | null; event_type: string; details: unknown; created_at: string }[] = [];
    if (ids.length) {
      for (let offset = 0; ; offset += PAGE) {
        const { data: page, error: eventError } = await admin.from('workflow_events')
          .select('job_id, event_type, details, created_at').in('job_id', ids)
          .in('event_type', ['campaign_spot_saved', 'spot_saved_confirmation_queued', 'spot_saved_confirmation_completed', 'spot_saved_confirmation_recovery_attempted'])
          .order('id').range(offset, offset + PAGE - 1);
        if (eventError) throw new Error(eventError.message);
        events.push(...(page ?? []));
        if (!page || page.length < PAGE) break;
      }
    }
    for (const row of live) {
      const history = events.filter(e => e.job_id === row.job_id);
      if (history.some(e => e.event_type === 'spot_saved_confirmation_completed')) continue;
      candidates.push({ jobId: row.job_id, queued: history.some(e => e.event_type === 'spot_saved_confirmation_queued'),
        lastAttempt: history.filter(e => e.event_type === 'spot_saved_confirmation_recovery_attempted').map(e => e.created_at).sort().at(-1) ?? '',
        emailOnly: history.some(e => !!(e.details as { preliminary_email?: boolean } | null)?.preliminary_email) });
    }
    if (!data || data.length < PAGE) break;
  }
  // Finish all selection reads before any dispatch, so a failed later page cannot release partial results.
  const counts = { checked: candidates.length, attempted: 0, completed: 0, pending: 0, failed: 0 };
  // Old policy-held homes must not occupy every slot on every tick.
  candidates.sort((a, b) => a.lastAttempt.localeCompare(b.lastAttempt));
  for (const candidate of candidates) {
    if (counts.attempted >= 20) break;
    counts.attempted++;
    try {
      await logEvent(candidate.jobId, null, 'spot_saved_confirmation_recovery_attempted', 'Checking saved confirmation through normal delivery guards', {}, { internal: true });
      if (!candidate.queued) await logEvent(candidate.jobId, null, 'spot_saved_confirmation_queued', 'Spot saved confirmation recovered for sending', { preliminary_email: candidate.emailOnly, recovery: true }, { internal: true });
      const result = await sendSpotSavedConfirmation(candidate.jobId, { emailOnly: candidate.emailOnly });
      if (spotSavedConfirmationHandled(result, candidate.emailOnly)) {
        await logEvent(candidate.jobId, null, 'spot_saved_confirmation_completed', 'Spot saved confirmation handled through the guarded sender', { email: result.email, sms: result.sms, recovery: true }, { internal: true });
        counts.completed++;
      } else counts.pending++;
    } catch (error) {
      counts.failed++;
      console.error('Spot saved confirmation recovery failed', error instanceof Error ? error.message : 'Unknown error');
    }
  }
  return counts;
}