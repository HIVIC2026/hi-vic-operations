// S20-R01: automatic replies to NEW website enquiries, separated from the historical backlog. PURE: no I/O.
//
// The shared master switch (workflow_settings.customer_comms_enabled) also releases the scheduled backlog worker
// (customer-followups: every 10 min, outstanding estimate + ineligible emails) and every other customer message, so it
// stays OFF. Instead, the single post-Gate-1 email chosen for ONE enquiry at its official eligibility decision
// (lead-email-routing.server.ts) may go out when ALL of these hold:
//   - automatic enquiry emails are switched on: customer_delivery_settings.enabled (service-role only, default false);
//   - they have a start time: customer_delivery_settings.jobs_created_after (the existing backlog cutoff);
//   - the enquiry arrived at/after that start time and is at most 14 days old (BACKLOG_MAX_AGE_MS) – so a historical
//     enquiry is never emailed automatically unless someone deliberately moves the start time back;
//   - the enquiry has not been deleted;
//   - the owner's address is present, well-formed, not a test/example address, and has no bounce/complaint/opt-out event.
// Each sender still applies its own template, consent, opt-out, saved-spot, media and once-per-home rules.
// Kill switch: set customer_delivery_settings.enabled = false (or clear jobs_created_after).
import { BACKLOG_MAX_AGE_MS, isTestRecipient } from "./emailsafety.core";

export const AUTO_REPLY_OFF = "Automatic enquiry emails are switched off.";
export const AUTO_REPLY_NO_START = "Automatic enquiry emails have no start time set, so none are sent.";
export const AUTO_REPLY_HISTORICAL = "This enquiry arrived before automatic enquiry emails started – historical enquiries are never emailed automatically.";
export const AUTO_REPLY_TOO_OLD = "This enquiry is more than 14 days old – too old for an automatic first reply.";
export const AUTO_REPLY_BAD_RECIPIENT = "The owner's email address is missing, invalid or a test address.";
export const AUTO_REPLY_SUPPRESSED = "The owner's address bounced, complained or unsubscribed.";
export const AUTO_REPLY_TEST_JOB = "TEST enquiries are never emailed automatically.";
export const AUTO_REPLY_DELETED = "This enquiry was deleted.";
export const AUTO_REPLY_UNREADABLE = "Automatic email settings or the enquiry could not be read – nothing sent.";

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export type AutoReplyFacts = {
  enabled: boolean | null; startsAt: string | null;
  jobCreatedAt: string | null; jobSource: string | null; jobDeleted: boolean;
  recipient: string | null; suppressed: boolean;
  now?: number;
};

/** null = this enquiry may get its automatic decision email now; otherwise the reason it must not. Fails closed. */
export function newEnquiryAutoReplyBlocker(x: AutoReplyFacts): string | null {
  if (x.enabled !== true) return AUTO_REPLY_OFF;
  const start = x.startsAt ? Date.parse(x.startsAt) : NaN;
  if (!Number.isFinite(start)) return AUTO_REPLY_NO_START;
  if (x.jobDeleted) return AUTO_REPLY_DELETED;
  if (x.jobSource === "qa_test") return AUTO_REPLY_TEST_JOB;
  const created = x.jobCreatedAt ? Date.parse(x.jobCreatedAt) : NaN;
  if (!Number.isFinite(created)) return AUTO_REPLY_UNREADABLE;
  if (created < start) return AUTO_REPLY_HISTORICAL;
  if ((x.now ?? Date.now()) - created > BACKLOG_MAX_AGE_MS) return AUTO_REPLY_TOO_OLD;
  const to = (x.recipient ?? "").trim();
  if (!EMAIL.test(to) || isTestRecipient(to)) return AUTO_REPLY_BAD_RECIPIENT;
  if (x.suppressed) return AUTO_REPLY_SUPPRESSED;
  return null;
}
