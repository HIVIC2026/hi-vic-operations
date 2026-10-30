import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
/** Jo 21 Oct: a generic capacity update is not an answer to the enquiry. */
export const GENERIC_UPDATE_EVENTS = ['enquiry_capacity_update_20261013'] as const;
import { ANSWERED_SEND_STATUSES, NOT_A_FIRST_RESPONSE_PURPOSES, UNCERTAIN_SEND_STATUSES, priorInitialResponseBlocker } from './automatic-first-response.core';

/** Exact existence checks, so an older reply cannot disappear beyond a returned-row cap.
 * A sender excludes only its own reserved attempt; all other purposes still count, except the full-address request
 * emails (NOT_A_FIRST_RESPONSE_PURPOSES): they are counted separately and taken off, so a job held for its address still
 * gets its Save my spot once the owner answers. */
export async function initialResponseHistoryBlocker(jobId: string, ownReservationId?: string | null): Promise<string | null> {
  const sendCount = (statuses: readonly string[], onlyPurposes?: readonly string[]) => {
    let query = admin.from('customer_email_sends').select('id', { count: 'exact', head: true }).eq('job_id', jobId).in('status', [...statuses]);
    if (onlyPurposes) query = query.in('purpose', [...onlyPurposes]);
    return ownReservationId ? query.neq('id', ownReservationId) : query;
  };
  const [answeredAll, uncertainAll, answeredAsk, uncertainAsk, correspondence] = await Promise.all([
    sendCount(ANSWERED_SEND_STATUSES),
    sendCount(UNCERTAIN_SEND_STATUSES),
    sendCount(ANSWERED_SEND_STATUSES, NOT_A_FIRST_RESPONSE_PURPOSES),
    sendCount(UNCERTAIN_SEND_STATUSES, NOT_A_FIRST_RESPONSE_PURPOSES),
    admin.from('job_communications').select('id', { count: 'exact', head: true }).eq('job_id', jobId).eq('direction', 'outbound').eq('channel', 'email').eq('visibility', 'customer').or(`source_event.is.null,source_event.not.in.(${GENERIC_UPDATE_EVENTS.join(',')})`),
  ]);
  if ([answeredAll, uncertainAll, answeredAsk, uncertainAsk, correspondence].some(result => result.error || result.count == null || !Number.isInteger(result.count) || result.count < 0)) {
    return 'Could not verify first-response safety facts.';
  }
  const answered = answeredAll.count! - answeredAsk.count!;
  const uncertain = uncertainAll.count! - uncertainAsk.count!;
  if (answered < 0 || uncertain < 0) return 'Could not verify first-response safety facts.';
  return priorInitialResponseBlocker({ sendStatuses: [...(answered > 0 ? ['sent'] : []), ...(uncertain > 0 ? ['sending'] : [])], customerOutboundEmails: correspondence.count! });
}
