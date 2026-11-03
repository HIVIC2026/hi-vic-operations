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
/** Engagement events that mean the owner's address must not be emailed at all (bounce, complaint, opt-out). */
export const DELIVERY_SUPPRESSIONS = ["email_bounced", "email_complained", "complaint", "opted_out"] as const;
/** The part of DELIVERY_SUPPRESSIONS that blocks even the legal copies (compliance purposes). `opted_out` is an
 *  unsubscribe: it blocks everything except COMPLIANCE_OWNER_EMAIL_PURPOSES (see do-not-contact.core `unsubscribeBlocks`). */
export const HARD_DELIVERY_SUPPRESSIONS = ["email_bounced", "email_complained", "complaint"] as const;
export const OPTED_OUT_EVENT = "opted_out";
/** Engagement events that mean the owner has moved on (paid, declined, booked): they stop marketing/follow-up email only.
 *  `booking_completed` is written when the safety check is booked, so it must never stop the job's own emails. */
export const ENGAGEMENT_STOPS = ["payment_received", "quote_declined", "booking_completed"] as const;
/** Engagement events that permanently stop marketing/follow-up email for a job (both lists). */
export const SUPPRESSING_EVENTS: string[] = [...DELIVERY_SUPPRESSIONS, ...ENGAGEMENT_STOPS];

/** Guarded owner email purposes that are marketing / follow-up nudges before the owner goes ahead. Only these are stopped
 *  by an ENGAGEMENT_STOPS event; every other purpose (booked job, payment, paperwork, compliance, replies) still sends.
 *  - estimate_followup_day_2/7/21: reminders to save a spot after the estimate email (decision 238).
 *  - three_questions_reminder: one-off nudge to answer the three insulation questions (decision 172).
 *  - quote_reminder: nudge to accept the quote before it expires (decisions 88/89). */
export const MARKETING_OWNER_EMAIL_PURPOSES = ["estimate_followup_day_2", "estimate_followup_day_7", "estimate_followup_day_21", "three_questions_reminder", "quote_reminder"] as const;

/** True when an engagement stop (paid / declined / booked) must block this purpose: marketing purposes only. */
export function engagementStopBlocks(purpose: string, hasEngagementStop: boolean): boolean {
  return hasEngagementStop && (MARKETING_OWNER_EMAIL_PURPOSES as readonly string[]).includes(purpose);
}

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
  /** Manually-approved ENQ_01 backlog T7 only: skips ONLY the jobs_created_after / 14-day timing rules. */
  manualBacklogIneligible?: boolean;
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
  if (x.manualBacklogIneligible === true && x.purpose === "preliminary_ineligible") return null;
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

/** Jo's footer "Remove my enquiry" link (P1-S77): bound to the SAME secure opt-out link as Unsubscribe. */
export const REMOVE_ENQUIRY_HTML_SLOT = '<span data-hiv-remove-enquiry="1">Remove my enquiry</span>';
export const REMOVE_ENQUIRY_TEXT_SLOT = "{{HIV_REMOVE_MY_ENQUIRY_LINK}}";

/** Adds a functional unsubscribe footer + List-Unsubscribe-ready URL to any rendered email. */
export function withUnsubscribe<T extends { html: string; plainText: string }>(mail: T, url: string): T {
  if (!/^https:\/\/[^/]+\/api\/public\/unsubscribe\?t=[A-Za-z0-9_-]{20,}$/.test(url)) throw new Error("Invalid unsubscribe URL");
  mail = {
    ...mail,
    html: mail.html.split(REMOVE_ENQUIRY_HTML_SLOT).join(`<a href="${escape(url)}" style="color:#3C51C4;text-decoration:underline;">Remove my enquiry</a>`),
    plainText: mail.plainText.split(REMOVE_ENQUIRY_TEXT_SLOT).join(url),
  };
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
