// Decision 326 (25 Oct 2026): the approved owner and electrician texts that had wording but no sender. PURE: wording,
// keys and due-rules only. No network, no database. The sender (approved-texts.server.ts) records ONE
// `approved_text_prepared` workflow event per text + key BEFORE sending; the ONE real SMS sender (`sendRealSms`) owns
// the idempotency key, quiet hours, customer_comms_enabled, the per-type switch, consent and STOP; TEST → test-send.
// Every wording below is the decisions-log sentence verbatim; the sender adds "Home Insulation Victoria: " (brandSmsBody).
//  - 78  Ready Check times are ready (owner, our leads)
//  - 82  Ready Check booked (B) + see you tomorrow (owner, our leads)
//  - 89  quote reminder: 3 days after the quote (B) + 2 days before the price expires (A) — timing from decision 88
//  - 93  electrician PIESA offer (B) + safety check booked (A) + see you tomorrow (owner)
//  - 99  insulation install see you tomorrow (owner)
//  - 135 your install has moved (owner)
// NOT here (and why): decision 133's "Pay by card here" balance text is superseded by decisions 140/144 (only the
// balance is bank transfer / PayID only), so it is never sent; 2-hour visit reminders, trade day-before reminders for
// Ready Checks / safety checks, fixes-quote reminders, "pick more safety check times" and pre-start-failed notices have
// no approved wording, so they are no longer queued at all.
import { addYmd } from "./melbourne-time.core";
import { melbourneYmd } from "./piesa-windows.core";
import { melbourneHm } from "./daily-mitti-text.core";
import { melbourneClock, melbourneDayDate } from "./installer-texts.core";
import { quoteExpiresAt } from "./quote-expiry.core";

/** Recorded once per text + key BEFORE sending (details: { text, key, ... }). */
export const APPROVED_TEXT_EVENT = "approved_text_prepared" as const;

/** Each text kind → its SMS type in sms.core SMS_MESSAGE_TYPES (one switch per type). */
export const APPROVED_TEXT_SMS_TYPE = {
  ready_check_times_owner: "ready_check_times_owner",
  ready_check_booked_owner: "ready_check_booked_owner",
  ready_check_tomorrow_owner: "visit_tomorrow_owner",
  piesa_booked_owner: "safety_check_booked_owner",
  piesa_tomorrow_owner: "visit_tomorrow_owner",
  install_tomorrow_owner: "visit_tomorrow_owner",
  quote_reminder_day3: "quote_reminder",
  quote_reminder_expiry: "quote_reminder",
  install_moved_owner: "install_moved",
  piesa_offer: "piesa_offer",
} as const;
export type ApprovedTextKind = keyof typeof APPROVED_TEXT_SMS_TYPE;

/** Catch-up sweeps look back this far for one-off triggers (hours) — the same 24h use-by as the SMS freshness rule. */
export const APPROVED_TEXT_SWEEP_HOURS = 24;
/** Day-before texts go from this Melbourne time on the day before (quiet hours start at 8pm), like decision 99's installer text. */
export const VISIT_TOMORROW_FROM_HM = "16:00";
/** Decision 88: the second quote reminder goes 2 days before the price expires. */
export const QUOTE_EXPIRY_REMINDER_DAYS = 2;
/** Decision 88: the first quote reminder goes 3 days after the quote is sent. */
export const QUOTE_FIRST_REMINDER_DAYS = 3;
const DAY = 86_400_000;

// ---- keys (one text per trigger) ----
export const approvedTextKey = {
  readyCheckTimesOwner: (jobId: string, triggerEventId: string) => `rc-times-owner:v1:${jobId}:${triggerEventId}`,
  readyCheckBookedOwner: (jobId: string, startIso: string) => `rc-booked-owner:v1:${jobId}:${new Date(startIso).toISOString()}`,
  visitTomorrowOwner: (kind: VisitTextKind, jobId: string, bookingId: string, startIso: string) => `visit-tomorrow-owner:v1:${kind}:${jobId}:${bookingId}:${melbourneYmd(new Date(startIso))}`,
  piesaBookedOwner: (jobId: string, startIso: string) => `piesa-booked-owner:v1:${jobId}:${new Date(startIso).toISOString()}`,
  quoteReminder: (quoteId: string, step: QuoteReminderStep) => `quote-reminder-text:v1:${quoteId}:${step}`,
  installMoved: (jobId: string, bookingId: string) => `install-moved:v1:${jobId}:${bookingId}`,
  piesaOffer: (offerId: string) => `piesa-offer:v1:${offerId}`,
};

