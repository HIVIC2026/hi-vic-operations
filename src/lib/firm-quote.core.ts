// Pure classification and Melbourne dates; no workflow writes or delivery.
import { addVicBusinessDays, addYmd, melbourneToday } from "./melbourne-time.core";

export const FIRM_QUOTE_REQUESTED_EVENT = "firm_quote_requested";
export const FIRM_QUOTE_DAY4_EVENT = "firm_quote_day4_sent";

export function isFirmQuoteJob(i: { createdAt: string; hasMedia: boolean; liveAt: string | null; source: string | null }): boolean {
  if (i.source !== "base44" || !i.hasMedia || i.liveAt === null) return false;
  const created = Date.parse(i.createdAt), live = Date.parse(i.liveAt);
  return Number.isFinite(created) && Number.isFinite(live) && created >= live;
}

export function firmQuoteDueBy(requestedAtIso: string): string {
  return addVicBusinessDays(requestedAtIso, 7);
}

export function firmQuoteDay4Due(i: { requestedAt: string; now: Date; quoteSentAt: string | null; closed: boolean; day4SentAt: string | null }): boolean {
  if (i.closed || i.quoteSentAt !== null || i.day4SentAt !== null) return false;
  const requested = new Date(i.requestedAt);
  if (!Number.isFinite(requested.getTime()) || !Number.isFinite(i.now.getTime())) return false;
  return melbourneToday(i.now) >= addYmd(melbourneToday(requested), 4);
}

export function formatDueDate(isoDate: string): string {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne", weekday: "long", day: "numeric", month: "long",
  }).format(new Date(`${isoDate}T12:00:00Z`));
}