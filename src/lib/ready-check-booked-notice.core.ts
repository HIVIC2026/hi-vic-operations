// Jo 29 Oct 2026 (HV-3542): no silent skips for the owner's "You're booked" email/text. Every outcome that did not
// send is recorded once as `ready_check_booked_email_not_sent` with the plain reason, so the office can see it. Pure.
export const BOOKED_NOT_SENT_EVENT = "ready_check_booked_email_not_sent" as const;

/** Reason to record, or null when the outcome was a send attempt / already handled (no office note needed). */
export function bookedNoticeNotSentReason(outcome: string | null | undefined): string | null {
  const o = (outcome ?? "").trim();
  if (!o) return "no result returned";
  if (/^(sent\b|already |delivery uncertain|owner sms (\(test\) )?sent\b|test_sent\b|delivered\b)/i.test(o)) return null;
  return o.replace(/^not sent — /i, "");
}

export function bookedNoticeSummary(channel: "email" | "text", reason: string): string {
  return `Ready Check booked — the owner's "You're booked" ${channel} was not sent: ${reason}`;
}
