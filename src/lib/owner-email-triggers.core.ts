// Decision 325 (25 Oct 2026): the approved owner emails that had a renderer and a sender but no workflow trigger.
// PURE: the idempotency keys (shared with approved-owner-emails.server.ts), the event recorded once per send, the
// time-based due rules (O19 quote reminders, O51 review request) and the small presentation helpers the triggers need.
// No I/O; owner-email-triggers.server.ts reads the facts, records the event and calls the guarded sender.
//
//   O19 Quote reminder       15-minute tick: 3 days after the quote is sent, and 2 days before the price expires (decisions 88/89/134)
//   O22 You're in + receipt  when the safety check payment on the accepted quote's invoice is received (decision 90)
//   O26 Safety check times   when the electrician offers PIESA times (decisions 94/333); booked version when the PIESA is booked
//   O29 Fixes quote          when the office sends the reviewed electrical fixes quote (decision 95)
//   O33 Pick your install day when the installer offers install days (decision 96)
//   O42 Install day changed  when a booked install day moves (decision 135)
//   O45 Final invoice        install recorded complete with a balance due, once per invoice (decision 334, bank transfer only)
//   O51 Review request       15-minute tick: a week after the install (decision 105); the My job stars screen exists (decision 335),
//                            still held until the Google review link (HIV_GOOGLE_REVIEW_URL) is set
import { quoteExpiresAt } from "./quote-expiry.core";

/** One internal workflow event per owner email, recorded BEFORE the send (decision 165: a switch flip never re-fires an old step). */
export const OWNER_EMAIL_TRIGGER_EVENT = "owner_email_triggered";

export type OwnerEmailCode = "O19" | "O22" | "O26" | "O26_booked" | "O29" | "O33" | "O42" | "O45" | "O51";
export const OWNER_EMAIL_LABEL: Record<OwnerEmailCode, string> = {
  O19: "Quote reminder email", O22: "You're in email", O26: "Safety check times email", O26_booked: "Safety check booked email",
  O29: "Electrical fixes quote email", O33: "Install days email", O42: "Install day changed email", O45: "Final invoice email", O51: "Review request email",
};

export type QuoteReminderKind = "day3" | "expiry";

/** Idempotency keys: the same strings the guarded sender reserves in customer_email_sends. */
export const ownerEmailKey = {
  quoteReminder: (quoteId: string, kind: QuoteReminderKind) => `quote-reminder:v1:${quoteId}:${kind}`,
  youreIn: (quoteId: string) => `youre-in:v1:${quoteId}`,
  safetyCheckTimes: (jobId: string, startsAt: string[]) => `safety-check-times:v1:${jobId}:${[...startsAt].sort().join(",")}`,
  safetyCheckBooked: (jobId: string, startIso: string) => `safety-check-booked:v1:${jobId}:${startIso}`,
  fixesQuote: (quoteId: string) => `fixes-quote:v1:${quoteId}`,
  installDays: (jobId: string, startsAt: string[]) => `install-days:v1:${jobId}:${[...startsAt].sort().join(",")}`,
  installDayChanged: (jobId: string, startIso: string) => `install-day-changed:v1:${jobId}:${startIso}`,
  reviewRequest: (jobId: string) => `review-request:v1:${jobId}`,
  /** Decision 334: once per invoice. */
  finalInvoice: (invoiceId: string) => `final-invoice:v1:${invoiceId}`,
} as const;

const DAY = 86_400_000;

/** Stages where a sent installation quote is still waiting for the owner. Anything else = the job moved on. */
export const QUOTE_OPEN_STAGES = ["measured_estimate_ready", "awaiting_quote_acceptance"] as const;
export const QUOTE_REMINDER_DAY3_DAYS = 3;
export const QUOTE_REMINDER_EXPIRY_LEAD_DAYS = 2;

export type QuoteReminderFacts = {
  quote: { kind: string; status: string; release_state: string | null; sent_at: string | null };
  job: { stage: string; deleted_at: string | null; qa_archived_at?: string | null };
  /** Reminder kinds already recorded for this quote. */
  done: QuoteReminderKind[];
  optedOut: boolean;
};

/**
 * Decisions 88/89/134: one reminder 3 days after the quote is sent and one 2 days before the price expires, only while
 * the quote is still open (issued, released, not accepted/declined/expired), the job still at the quote stage, not
 * deleted/archived and the owner not opted out. When the day-3 reminder was missed and the expiry one is due, only the
 * expiry one goes. Nothing after the price has expired.
 */
export function quoteReminderDue(f: QuoteReminderFacts, now: Date): QuoteReminderKind | null {
  const q = f.quote;
  if (q.kind !== "installation" || q.status !== "issued" || !q.sent_at) return null;
  if (q.release_state != null && q.release_state !== "released") return null;
  if (f.job.deleted_at || f.job.qa_archived_at || f.optedOut) return null;
  if (!(QUOTE_OPEN_STAGES as readonly string[]).includes(f.job.stage)) return null;
  const t = now.getTime();
  const expires = quoteExpiresAt(q.sent_at).getTime();
  if (t >= expires) return null;
  if (t >= expires - QUOTE_REMINDER_EXPIRY_LEAD_DAYS * DAY) return f.done.includes("expiry") ? null : "expiry";
  if (t >= Date.parse(q.sent_at) + QUOTE_REMINDER_DAY3_DAYS * DAY) return f.done.includes("day3") || f.done.includes("expiry") ? null : "day3";
  return null;
}

