// Decision #23 (Jo 2 Nov 2026, willcall-both2.png): "{Installer} will call you" email + text, sent when Jo gives the job
// to the installer (in-house batch). Fix 5: the email adds "{Installer} · {office phone} · {business email}". PURE.
// The phone is ALWAYS the installer's OFFICE phone (`businesses.phone`), never a worker's mobile: no office phone or no
// business email → `{ held }` (the sender records an office note and sends nothing). Replaces the draft DB template
// `in_house_partner_will_call` (left in the database as a draft, no longer read).
import { ownCustomerPreQuoteBlocker } from "./own-customer-messages.core";
import * as K from "./email-kit.core";
import { mjEmail } from "./mail-mjml.core";
import { AP_CERTIFICATES_LINE, contactLine, type BusinessContact } from "./owner-wording.core";

/** Part 3/4 name for the trade's office contact; the same shape as Part 2's BusinessContact. */
export type TradeContact = BusinessContact;

/** Sends stay off until Jo OKs the rendered pictures (the wording itself is approved, decision #23). */
export const OWNER_WILL_CALL_APPROVED = true as boolean; // ON 5 Nov 2026 10:52
export const OWNER_WILL_CALL_SMS_TYPE = "owner_will_call" as const;
export const OWNER_WILL_CALL_HELD_EVENT = "owner_will_call_held";
/** Part 10 Task 8: "{installer} will call you" is for Home Insulation Victoria leads only — an installer's own customer
 *  already knows their installer, and their first email from us is the quote. Checked before any claim, send or held note. */
export const willCallAllowed = (channel: string | null | undefined): boolean => ownCustomerPreQuoteBlocker(channel) === null;

export type Held = { held: string };
const clean = (v: string | null | undefined) => (v ?? "").trim();
/** The name owners see: trading name, else the business name (same rule as contactLine). */
export const installerName = (c: TradeContact) => clean(c.tradingName) || clean(c.name);

function heldReason(c: TradeContact, needEmail: boolean): Held | null {
  if (!clean(c.officePhone)) return { held: `No office phone for ${installerName(c)}` };
  if (needEmail && !clean(c.email)) return { held: `No business email for ${installerName(c)}` };
  return null;
}

export type OwnerWillCallInput = { firstName: string | null; installer: TradeContact; unsubscribeUrl: string | null; test?: boolean };

export function ownerWillCallEmail(i: OwnerWillCallInput): { subject: string; html: string; text: string } | Held {
  const hold = heldReason(i.installer, true);
  if (hold) return hold;
  const name = installerName(i.installer);
  const phone = clean(i.installer.officePhone);
  const contact = contactLine(i.installer)!;
  const first = K.cleanName(i.firstName);
  const hi = `Hi${first ? ` ${first}` : ""},`;
  const subject = `${name} will call you`;
  const p1 = `${name} is the EEC-certified installer for your home. They'll call you soon from ${phone} to book your free Ready Check.`;
  const p2 = "At the Ready Check they'll measure up and confirm your quote. It's free, with no obligation.";
  const body = [
    `<mj-section><mj-column><mj-text mj-class="hi">${K.esc(hi)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${K.esc(subject)}</mj-text><mj-text>${K.esc(p1)}</mj-text><mj-text>${K.esc(p2)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="small" padding="14px 18px">${K.esc(contact)}<br/>${K.esc(AP_CERTIFICATES_LINE)}</mj-text></mj-column></mj-section>`,
  ].join("\n");
  const html = mjEmail({ subject, preview: p1, body, unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  const text = K.plainText([hi, "", subject, p1, p2, "", contact, AP_CERTIFICATES_LINE], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  return { subject, html, text };
}

/** SMS type `owner_will_call`. Needs only the office phone. */
export function ownerWillCallText(firstName: string | null, installer: TradeContact): string | Held {
  const hold = heldReason(installer, false);
  if (hold) return hold;
  const hi = K.cleanName(firstName) || "there";
  return `Home Insulation Victoria: Hi ${hi}, ${installerName(installer)} will call you soon from ${clean(installer.officePhone)} to book your free Ready Check.`;
}
