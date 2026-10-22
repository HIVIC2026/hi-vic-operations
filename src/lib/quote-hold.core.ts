// Stage 6 (Jo 22 Oct 2026): the 15-minute office window on an automatically prepared owner quote, and the
// "no texts after 8pm" rule. Pure: no database, no network, no clock of its own — callers pass `now`, so
// every decision is testable and replayable.
export const QUOTE_HOLD_MINUTES = 15;

/** When an armed quote may go to the owner. */
export const quoteHoldUntil = (startedAtIso: string, minutes: number = QUOTE_HOLD_MINUTES) =>
  new Date(Date.parse(startedAtIso) + minutes * 60_000).toISOString();

export type QuoteHoldInput = { nowIso: string; autoSendAtIso: string | null; stoppedAtIso: string | null };
export type QuoteHoldDecision = "wait" | "release" | "stopped" | "not_armed";

/** A stopped quote stays stopped — the office decision outranks the clock. */
export function quoteHoldDecision(i: QuoteHoldInput): QuoteHoldDecision {
  if (i.stoppedAtIso) return "stopped";
  if (!i.autoSendAtIso) return "not_armed";
  const at = Date.parse(i.autoSendAtIso);
  if (!Number.isFinite(at)) return "stopped"; // unreadable arm time: never send on a guess
  return at <= Date.parse(i.nowIso) ? "release" : "wait";
}

/** Melbourne quiet hours: no owner texts between 8pm and 7am their time (Jo 22 Oct: "no texts after 8pm"). */
const MELBOURNE_TZ = "Australia/Melbourne";
export function melbourneHour(nowIso: string): number {
  const t = Date.parse(nowIso);
  if (!Number.isFinite(t)) return 12; // an unreadable clock fails closed as quiet
  const raw = new Intl.DateTimeFormat("en-GB", { timeZone: MELBOURNE_TZ, hour: "2-digit", hour12: false }).format(new Date(t));
  const h = Number(raw);
  return Number.isFinite(h) ? h % 24 : 12;
}
export const SMS_QUIET_REASON = "It's after 8pm in Melbourne — the text waits until 7am";
export function smsQuietReason(nowIso: string): string | null {
  if (!Number.isFinite(Date.parse(nowIso))) return SMS_QUIET_REASON; // an unreadable clock fails closed
  const h = melbourneHour(nowIso);
  return h >= 20 || h < 7 ? SMS_QUIET_REASON : null;
}