export const REVIEW_REQUEST_AFTER_DAYS = 7;
/** No review request for installs finished more than this many days ago (no backlog when the switch first opens). */
export const REVIEW_REQUEST_LAST_DAY = 21;
export const REVIEW_REQUEST_STOP_STAGES = ["cancelled", "on_hold"] as const;

/**
 * The O51 star buttons link to My job `?screen=review&stars=N`. Decision 335 (Jo 25 Oct 2026): that screen now exists —
 * it records the stars (append-only `owner_review_stars`), sends 4–5 stars to the Google review link and keeps 1–3 stars
 * private (feedback box + one Needs me row). The sweep still needs HIV_GOOGLE_REVIEW_URL, the approval flag and
 * customer_comms_enabled.
 */
export const OWNER_REVIEW_SCREEN_READY = true as boolean;

/** Why the review request cannot go yet (null = it may). Needs a real https Google review link and the review screen. */
export function reviewRequestBlocker(i: { googleReviewUrl: string | null | undefined; reviewScreenReady: boolean }): string | null {
  if (!i.reviewScreenReady) return "The My job review screen (star taps) is not built yet";
  if (!i.googleReviewUrl || !/^https:\/\/\S+$/.test(i.googleReviewUrl.trim())) return "No Google review link set (HIV_GOOGLE_REVIEW_URL)";
  return null;
}

/** Decision 105: one review request a week after the install, only while the job is not cancelled/on hold and not opted out. */
export function reviewRequestDue(f: { installationCompletedAt: string | null; stage: string; deletedAt: string | null; qaArchivedAt?: string | null; done: boolean; optedOut: boolean }, now: Date): boolean {
  if (!f.installationCompletedAt || f.done || f.optedOut || f.deletedAt || f.qaArchivedAt) return false;
  if ((REVIEW_REQUEST_STOP_STAGES as readonly string[]).includes(f.stage)) return false;
  const age = now.getTime() - Date.parse(f.installationCompletedAt);
  return age >= REVIEW_REQUEST_AFTER_DAYS * DAY && age < REVIEW_REQUEST_LAST_DAY * DAY;
}

/**
 * Decision 135: a booked install day moved. `change` is the latest `install_day_changed` event (its `was` = the old
 * booked start); `previousBookingAt` is when the latest earlier installation booking was written. The O42 email goes
 * for the new booking that follows a change made by the installer (or a "couldn't get in" report); an owner who changed
 * the day themselves gets the normal booked email instead. A booking already written after the change means this one
 * is not the move. The same start as before is not a move.
 */
export function installDayMove(i: { newStart: string; change: { at: string; was: string | null; who: string | null } | null; previousBookingAt: string | null }): { was: string } | null {
  const c = i.change;
  if (!c?.was || c.who === "owner") return null;
  if (i.previousBookingAt && Date.parse(i.previousBookingAt) > Date.parse(c.at)) return null;
  if (Date.parse(c.was) === Date.parse(i.newStart)) return null;
  return { was: c.was };
}

/** A direct reschedule of a confirmed booking (confirmBooking at the booked stage): the earlier start when it differs. */
export function directMoveFrom(priorStart: string | null, newStart: string): string | null {
  if (!priorStart || Date.parse(priorStart) === Date.parse(newStart)) return null;
  return priorStart;
}

/** O22: when the safety check step was paid = the ledger entry that brought the cumulative total to its threshold. */
export function safetyCheckPaidAt(ledger: { amountCents: number; paidAt: string }[], thresholdCents: number): string | null {
  let sum = 0;
  for (const r of [...ledger].sort((a, b) => Date.parse(a.paidAt) - Date.parse(b.paidAt))) {
    sum += Math.max(0, Math.round(r.amountCents));
    if (sum >= thresholdCents) return r.paidAt;
  }
  return null;
}

/** O22 goes only for a recent safety check payment: a later payment (deposit, balance) never sends an old "You're in". */
export const YOURE_IN_WITHIN_DAYS = 7;
export function youreInDue(f: { paidAt: string | null; stage: string; deletedAt: string | null }, now: Date): boolean {
  if (!f.paidAt || f.deletedAt || f.stage === "cancelled") return false;
  const age = now.getTime() - Date.parse(f.paidAt);
  return age >= -DAY && age < YOURE_IN_WITHIN_DAYS * DAY;
}

/** "5 December" from YYYY-MM-DD (Melbourne calendar day), null when unknown. */
export function dayMonthLabel(ymd: string | null | undefined): string | null {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}/.test(ymd)) return null;
  return new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "long" }).format(new Date(`${ymd.slice(0, 10)}T12:00:00Z`));
}

/** "Wednesday 5 November" from YYYY-MM-DD or an ISO instant (Melbourne), null when unknown. */
export function weekdayDayMonthLabel(dateOrIso: string | null | undefined): string | null {
  if (!dateOrIso) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(dateOrIso) ? new Date(`${dateOrIso}T12:00:00Z`) : new Date(dateOrIso);
  if (Number.isNaN(d.getTime())) return null;
  const tz = /^\d{4}-\d{2}-\d{2}$/.test(dateOrIso) ? "UTC" : "Australia/Melbourne";
  return new Intl.DateTimeFormat("en-AU", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(d).replace(",", "");
}
