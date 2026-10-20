import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import { ANSWERED_SEND_STATUSES, UNCERTAIN_SEND_STATUSES, priorInitialResponseBlocker } from './automatic-first-response.core';

/** Exact existence checks, so an older reply cannot disappear beyond a returned-row cap.
 * A sender excludes only its own reserved attempt; all other purposes still count. */
export async function initialResponseHistoryBlocker(jobId: string, ownReservationId?: string | null): Promise<string | null> {
  const sendCount = (statuses: readonly string[]) => {
    const query = admin.from('customer_email_sends').select('id', { count: 'exact', head: true }).eq('job_id', jobId).in('status', [...statuses]);
    return ownReservationId ? query.neq('id', ownReservationId) : query;
  };
  const [answered, uncertain, correspondence] = await Promise.all([
    sendCount(ANSWERED_SEND_STATUSES),
    sendCount(UNCERTAIN_SEND_STATUSES),
    admin.from('job_communications').select('id', { count: 'exact', head: true }).eq('job_id', jobId).eq('direction', 'outbound').eq('channel', 'email').eq('visibility', 'customer'),
  ]);
  if ([answered, uncertain, correspondence].some(result => result.error || result.count == null || !Number.isInteger(result.count) || result.count < 0)) {
    return 'Could not verify first-response safety facts.';
  }
  return priorInitialResponseBlocker({ sendStatuses: [...(answered.count! > 0 ? ['sent'] : []), ...(uncertain.count! > 0 ? ['sending'] : [])], customerOutboundEmails: correspondence.count! });
}
