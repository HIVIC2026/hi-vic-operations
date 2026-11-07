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
/** Jo 7 Nov (one pile): a requested firm quote stays in Enquiries › With photos until it is given to an installer (or
 *  quoted); while it is there it is in no Jobs list. */
export const firmQuoteHeldInEnquiries = (f: { firmQuote: boolean; requested: boolean; hasInstaller: boolean; hasQuote: boolean }): boolean =>
  f.firmQuote && f.requested && !f.hasInstaller && !f.hasQuote;
export const firmQuoteRequestTag = (date: string | null | undefined): string | null => date ? `Asked for firm quote · due ${formatDueDate(date)}` : null;

/** TEST-only exception (Jo, option A, 7 Nov 2026): while the switch is NULL, TEST jobs made from this moment with a TEST
 *  owner email still run the firm-quote flow. Same values as the database's request_firm_quote_atomic. */
export const FIRM_QUOTE_TEST_FROM = "2026-11-06T21:30:00Z";
export function isTestFirmQuoteOwnerEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  return /^[^@\s]+@hivic-test\.example$/.test(e) || e === "jolowexo@hotmail.com";
}

export function isFirmQuoteJob(i: { createdAt: string; hasMedia: boolean; liveAt: string | null; source: string | null; ownerEmail?: string | null }): boolean {
  if ((i.source !== "base44" && i.source !== "qa_test") || !i.hasMedia) return false;
  const created = Date.parse(i.createdAt);
  if (!Number.isFinite(created)) return false;
  if (i.liveAt !== null) {
    const live = Date.parse(i.liveAt);
    if (Number.isFinite(live) && created >= live) return true;
  }
  // TEST exception: qa_test source AND a TEST owner email AND made after the exception started. Never real enquiries.
  return i.source === "qa_test" && isTestFirmQuoteOwnerEmail(i.ownerEmail) && created >= Date.parse(FIRM_QUOTE_TEST_FROM);
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
