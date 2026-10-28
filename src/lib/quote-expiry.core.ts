// Installation quote expiry + owner nudges (Operating Model v2). Pure rules only.
// A sent installation quote expires at the end of the 14th full day after the day it was sent
// (Melbourne calendar): sent on the 1st -> expires at the end of the 15th. Nudges on day 3 and day 10.
// Rectification quotes are excluded (they get their own timing later).

export const QUOTE_EXPIRY_FULL_DAYS = 14;
export const QUOTE_NUDGE_DAYS = [3, 10] as const;
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

/** First instant the quote is expired (start of the day after the 14th full day). */
export function quoteExpiresAt(sentAt: string | Date): Date {
  const sentDay = melbourneDate(new Date(sentAt));
  return melbourneMidnight(addDays(sentDay, QUOTE_EXPIRY_FULL_DAYS + 1));
}

export function quoteIsExpired(q: { kind: string; sent_at?: string | null }, now: Date = new Date()): boolean {
  if (q.kind !== "installation" || !q.sent_at) return false;
  return now.getTime() >= quoteExpiresAt(q.sent_at).getTime();
}

export type QuoteTimerAction = "expire" | "nudge_day10" | "nudge_day3" | null;

/** What the timer should do now for one quote. Only open (issued) installation quotes with a sent date qualify. */
export function quoteTimerAction(
  q: { kind: string; status: string; sent_at: string | null; nudge_day3_at: string | null; nudge_day10_at: string | null },
  now: Date = new Date(),
): QuoteTimerAction {
  if (q.kind !== "installation" || q.status !== "issued" || !q.sent_at) return null;
  if (quoteIsExpired(q, now)) return "expire";
  const age = now.getTime() - new Date(q.sent_at).getTime();
  const day = 86_400_000;
  if (age >= 10 * day && !q.nudge_day10_at) return "nudge_day10";
  if (age >= 3 * day && !q.nudge_day3_at && !q.nudge_day10_at) return "nudge_day3";
  return null;
}

export const QUOTE_EXPIRED_OWNER_MESSAGE = "This quote has expired. Please contact us for an updated quote.";

// ---- Batch 3a: an expired quote closes the job and emails the owner once ----------------------------------------------

/** The cancel reason the expiry close uses; "Send me a new quote" (Task 2) recognises the job by this exact text. */
export const QUOTE_EXPIRED_CANCEL_REASON = "Quote expired (14 days)";
/** Once-only email key for one expired quote. */
export const quoteExpiredEmailKey = (quoteId: string) => `quote-expired:v1:${quoteId}`;
/** The owner's My job link opened on the "new quote" screen (Task 2 builds the screen). */
export const quoteExpiredPageLink = (myJobLink: string) => `${myJobLink}?screen=newquote`;
/** Close the job only when it is still open and has no other live (issued or accepted) installation quote. */
export function shouldCloseOnExpiry(jobStage: string | null | undefined, otherInstallationQuoteStatuses: readonly string[]): boolean {
  if (!jobStage || jobStage === "cancelled" || jobStage === "complete") return false;
  return !otherInstallationQuoteStatuses.some((s) => s === "issued" || s === "accepted");
}
