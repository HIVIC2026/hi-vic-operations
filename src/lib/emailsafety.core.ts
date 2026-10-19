// Customer email safety rules. Pure: no I/O, no delivery. Applied on top of the comms lock, consent and adapter locks.
import { CUSTOMER_BASE } from "./engagement.core";
import { escape } from "./estimate-email";

/** "ready_check_invitation" (P1-R3-S92) is the Office-initiated Template 8 email. Additive only — no other purpose changes. */
export type EmailPurpose = "step3_estimate" | "followup" | "preliminary_ineligible" | "area_unavailable" | "ready_check_invitation";

/** Stages in which an estimate / reminder is still relevant. Any later, closed or paused stage suppresses it. */
export const ESTIMATE_STAGES = new Set(["new_enquiry", "eligibility_review", "awaiting_electrician", "assessment_booking"]);
/** One-time preliminary outcome email is only relevant before the job moves on. */
export const INELIGIBLE_STAGES = new Set(["new_enquiry", "eligibility_review", "on_hold"]);
export const BACKLOG_MAX_AGE_MS = 14 * 86_400_000;
/** Engagement events that permanently stop marketing/follow-up email for a job. */
export const SUPPRESSING_EVENTS = ["email_bounced", "email_complained", "complaint", "opted_out", "payment_received", "quote_declined", "booking_completed"];

const TEST_EMAIL = /@(?:[^@]*\.)?(?:example\.(?:com|org|net)|test|invalid|localhost)$|@mailinator\.com$|\+qa@|^qa[._-]/i;
export const isTestRecipient = (email: string | null | undefined) => !email || TEST_EMAIL.test(email.trim());

export type SafetyInput = {
  purpose: EmailPurpose;
  optedOut: boolean;
  bounced: boolean;
  stage: string;
  jobSource: string | null;
  jobCreatedAt: string;
  recipient: string | null;
  jobsCreatedAfter: string | null; // admin-set cutoff at enablement; null = nothing eligible
  now?: number;
};

/** First reason wins; null = allowed. Every reason is a permanent suppression except "backlog_cutoff_not_set". */
export function emailSuppression(x: SafetyInput): string | null {
  const now = x.now ?? Date.now();
  if (x.optedOut) return "unsubscribed";
  if (x.bounced) return "bounced";
  if (x.jobSource === "qa_test" || isTestRecipient(x.recipient)) return "test_or_example_recipient";
  const stages = x.purpose === "preliminary_ineligible" || x.purpose === "area_unavailable" ? INELIGIBLE_STAGES : ESTIMATE_STAGES;
  if (!stages.has(x.stage)) return "job_progressed_or_closed";
  if (!x.jobsCreatedAfter) return "backlog_cutoff_not_set";
  if (Date.parse(x.jobCreatedAt) < Date.parse(x.jobsCreatedAfter)) return "backlog_before_cutoff";
  // A Ready Check invitation answers a spot the customer saved, so the 14-day new-enquiry backlog
  // window does not apply. Opt-out, bounce, test-recipient and stage suppression still do.
  if (x.purpose !== "followup" && x.purpose !== "ready_check_invitation" && now - Date.parse(x.jobCreatedAt) > BACKLOG_MAX_AGE_MS) return "backlog_too_old";
  return null;
}

export const unsubscribeUrl = (token: string) => `${CUSTOMER_BASE}/api/public/unsubscribe?t=${encodeURIComponent(token)}`;

/** Opt-in slot for renderers that place the secure unsubscribe link inside their own footer. */
export const UNSUBSCRIBE_LINK_SLOT = "<!--HIV_SECURE_UNSUBSCRIBE_LINK-->";

/** Adds a functional unsubscribe footer + List-Unsubscribe-ready URL to any rendered email. */
export function withUnsubscribe<T extends { html: string; plainText: string }>(mail: T, url: string): T {
  if (!/^https:\/\/[^/]+\/api\/public\/unsubscribe\?t=[A-Za-z0-9_-]{20,}$/.test(url)) throw new Error("Invalid unsubscribe URL");
  const inlineLink = `<a href="${escape(url)}" style="color:#3C51C4;text-decoration:underline;">Unsubscribe</a>`;
  const foot = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:14px 12px 24px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:#5A6785;">Don’t want these emails? <a href="${escape(url)}" style="color:#3C51C4;text-decoration:underline;">Unsubscribe</a></td></tr></table>`;
  const html = mail.html.includes(UNSUBSCRIBE_LINK_SLOT)
    ? mail.html.replace(UNSUBSCRIBE_LINK_SLOT, inlineLink)
    : mail.html.includes("</body>") ? mail.html.replace("</body>", `${foot}</body>`) : mail.html + foot;
  return { ...mail, html, plainText: `${mail.plainText}\n\nUnsubscribe: ${url}` };
}

/** After the provider accepted a message, a failed DB write must never cause a resend. */
export function statusAfterDelivery(recorded: boolean): "sent" | "delivered_unrecorded" {
  return recorded ? "sent" : "delivered_unrecorded";
}
/** Reservation: any existing row other than a clean pre-delivery failure blocks another provider call. */
export function reservationAllowed(existing: { status: string } | null): boolean {
  return !existing || existing.status === "failed";
}
