// Jo 29 Oct 2026 (HV-3542): no silent skips for the owner's "You're booked" email/text. Every outcome that did not
// send (or queue) is recorded once as `ready_check_booked_email_not_sent` with the plain reason. Pure.
export const BOOKED_NOT_SENT_EVENT = "ready_check_booked_email_not_sent" as const;

/** Reason to record, or null when the outcome was a send / already handled (no office note needed). */
export function bookedNoticeNotSentReason(outcome: string): string | null {
  const o = outcome.trim();
  if (!o) return "no result returned";
  if (/^(sent|delivered|queued|test_sent|already handled|already attempted)/i.test(o)) return null;
  if (/^sent\b/i.test(o) || /text prepared/i.test(o)) return null;
  return o;
}

export function bookedNoticeSummary(channel: "email" | "text", reason: string): string {
  return `Ready Check booked — the owner's "You're booked" ${channel} was not sent: ${reason}`;
}
