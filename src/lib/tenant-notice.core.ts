// Part 4 Task 16 (cl 23; Jo 2 Nov 2026, answers 7 and 22): once the install day is booked — and again whenever its time
// changes — the TENANT always gets the notice by text AND email: the date, the time, that the power will be off for the
// day, and the business name + office phone. The tenant's name, mobile and email come from the owner's quick taps
// (rental-answers.core). It is a compliance send: the owner's "Do not contact" never blocks it (a STOP from the tenant's
// own number does). Tenant-facing wording follows the owner rules: "Home Insulation Victoria" in full, business name +
// OFFICE phone only, never a worker's mobile, nothing about money, consent or paperwork. DRAFT wording (Jo approves it as
// a picture), so every send stays behind TENANT_NOTICE_APPROVED = false. PURE: no I/O.
import * as K from "./email-kit.core";
import { mjEmail } from "./mail-mjml.core";
import { bookedDay, bookedShort, bookedTime } from "./owner-booked-notice.core";
import { installerName, type TradeContact } from "./owner-will-call.core";
import type { RentalAnswers } from "./rental-answers.core";

/** Off until Jo approves the rendered text + email (JO-APPROVAL-LIST). The SMS type is also `wordingApproved: false`. */
export const TENANT_NOTICE_APPROVED = false as boolean;
export const TENANT_NOTICE_SMS_TYPE = "tenant_notice" as const;
/** Email purpose; listed in COMPLIANCE_OWNER_EMAIL_PURPOSES (do-not-contact.core) so Do not contact / unsubscribe never hold it. */
export const TENANT_NOTICE_EMAIL_PURPOSE = "tenant_notice";
/** Recorded once per booking after the sends; clears the Needs me row. */
export const TENANT_NOTICE_SENT_EVENT = "tenant_notice_sent";
/** Recorded (one row per booking + reason) when the notice cannot go: tenant details missing, or no office phone. */
export const TENANT_NOTICE_HELD_EVENT = "tenant_notice_held";
export const NO_TENANT_DETAILS = "no tenant details";
/** Jo 4 Nov 2026: the tenant's email is optional — the text still goes; the email outcome says this. */
export const NO_TENANT_EMAIL = "no tenant email";

/** One notice per booking and channel; a changed time is a new booking row, so a new notice. */
export const tenantNoticeKey = (bookingId: string, channel: "sms" | "email") => `tenant-notice:v1:${bookingId}:${channel}`;

/** True when the owner answered "rented" (tenant details may still be missing — the sender holds then). */
export const tenantNoticeNeeded = (r: RentalAnswers | null): boolean => r?.rented === true;

type Held = { held: string };
export type TenantNoticeFacts = { firstName: string | null; address: string; startIso: string; business: TradeContact };
export type TenantNoticeMessage = { sms: string; email: { subject: string; text: string; html: string } };
const clean = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ");

/** DRAFT wording. The text and the email say the same thing: where, the day and time, the power will be off for the day, who
 *  to call (business name + office phone). No office phone → held (never a worker's mobile, never blank). */
export function tenantNotice(f: TenantNoticeFacts, opts: { test?: boolean } = {}): TenantNoticeMessage | Held {
  const name = installerName(f.business);
  const phone = clean(f.business.officePhone);
  if (!phone) return { held: `No office phone for ${name}` };
  const hi = K.cleanName(f.firstName) || "there";
  const address = clean(f.address);
  const day = bookedDay(f.startIso);
  const time = bookedTime(f.startIso);
  const power = "The power will be off for the day while they work in the ceiling.";
  const call = `Questions? Call ${name} on ${phone}.`;
  const sms = `Home Insulation Victoria: Hi ${hi}, ceiling insulation is being installed at ${address} on ${bookedShort(f.startIso)}. ${power} ${call}`;
  const subject = `Ceiling insulation is being installed on ${bookedShort(f.startIso).split(",")[0]}`;
  const intro = `Ceiling insulation is being installed at ${address}. Here's what you need to know for the day.`;
  const row = (label: string, value: string) => `<tr><td style="padding:8px 0;color:#5B6478;white-space:nowrap;" width="40%">${K.esc(label)}</td><td style="padding:8px 0;font-weight:700;">${K.esc(value)}</td></tr>`;
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${K.esc(subject)}</mj-text><mj-text>Hi ${K.esc(hi)},</mj-text><mj-text>${K.esc(intro)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel"><mj-table padding="10px 18px">${row("Where", address)}${row("Day", day)}${row("Arriving", time)}${row("Who's coming", name)}</mj-table></mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text><b>Power:</b> ${K.esc(power)}</mj-text><mj-text>${K.esc(call)}</mj-text></mj-column></mj-section>`,
  ].join("\n");
  const html = mjEmail({ subject, preview: intro, body, unsubscribe: null, testLabel: opts.test === true });
  const text = K.plainText([
    subject, "", `Hi ${hi},`, intro, "",
    `Where: ${address}`, `Day: ${day}`, `Arriving: ${time}`, `Who's coming: ${name}`, "",
    `Power: ${power}`, "", call,
  ], { testLabel: opts.test === true });
  return { sms, email: { subject, text, html } };
}

/** Office line for the Needs me row. */
export const tenantNoticeHeldLine = (reason: string) =>
  reason === NO_TENANT_DETAILS
    ? "Tenant not told the install day — no tenant details. Add the tenant's name, mobile and email on the job."
    : `Tenant not told the install day — ${reason}. Add it on the business, then it goes automatically.`;

/** Needs me (office-needs): the newest held note for a CURRENT confirmed install booking stays open until a notice for that
 *  booking is sent; a moved booking gets its own notice (and its own note), so the old note closes by itself. */
export function tenantNoticeHeldOpen(
  events: { event_type: string; created_at: string; details?: { booking_id?: string | null; reason?: string | null } | null }[],
  currentInstalls: { id: string; scheduled_start: string }[],
): { at: string; text: string } | null {
  const current = new Set(currentInstalls.map((b) => b.id));
  const held = events.filter((e) => e.event_type === TENANT_NOTICE_HELD_EVENT && e.details?.booking_id && current.has(e.details.booking_id)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const h of held) {
    const sent = events.some((e) => e.event_type === TENANT_NOTICE_SENT_EVENT && e.details?.booking_id === h.details!.booking_id);
    if (!sent) return { at: h.created_at, text: tenantNoticeHeldLine(h.details?.reason ?? "held") };
  }
  return null;
}
