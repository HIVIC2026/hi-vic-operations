// Decision 361 (Jo 25 Oct 2026): a Ready Check job offer made after 8pm is texted at 7am. The `job_offer` SMS type now
// keeps quiet hours (sms.core), and a held text never claims its idempotency key, so the 15-minute tick re-tries every
// pending, unexpired offer whose `job-offer:v1:{id}` key is still unclaimed. The 24-hour offer clock still starts when
// the offer is made; the email and the app alert still go immediately. PURE: no I/O.
import { SMS_QUIET_REASON, smsQuietReason } from "./quote-hold.core";

export const jobOfferSmsKey = (offerId: string) => `job-offer:v1:${offerId}`;

export type JobOfferCatchUpFacts = {
  kind: string; status: string; expiresAt: string | null;
  /** A real attempt already claimed `job-offer:v1:{id}` (sent, or possibly sent): never again. */
  claimed: boolean;
  /** Reasons recorded on earlier held attempts for this offer's key (sms_messages status "blocked"). */
  heldReasons: string[];
};

/**
 * Should the tick text this offer now? Only outside quiet hours, only for a pending Ready Check offer that has not
 * expired and whose key is unclaimed, and only when every earlier hold was the quiet-hours hold (other holds — switch
 * off, comms off, no consent — are not retried every 15 minutes; they stay as recorded).
 */
export function jobOfferCatchUpDue(f: JobOfferCatchUpFacts, nowIso: string): boolean {
  if (smsQuietReason(nowIso)) return false;
  if (f.kind !== "ready_check" || f.status !== "pending" || f.claimed) return false;
  if (f.expiresAt && Date.parse(f.expiresAt) <= Date.parse(nowIso)) return false;
  return f.heldReasons.every((r) => r === SMS_QUIET_REASON);
}