// ---- small formatters ----
/** "$1,610" (whole dollars), or null for a missing / non-positive amount. */
export function wholeDollars(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(Number(n)) || Number(n) <= 0) return null;
  return `$${Math.round(Number(n)).toLocaleString("en-AU")}`;
}
const clean = (s: string | null | undefined) => s?.trim() || null;

// ---- wording (verbatim from docs/JO_DECISIONS_LOG.md; the sender adds "Home Insulation Victoria: ") ----
// A text that would need a fact we do not have returns null and is not sent (never a made-up name, phone or price).

/** Decision 78 (A). */
export function readyCheckTimesOwnerText(f: { firstName: string | null; suburb: string | null; link: string }): string | null {
  const suburb = clean(f.suburb);
  if (!suburb) return null;
  return `Hi ${clean(f.firstName) ?? "there"}, good news! A certified installer near ${suburb} has offered 3 times for your free Ready Check. Tap to pick one: ${f.link} Reply STOP to opt out.`;
}
/** Decision 82, owner booked (B). */
export function readyCheckBookedOwnerText(f: { startIso: string; installer: string | null; phone: string | null; link: string }): string | null {
  const installer = clean(f.installer);
  if (!installer) return null;
  return `Booked! Your free Ready Check is ${melbourneDayDate(f.startIso)}, ${melbourneClock(f.startIso)}. Installer: ${installer}${clean(f.phone) ? ` ${clean(f.phone)}` : ""}. Details: ${f.link}`;
}
/** Decision 82, owner day before (B). */
export function readyCheckTomorrowOwnerText(f: { startIso: string; installer: string | null; phone: string | null }): string | null {
  const who = tradeAndPhone(f.installer, f.phone);
  return who ? `See you tomorrow at ${melbourneClock(f.startIso)} for your free Ready Check (${who}).` : null;
}
/** Decision 93, owner booked (A). */
export function piesaBookedOwnerText(f: { startIso: string; electrician: string | null; phone: string | null; link: string }): string | null {
  const el = clean(f.electrician);
  if (!el) return null;
  return `Booked! Your electrical safety check is ${melbourneDayDate(f.startIso)}, ${melbourneClock(f.startIso)} with ${el}${clean(f.phone) ? ` (${clean(f.phone)})` : ""}. Details: ${f.link}`;
}
/** Decision 93, owner day before. */
export function piesaTomorrowOwnerText(f: { startIso: string; electrician: string | null; phone: string | null }): string | null {
  const who = tradeAndPhone(f.electrician, f.phone);
  return who ? `See you tomorrow at ${melbourneClock(f.startIso)} for your electrical safety check (${who}).` : null;
}
/** Decision 99, owner day before. */
export function installTomorrowOwnerText(f: { startIso: string; installer: string | null; phone: string | null }): string | null {
  const who = tradeAndPhone(f.installer, f.phone);
  return who ? `See you tomorrow at ${melbourneClock(f.startIso)} for your insulation install (${who}). Reminder: power will be off while they work in the ceiling.` : null;
}
/** Decision 89, 3-day text (B). */
export function quoteReminderDay3Text(f: { firstName: string | null; rebate: number | null; link: string }): string | null {
  const rebate = wholeDollars(f.rebate);
  if (!rebate) return null;
  return `Hi ${clean(f.firstName) ?? "there"}, your quote with ${rebate} off is waiting: ${f.link} Reply STOP to opt out.`;
}
/** Decision 89, expiry text (A). `heldUntilIso` = the last instant the price is held. */
export function quoteReminderExpiryText(f: { firstName: string | null; rebate: number | null; heldUntilIso: string; link: string }): string | null {
  const rebate = wholeDollars(f.rebate);
  if (!rebate) return null;
  return `Hi ${clean(f.firstName) ?? "there"}, your quote price is held until ${melbourneDayDate(f.heldUntilIso)}. Accept by then to keep your ${rebate} rebate price: ${f.link} Reply STOP to opt out.`;
}
/** Decision 135. */
export function installMovedText(f: { startIso: string; link: string }): string {
  return `Your install has moved to ${melbourneDayDate(f.startIso)}, ${melbourneClock(f.startIso)}. Details: ${f.link}`;
}
/** Decision 93, to the electrician (B). `pay` = the offer's agreed electrician rate (inc GST). */
export function piesaOfferText(f: { suburb: string | null; jobNumber: string | null; pay: number | null; link: string }): string | null {
  const suburb = clean(f.suburb), hv = clean(f.jobNumber), pay = wholeDollars(f.pay);
  if (!suburb || !hv || !pay) return null;
  return `New PIESA job near ${suburb} (${hv}), ${pay}. Offer the owner 3 times within 24 hours: ${f.link}`;
}
function tradeAndPhone(name: string | null, phone: string | null): string | null {
  const n = clean(name);
  if (!n) return null;
  return clean(phone) ? `${n}, ${clean(phone)}` : n;
}

