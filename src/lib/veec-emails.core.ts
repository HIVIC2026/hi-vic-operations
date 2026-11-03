// VEEC assignment (rebate form) owner emails. Decision 169 (Jo, 24 Oct 2026):
//   Day 0 request  = the approved All done email (O44, `renderInstallCompleteEmail` in completion-emails.core.ts) — its
//                    "One last thing: sign your rebate form" box IS the request, so no separate day-0 email exists.
//   O62 signed copy docs/templates/mjml/owner_O62.mjml   (the executed PDF attached, also on the job page)
// Retired 2 Nov 2026 (Part 4 Task 14, touchpoint 53): the separate O61 reminders on days 1/3/7 — the after-install reminders
// (after-install-reminders.core.ts, one message for whatever is still undone) replace them.
// The copy flag is on: real owners receive it through the guarded owner-email path, which still needs
// `customer_comms_enabled` (assertCustomerDeliveryAllowed) and the owner's contact consent; TEST jobs use test-send. Pure.
import * as K from "./email-kit.core";
import { mjEmail, esc } from "./mail-mjml.core";

export const VEEC_COPY_EMAIL_APPROVED = true as boolean;

export type VeecCopyEmailInput = { firstName: string | null; jobNumber: string; signedAt: string; myJobUrl: string; unsubscribeUrl: string | null; test?: boolean };

/** "21 November 2026" in Melbourne time. */
export const melbourneLongDate = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "long", year: "numeric" });

/** O62: "Here's your signed rebate form, {First}" — the executed copy is attached to this email and sits on the job page. */
export function renderVeecCopyEmail(i: VeecCopyEmailInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const subject = `Here's your signed rebate form, ${first}`;
  const copy = `Thanks for signing. Your copy of the rebate form for ${i.jobNumber} is attached. Keep it with your home records.`;
  const signed = `Signed on ${melbourneLongDate(i.signedAt)}`;
  const escLine = "Questions about the rebate scheme? The Essential Services Commission is at veu@esc.vic.gov.au.";
  const preview = `${signed}. Keep it with your home records.`;
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(subject)}</mj-text><mj-text>${esc(copy)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel"><mj-text mj-class="center" padding="16px 12px 16px"><strong>${esc(signed)}</strong></mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text mj-class="small" padding="0 12px">${esc(escLine)}</mj-text></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject, preview, body, unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  const text = K.plainText([subject, "", copy, "", `${signed}.`, "",  "", escLine], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  return { subject, html, text };
}

/** The attachment name the owner sees for the executed form. */
export const veecCopyFilename = (jobNumber: string) => `VEEC-assignment-form-${(jobNumber || "signed").replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;

/** Bytes → base64 (no Buffer: the live worker has none). */
export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
