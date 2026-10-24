// Decision 172 (Jo, 24 Oct 2026): one-off "3 questions" reminder. PURE: selection rules, wording and keys only.
// Enquiries made before 23 Oct 2026 (Melbourne) that have not answered the three insulation questions get, ONCE,
// the approved questions email (O2-questions, rendered by jo-outcome-email.core T5/T6) plus one text with the secure
// questions page link. Nothing here reads or sends; three-questions-reminder.server.ts does the I/O.
import { toAuE164 } from "./sms.core";
import { whole } from "./email-kit.core";

export const THREE_QUESTIONS_SMS_TYPE = "three_questions_reminder" as const;
/** customer_email_sends.purpose for the email half; one row per enquiry, never retried. */
export const THREE_QUESTIONS_EMAIL_PURPOSE = "three_questions_reminder" as const;
export const THREE_QUESTIONS_EMAIL_KEY = "three-questions-reminder:v1:";
export const THREE_QUESTIONS_SMS_KEY = "three-questions-reminder-sms:v1:";
export const threeQuestionsEmailKey = (jobId: string) => THREE_QUESTIONS_EMAIL_KEY + jobId;
export const threeQuestionsSmsKey = (jobId: string) => THREE_QUESTIONS_SMS_KEY + jobId;
/** 23 Oct 2026 00:00 Australia/Melbourne (AEDT, UTC+11): from this moment the website asks the questions itself. */
export const THREE_QUESTIONS_CUTOFF_ISO = "2026-10-22T13:00:00.000Z";
export const THREE_QUESTIONS_CONFIRMATION = "SEND 3 QUESTIONS REMINDER";

export const phoneKey = (raw: string | null | undefined) => toAuE164(raw)?.replace(/^\+61/, "0") ?? null;

/** Approved text (decision 172). The brand prefix is added by brandSmsBody at send time. */
export function threeQuestionsSms(firstName: string, rebate: number, link: string): string {
  return `Hi ${firstName}, 3 quick questions and your ${whole(rebate)} rebate spot is saved: ${link} Reply STOP to opt out.`;
}

export type ReminderRow = {
  id: string; job_number: string | null; created_at: string; source: string | null; stage: string | null;
  eligibility_outcome: string | null; removed: boolean | null; deleted_at: string | null;
  owner_name: string | null; owner_email: string | null; owner_phone: string | null;
  spot_saved: boolean | null; contact_rank: number | null;
  /** Owner's website answer, normalised; null = not recorded. */
  declared: "none" | "present" | "unknown" | null;
  /** The three tap answers are already saved on the property (questions overlay / save_owner_insulation_details). */
  tapAnswered: boolean;
  emailOptedOut: boolean;
  /** Current VEU rebate from the current estimate; null = figures missing. */
  rebate: number | null;
  /** Secure questions page link (/estimate/{token}/video) from a usable step3_estimate link; null = none. */
  link: string | null;
  /** Non-null when the approved email could not be rendered for this enquiry (size basis, figures, template). */
  renderProblem?: string | null;
};
export type ReminderRecipient = {
  jobId: string; jobNumber: string | null; firstName: string; email: string | null; phone: string | null;
  rebate: number; link: string; smsBody: string; emailKey: string; smsKey: string;
};
export type ReminderSkip = { jobId: string; jobNumber: string | null; reason: string };

export const SKIP = {
  after_cutoff: "Enquiry made on or after 23 Oct 2026 — the website asked the questions",
  test: "TEST record",
  closed: "Closed, cancelled, removed or deleted",
  ineligible: "Does not appear eligible",
  no_result: "No eligibility result yet",
  opted_out: "Opted out / unsubscribed",
  answered: "Already answered the 3 questions",
  said_none: "Said no insulation — the questions don't apply",
  saved: "Spot already saved",
  duplicate: "Same owner already counted",
  sent: "Already sent this reminder (no repeat)",
  no_contact: "No email address or Australian mobile",
  no_link: "No working secure link (missing or expired)",
  no_figures: "Estimate figures missing — recalculate first",
} as const;