// ---- due-rules ----
export type VisitTextKind = "ready_check" | "assessment" | "installation";
/** The day-before text is due when, in Melbourne, today is the day before the visit and it is past the send time. */
export function visitTomorrowDue(now: Date, startIso: string, fromHm = VISIT_TOMORROW_FROM_HM): boolean {
  const start = Date.parse(startIso);
  if (!Number.isFinite(start) || start <= now.getTime()) return false;
  if (addYmd(melbourneYmd(now), 1) !== melbourneYmd(new Date(startIso))) return false;
  return melbourneHm(now) >= fromHm;
}

export type QuoteReminderStep = "day3" | "expiry";
export type QuoteReminderFacts = { kind: string; status: string; release_state: string | null; sent_at: string | null };
/** Decision 88: a text 3 days after the quote is sent, and again 2 days before the price expires, only while the
 *  released installation quote is still open (not accepted, declined, expired or withdrawn). A missed day-3 step is
 *  never sent late inside the expiry window: only the expiry step is due there. */
export function quoteReminderDue(q: QuoteReminderFacts, now: Date): QuoteReminderStep | null {
  if (q.kind !== "installation" || q.status !== "issued" || q.release_state !== "released" || !q.sent_at) return null;
  const sent = Date.parse(q.sent_at);
  if (!Number.isFinite(sent)) return null;
  const expires = quoteExpiresAt(q.sent_at).getTime();
  const t = now.getTime();
  if (t >= expires) return null;
  if (t >= expires - QUOTE_EXPIRY_REMINDER_DAYS * DAY) return "expiry";
  if (t >= sent + QUOTE_FIRST_REMINDER_DAYS * DAY) return "day3";
  return null;
}
/** Last instant the quote price is held (for the "held until {Day Date}" wording). */
export const quoteHeldUntil = (sentAt: string) => new Date(quoteExpiresAt(sentAt).getTime() - 1).toISOString();

export type InstallBookingRow = { id: string; scheduled_start: string; status: string; created_at: string };
/** Decision 135: an install has "moved" when this confirmed booking replaced an earlier install booking on the same job
 *  that was cancelled and was for a different start. The first booking (or the same start rebooked) is never "moved". */
export function installMovedFrom(current: InstallBookingRow, all: readonly InstallBookingRow[]): string | null {
  if (current.status !== "confirmed") return null;
  const cur = Date.parse(current.scheduled_start);
  const prior = all
    .filter((b) => b.id !== current.id && b.status === "cancelled" && b.created_at <= current.created_at && Date.parse(b.scheduled_start) !== cur)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return prior?.scheduled_start ?? null;
}

/** A one-off text whose last attempt was held ONLY by quiet hours may be tried again once quiet hours are over. The
 *  sender never records the event while quiet, so this is the sweep's guard against texting before 7am. */
export const QUIET_HOURS_WAIT = "waiting for quiet hours to end (8pm–7am Melbourne)" as const;
