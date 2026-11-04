// Installation quote expiry + owner nudges (Operating Model v2). Pure rules only.
// Decision #30 (Jo 2 Nov 2026, replaces the 29 Oct 14-day expiry): a sent installation quote is valid for 30 days — it
// expires at the end of the 30th full day after the day it was sent (Melbourne calendar): sent on 10 Nov -> last valid day
// 10 Dec. Points: day 3 and 2 days before expiry (the expiry point still uses the `nudge_day10_at` column).
// Review Focus 5: a quote sent before the 30-day change ships keeps the 14-day date it was sent with (the owner was told
// that date). The change ships with QUOTE_30_DAY_FROM_ISO = null (every quote 14 days); the release commit sets it.
// Rectification quotes are excluded (they get their own timing later).

export const QUOTE_VALID_DAYS = 30;
/** Quotes sent before QUOTE_30_DAY_FROM_ISO keep the old 14 days. */
export const QUOTE_OLD_VALID_DAYS = 14;
/** First instant (UTC ISO) a sent quote gets 30 days. null = not switched on yet: every quote keeps 14 days.
 *  Set to the release commit's UTC time when Jo approves (Part 3 Task 20 Step 5). */
export const QUOTE_30_DAY_FROM_ISO = null as string | null;
/** The expiry reminder point: this many days before the quote expires. */
export const QUOTE_EXPIRY_NUDGE_LEAD_DAYS = 2;
const TZ = "Australia/Melbourne";

function melbourneDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** UTC instant of 00:00 Melbourne time on the given YYYY-MM-DD. */
function melbourneMidnight(ymd: string): Date {
  for (const off of [10, 11]) {
    const guess = new Date(`${ymd}T00:00:00Z`);
    guess.setUTCHours(guess.getUTCHours() - off);
    if (melbourneDate(guess) === ymd && melbourneDate(new Date(guess.getTime() - 1)) !== ymd) return guess;
  }
  const g = new Date(`${ymd}T00:00:00Z`);
  g.setUTCHours(g.getUTCHours() - 10);
  return g;
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 30 for a quote sent at/after the cutover, 14 for one sent before it (or while the cutover is not set). */
export function quoteValidDaysFor(sentAt: string | Date, thirtyDayFromIso: string | null = QUOTE_30_DAY_FROM_ISO): 14 | 30 {
  if (!thirtyDayFromIso) return 14;
  const from = Date.parse(thirtyDayFromIso);
  return Number.isFinite(from) && new Date(sentAt).getTime() >= from ? 30 : 14;
}

/** First instant the quote is expired (start of the day after its 30th — or, sent before the cutover, 14th — full day). */
export function quoteExpiresAt(sentAt: string | Date, thirtyDayFromIso: string | null = QUOTE_30_DAY_FROM_ISO): Date {
  const sentDay = melbourneDate(new Date(sentAt));
  return melbourneMidnight(addDays(sentDay, quoteValidDaysFor(sentAt, thirtyDayFromIso) + 1));
}

export function quoteIsExpired(q: { kind: string; sent_at?: string | null }, now: Date = new Date(), thirtyDayFromIso: string | null = QUOTE_30_DAY_FROM_ISO): boolean {
  if (q.kind !== "installation" || !q.sent_at) return false;
  return now.getTime() >= quoteExpiresAt(q.sent_at, thirtyDayFromIso).getTime();
}

/** Decision #30 wording for the quote email, quote page and quote reminder emails (texts keep "held until", #32). */
export function quoteValidLine(validUntil: Date): string {
  const d = new Intl.DateTimeFormat("en-AU", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" }).format(validUntil);
  return `Your quote is valid for ${QUOTE_VALID_DAYS} days, until ${d}.`;
}

export type QuoteTimerAction = "expire" | "nudge_expiry" | "nudge_day3" | null;

/** What the timer should do now for one quote. Only open (issued) installation quotes with a sent date qualify.
 *  The expiry point is recorded in `nudge_day10_at` (column name kept). */
export function quoteTimerAction(
  q: { kind: string; status: string; sent_at: string | null; nudge_day3_at: string | null; nudge_day10_at: string | null },
  now: Date = new Date(),
  thirtyDayFromIso: string | null = QUOTE_30_DAY_FROM_ISO,
): QuoteTimerAction {
  if (q.kind !== "installation" || q.status !== "issued" || !q.sent_at) return null;
  const expires = quoteExpiresAt(q.sent_at, thirtyDayFromIso).getTime();
  const t = now.getTime();
  if (t >= expires) return "expire";
  const day = 86_400_000;
  if (t >= expires - QUOTE_EXPIRY_NUDGE_LEAD_DAYS * day) return q.nudge_day10_at ? null : "nudge_expiry";
  if (t - new Date(q.sent_at).getTime() >= 3 * day && !q.nudge_day3_at && !q.nudge_day10_at) return "nudge_day3";
  return null;
}

export const QUOTE_EXPIRED_OWNER_MESSAGE = "This quote has expired. Please contact us for an updated quote.";

// ---- Batch 3a: an expired quote closes the job and emails the owner once ----------------------------------------------

/** The cancel reason the expiry close uses for a 30-day quote. */
export const QUOTE_EXPIRED_CANCEL_REASON = "Quote expired (30 days)";
/** The reason used for quotes sent before the 30-day change (and every job closed before it). */
export const QUOTE_EXPIRED_CANCEL_REASON_14_DAY = "Quote expired (14 days)";
/** "Send me a new quote" (Task 2), My job and Needs me recognise an expiry-closed job by either exact text. */
export const QUOTE_EXPIRED_CANCEL_REASONS = [QUOTE_EXPIRED_CANCEL_REASON, QUOTE_EXPIRED_CANCEL_REASON_14_DAY] as const;
export const quoteExpiredCancelReason = (validDays: 14 | 30): string => (validDays === 30 ? QUOTE_EXPIRED_CANCEL_REASON : QUOTE_EXPIRED_CANCEL_REASON_14_DAY);
export const isQuoteExpiredCancelReason = (r: string | null | undefined): boolean => !!r && (QUOTE_EXPIRED_CANCEL_REASONS as readonly string[]).includes(r);
/** Once-only email key for one expired quote. */
export const quoteExpiredEmailKey = (quoteId: string) => `quote-expired:v1:${quoteId}`;
/** The owner's My job link opened on the "new quote" screen (Task 2 builds the screen). */
export const quoteExpiredPageLink = (myJobLink: string) => `${myJobLink}?screen=newquote`;
/** Close the job only when it is still open and has no other live (issued or accepted) installation quote. */
export function shouldCloseOnExpiry(jobStage: string | null | undefined, otherInstallationQuoteStatuses: readonly string[]): boolean {
  if (!jobStage || jobStage === "cancelled" || jobStage === "complete") return false;
  return !otherInstallationQuoteStatuses.some((s) => s === "issued" || s === "accepted");
}

/** Office-only: the expired quote's job has a live booking or money paid (or is on hold), so it is never closed by the timer. */
export const QUOTE_EXPIRED_HELD_REASON = "Quote expired — job has a booking or payment, check before closing";
/** The same safety checks the decline auto-close uses (any confirmed/proposed booking, any money paid), plus on hold. */
export function quoteExpiryHeld(f: { stage: string | null | undefined; liveBooking: boolean; paid: boolean }): boolean {
  return f.stage === "on_hold" || f.liveBooking || f.paid;
}

/** Close + email only between 7am and 8pm Melbourne (the same quiet hours as texts); null = fine to act now. */
export { smsQuietReason as quoteCloseQuietReason } from "./quote-hold.core";
/** How far back the retry pass looks for expired quotes whose close or email is not finished. */
export const QUOTE_CLOSE_RETRY_DAYS = 14;
/** Event types of the close. `quote_expired_closed` = close AND email done (TEST send counts). */
export const QUOTE_EXPIRED_CLOSED_EVENT = "quote_expired_closed";
export const QUOTE_EXPIRED_CANCELLED_EVENT = "quote_expired_cancelled";
export const QUOTE_EXPIRED_BLOCKED_EVENT = "quote_expired_not_emailable";
export const quoteExpiredBlockedLine = (reason: string) => `Quote expired — owner can't be emailed (${reason})`;
/** A definite provider failure is worth resending; every other outcome (sent, already attempted, uncertain, blocked) is final. */
export const quoteExpiredEmailRetriable = (out: string): boolean => /^email failed/.test(out);
