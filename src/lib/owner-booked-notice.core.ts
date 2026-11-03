// Decision #24 + Fix 5 (Jo 2 Nov 2026, booked-both2.png / veu-fix5.png): the owner's "You're booked" email + text.
// Ready Check only here; Part 4 adds the PIESA (#38) and install (#46) versions on the same layout. PURE.
// Email: heading, Day / Arriving / Who's coming table, the visit line, "Need to change it? Call {Installer} on {office
// phone}." (no change link — Jo dropped it 2 Nov), then "{Installer} · {office phone} · {business
// email}" and the AP certificates line. The phone is ALWAYS the business OFFICE phone (`businesses.phone`), never a
// worker's mobile: no office phone or no business email → `{ held }` (the sender records an office note, sends nothing).
// Change time (decision 122): the owner gets a new "You're booked" headed "Your time has changed".
import * as K from "./email-kit.core";
import { mjEmail } from "./mail-mjml.core";
import { AP_CERTIFICATES_LINE, contactLine } from "./owner-wording.core";
import { installerName, type TradeContact } from "./owner-will-call.core";

export type BookedKind = "ready_check" | "piesa" | "install";
export type BookedFacts = { kind: BookedKind; firstName: string | null; startIso: string; whoName: string; business: TradeContact; changed: boolean };
export type BookedNotice = { subject: string; text: string; html: string; sms: string };
export type Held = { held: string };

/** Sends of the new wording stay off until Jo OKs the rendered pictures (the wording itself is approved). Off → the
 *  current in-house `bookingNotice` wording keeps going out, with the same purpose and key. */
export const OWNER_BOOKED_READY_CHECK_APPROVED = false as boolean;
export const OWNER_BOOKED_V2_APPROVED: Record<BookedKind, boolean> = { ready_check: OWNER_BOOKED_READY_CHECK_APPROVED, piesa: false, install: false };

const clean = (v: string | null | undefined) => (v ?? "").trim();
const TZ = "Australia/Melbourne";
const fmt = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-AU", { timeZone: TZ, ...o }).format(new Date(iso));
/** "Tuesday 4 November" */
export const bookedDay = (iso: string) => fmt(iso, { weekday: "long", day: "numeric", month: "long" }).replace(/,/g, "");
/** "9:00am" */
export const bookedTime = (iso: string) => fmt(iso, { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s/g, "").toLowerCase();
/** "Tue 4 Nov, 9:00am" (the text) */
export const bookedShort = (iso: string) => `${fmt(iso, { weekday: "short", day: "numeric", month: "short" }).replace(/,/g, "")}, ${bookedTime(iso)}`;

function heldReason(c: TradeContact): Held | null {
  if (!clean(c.officePhone)) return { held: `No office phone for ${installerName(c)}` };
  if (!clean(c.email)) return { held: `No business email for ${installerName(c)}` };
  return null;
}

const row = (label: string, value: string) => `<tr><td style="padding:8px 0;color:#5B6478;white-space:nowrap;" width="40%">${K.esc(label)}</td><td style="padding:8px 0;font-weight:700;">${K.esc(value)}</td></tr>`;

export function ownerBookedNotice(f: BookedFacts, opts: { test?: boolean } = {}): BookedNotice | Held {
  if (f.kind !== "ready_check") return { held: `No approved "You're booked" wording for ${f.kind} yet` };
  const hold = heldReason(f.business);
  if (hold) return hold;
  const name = installerName(f.business);
  const phone = clean(f.business.officePhone);
  const contact = contactLine(f.business)!;
  const booked = "You're booked for your free Ready Check";
  const subject = f.changed ? "Your time has changed" : booked;
  const day = bookedDay(f.startIso);
  const time = bookedTime(f.startIso);
  const who = `${clean(f.whoName)}, ${name}`;
  const what = "They'll measure up and confirm your quote. It's free, with no obligation.";
  const change = `Need to change it? Call ${name} on ${phone}.`;
  const heading = `<mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${K.esc(subject)}</mj-text>${f.changed ? `<mj-text mj-class="h2" css-class="email-sub" padding="0 12px 10px">${K.esc(booked)}</mj-text>` : ""}`;
  const body = [
    `<mj-section><mj-column>${heading}</mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel"><mj-table padding="10px 18px">${row("Day", day)}${row("Arriving", time)}${row("Who's coming", who)}</mj-table></mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text>${K.esc(what)}</mj-text><mj-text>${K.esc(change)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="small" padding="14px 18px">${K.esc(contact)}<br/>${K.esc(AP_CERTIFICATES_LINE)}</mj-text></mj-column></mj-section>`,
  ].join("\n");
  const html = mjEmail({ subject, preview: what, body, unsubscribe: null, testLabel: opts.test === true });
  const text = K.plainText([
    subject, ...(f.changed ? [booked] : []), "",
    `Day: ${day}`, `Arriving: ${time}`, `Who's coming: ${who}`, "",
    what, change, "",
    contact, AP_CERTIFICATES_LINE,
  ], { testLabel: opts.test === true });
  const hi = K.cleanName(f.firstName) || "there";
  const sms = `Home Insulation Victoria: Hi ${hi}, you're booked for your free Ready Check: ${bookedShort(f.startIso)}. ${clean(f.whoName)} from ${name} is coming. ${change}`;
  return { subject, text, html, sms };
}
