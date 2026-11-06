// Pure classification and Melbourne dates; no workflow writes or delivery.
import { addVicBusinessDays, addYmd, melbourneToday } from "./melbourne-time.core";
import { quoteMethodOf } from "./photo-quote.core";

export const FIRM_QUOTE_REQUESTED_EVENT = "firm_quote_requested";
export const FIRM_QUOTE_DAY4_EVENT = "firm_quote_day4_sent";

export const FIRM_QUOTE_INSTALLER_REASON = "Firm quote jobs go to installers who quote from photos.";
export function firmQuoteInstallerBlocker(firm: boolean, business: { quote_method?: string | null }): string | null {
  return firm && quoteMethodOf(business) !== "photos" ? FIRM_QUOTE_INSTALLER_REASON : null;
}
export function firmQuoteRequestDueBy(events: readonly { event_type: string; details: unknown }[]): string | null {
  const event = events.find(e => e.event_type === FIRM_QUOTE_REQUESTED_EVENT);
  const date = (event?.details as { due_by?: unknown } | null)?.due_by;
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) ? date : null;
}
export const firmQuoteRequestTag = (date: string | null | undefined): string | null => date ? `Asked for firm quote · due ${formatDueDate(date)}` : null;

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
/** Task 9: the issued quote + firm facts → the firm-quote-ready email input (validUntil is the quote's own date). */
export function firmQuoteReadyInput(q: { firstName: string | null; totalIncGst: number; rebateIncGst: number | null; subtotalIncGst?: number | null; validUntil: Date | null; quoteUrl: string },
  f: { ownerM2: number | null; confirmedM2: number; removalM2: number; removalRatePerM2: number }) {
  if (!q.validUntil) throw new Error("Firm quote: quote valid-until date missing.");
  const rebate = q.rebateIncGst ?? 0;
  const y = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(q.validUntil);
  return { firstName: q.firstName || "there", price: q.totalIncGst, rebate, fullPrice: q.subtotalIncGst ?? q.totalIncGst + rebate,
    ownerM2: f.ownerM2, confirmedM2: f.confirmedM2, removalM2: f.removalM2, removalRatePerM2: f.removalRatePerM2, validUntil: y, acceptUrl: q.quoteUrl };
}
