// Decision #24 + Fix 5 (Jo 2 Nov 2026, booked-both2.png / veu-fix5.png): the owner's "You're booked" email + text.
// Ready Check, PIESA (#38, Part 4 Task 1) and install (#46) versions on the same layout. PURE.
// Email: heading, Day / Arriving / Who's coming table, the visit line, "Need to change it? Call {Installer} on {office
// phone}." (no change link — Jo dropped it 2 Nov), then "{Installer} · {office phone} · {business
// email}" and the AP certificates line. The phone is ALWAYS the business OFFICE phone (`businesses.phone`), never a
// worker's mobile: no office phone or no business email → `{ held }` (the sender records an office note, sends nothing).
// Change time (decision 122): the owner gets a new "You're booked" headed "Your time has changed".
import * as K from "./email-kit.core";
import { mjEmail } from "./mail-mjml.core";
import { AP_CERTIFICATES_LINE, contactLine } from "./owner-wording.core";
import { installerName, type TradeContact } from "./owner-will-call.core";
import { aud } from "./payments.core";

export type BookedKind = "ready_check" | "piesa" | "install";
/** `business` = the business that is coming (the installer; for PIESA the ELECTRICIAN's business, whose office phone is the
 *  change line). PIESA also needs `installerName` (the 30-day rule names who will call to book the install; the job's installer
 *  business, not the electrician) and install needs `balanceCents` (the rest, due on install day). `installDeadline` (YYYY-MM-DD,
 *  PIESA) is carried for callers; the approved wording gives no date, so it is not shown. */
export type BookedFacts = { kind: BookedKind; firstName: string | null; startIso: string; whoName: string; business: TradeContact; changed: boolean; installerName?: string | null | undefined; installDeadline?: string | undefined; balanceCents?: number | null | undefined };
export type BookedNotice = { subject: string; text: string; html: string; sms: string };
export type Held = { held: string };

/** Sends of the new wording stay off until Jo OKs the rendered pictures (the wording itself is approved). Off → the
 *  current in-house `bookingNotice` wording keeps going out, with the same purpose and key. */
export const OWNER_BOOKED_READY_CHECK_APPROVED = true as boolean; // ON 5 Nov 2026 10:52
export const OWNER_BOOKED_PIESA_APPROVED = true as boolean; // ON 5 Nov 2026 10:52
export const OWNER_BOOKED_INSTALL_APPROVED = true as boolean; // ON 5 Nov 2026 10:52
export const OWNER_BOOKED_V2_APPROVED: Record<BookedKind, boolean> = { ready_check: OWNER_BOOKED_READY_CHECK_APPROVED, piesa: OWNER_BOOKED_PIESA_APPROVED, install: OWNER_BOOKED_INSTALL_APPROVED };

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

const BEFORE_ARRIVE: Record<"piesa" | "install", string[]> = {
  piesa: ["switchboard and ceiling hatch access", "someone 18+ home", "pets away"],
  install: ["clear the way to the ceiling hatch", "someone 18+ home", "power off while they work in the ceiling", "pets away"],
};
const WHAT_PIESA = "A licensed electrician checks your switchboard, ceiling wiring and downlights are safe to insulate over. It's already paid for.";
const WHAT_READY = "They'll measure up and confirm your quote. It's free, with no obligation.";

export function ownerBookedNotice(f: BookedFacts, opts: { test?: boolean } = {}): BookedNotice | Held {
  const hold = heldReason(f.business);
  if (hold) return hold;
  const kind = f.kind;
  const callerName = clean(f.installerName);
  if (kind === "piesa" && !callerName) return { held: "No installer on file" };
  const balanceOk = typeof f.balanceCents === "number" && Number.isFinite(f.balanceCents) && f.balanceCents >= 0;
  if (kind === "install" && !balanceOk) return { held: "No balance on file" };
  const name = installerName(f.business);
  const phone = clean(f.business.officePhone);
  const contact = contactLine(f.business)!;
  const booked = { ready_check: "You're booked for your free Ready Check", piesa: "You're booked for your electrical safety check (PIESA)", install: "You're booked for your insulation install" }[kind];
  const subject = f.changed ? "Your time has changed" : booked;
  const day = bookedDay(f.startIso);
  const time = bookedTime(f.startIso);
  const whoLabel = kind === "install" ? "Lead Installer" : "Who's coming";
  const who = kind === "install" ? clean(f.whoName) : `${clean(f.whoName)}, ${name}`;
  const what = kind === "piesa" ? WHAT_PIESA : kind === "ready_check" ? WHAT_READY : null;
  const change = `Need to change it? Call ${name} on ${phone}.`;
  const ticks = kind === "ready_check" ? [] : BEFORE_ARRIVE[kind].map((t) => `✓ ${t}`);
  const rule = kind === "piesa" ? { label: "The 30-day rule:", body: `Your insulation must be installed within 30 days of this check, or it has to be done again. ${callerName} will call you to book your install day.` } : null;
  const balance = kind === "install" ? { label: "Your balance:", body: `The rest of your payment, ${aud(f.balanceCents as number)}, is due on install day. We'll send you a link to pay by card or bank transfer.` } : null;
  const heading = `<mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${K.esc(subject)}</mj-text>${f.changed ? `<mj-text mj-class="h2" css-class="email-sub" padding="0 12px 10px">${K.esc(booked)}</mj-text>` : ""}`;
  const labelled = (x: { label: string; body: string }) => `<mj-text><b>${K.esc(x.label)}</b> ${K.esc(x.body)}</mj-text>`;
  const body = [
    `<mj-section><mj-column>${heading}</mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel"><mj-table padding="10px 18px">${row("Day", day)}${row("Arriving", time)}${row(whoLabel, who)}</mj-table></mj-column></mj-section>`,
    `<mj-section><mj-column>${what ? `<mj-text>${K.esc(what)}</mj-text>` : ""}${ticks.length ? `<mj-text><b>Before they arrive</b><br/>${ticks.map(K.esc).join("<br/>")}</mj-text>` : ""}${rule ? labelled(rule) : ""}${balance ? labelled(balance) : ""}<mj-text>${K.esc(change)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="small" padding="14px 18px">${K.esc(contact)}<br/>${K.esc(AP_CERTIFICATES_LINE)}</mj-text></mj-column></mj-section>`,
  ].join("\n");
  const html = mjEmail({ subject, preview: what ?? booked, body, unsubscribe: null, testLabel: opts.test === true });
  const text = K.plainText([
    subject, ...(f.changed ? [booked] : []), "",
    `Day: ${day}`, `Arriving: ${time}`, `${whoLabel}: ${who}`, "",
    ...(what ? [what, ""] : []),
    ...(ticks.length ? ["Before they arrive", ...ticks, ""] : []),
    ...(rule ? [`${rule.label} ${rule.body}`, ""] : []),
    ...(balance ? [`${balance.label} ${balance.body}`, ""] : []),
    change, "",
    contact, AP_CERTIFICATES_LINE,
  ], { testLabel: opts.test === true });
  const hi = K.cleanName(f.firstName) || "there";
  const smsWhat = { ready_check: "your free Ready Check", piesa: "your electrical safety check (PIESA)", install: "your insulation install" }[kind];
  const sms = `Home Insulation Victoria: Hi ${hi}, you're booked for ${smsWhat}: ${bookedShort(f.startIso)}. ${clean(f.whoName)} from ${name} is coming. ${change}`;
  return { subject, text, html, sms };
}