/**
 * One pass over the enquiries. Every reason is explicit so the office sees why a home is not texted or emailed.
 * `handledJobs` / `handledPhones` come from recorded email sends and SMS claims: a home is never reminded twice.
 */
export function selectThreeQuestionsReminder(
  rows: ReminderRow[], optedOutPhones: string[], handledJobs: string[], handledPhones: string[],
  opts: { allowTest?: boolean; ignoreCutoff?: boolean } = {},
): { recipients: ReminderRecipient[]; skipped: ReminderSkip[] } {
  const optouts = new Set(optedOutPhones.map(phoneKey).filter(Boolean));
  const sentJobs = new Set(handledJobs), sentPhones = new Set(handledPhones.map(phoneKey).filter(Boolean));
  const recipients: ReminderRecipient[] = [], skipped: ReminderSkip[] = [];
  const seenContact = new Set<string>();
  for (const r of [...rows].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id))) {
    const phone = phoneKey(r.owner_phone);
    const email = r.owner_email?.trim().toLowerCase() || null;
    const isTest = r.source === "qa_test" || /test|testy|hahaha/i.test(r.owner_name ?? "") || phone === "0411111111";
    let why: string | null = null;
    if (!opts.ignoreCutoff && !(Date.parse(r.created_at) < Date.parse(THREE_QUESTIONS_CUTOFF_ISO))) why = SKIP.after_cutoff;
    else if (isTest && !opts.allowTest) why = SKIP.test;
    else if (r.deleted_at !== null || r.removed === true || r.stage === "cancelled" || r.stage === "complete") why = SKIP.closed;
    else if (r.eligibility_outcome === "does_not_appear_eligible") why = SKIP.ineligible;
    else if (r.eligibility_outcome !== "likely_eligible" && r.eligibility_outcome !== "needs_onsite_confirmation") why = SKIP.no_result;
    else if (r.emailOptedOut || (phone && optouts.has(phone))) why = SKIP.opted_out;
    else if (r.tapAnswered) why = SKIP.answered;
    else if (r.declared === "none") why = SKIP.said_none;
    else if (r.spot_saved === true) why = SKIP.saved;
    else if ((r.contact_rank ?? 1) > 1 || (email && seenContact.has(`e:${email}`)) || (phone && seenContact.has(`p:${phone}`))) why = SKIP.duplicate;
    else if (sentJobs.has(r.id) || (phone && sentPhones.has(phone))) why = SKIP.sent;
    else if (!email && !phone) why = SKIP.no_contact;
    else if (!r.link) why = SKIP.no_link;
    else if (r.rebate === null || !Number.isFinite(r.rebate) || r.rebate < 0) why = SKIP.no_figures;
    else if (r.renderProblem) why = r.renderProblem;
    if (why) { skipped.push({ jobId: r.id, jobNumber: r.job_number, reason: why }); continue; }
    if (email) seenContact.add(`e:${email}`);
    if (phone) seenContact.add(`p:${phone}`);
    const firstName = r.owner_name?.trim().split(/\s+/)[0] || "there";
    recipients.push({
      jobId: r.id, jobNumber: r.job_number, firstName, email, phone, rebate: r.rebate!, link: r.link!,
      smsBody: threeQuestionsSms(firstName, r.rebate!, r.link!), emailKey: threeQuestionsEmailKey(r.id), smsKey: threeQuestionsSmsKey(r.id),
    });
  }
  return { recipients, skipped };
}

/** One stable primary-key claim per phone (distinct from the Save My Spot reminder's claim space). */
export async function threeQuestionsClaimId(phone: string): Promise<string> {
  const normal = phoneKey(phone);
  if (!normal) throw new Error("Invalid reminder phone");
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(THREE_QUESTIONS_SMS_KEY + normal))).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 15) | 80; bytes[8] = ((bytes[8] ?? 0) & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
