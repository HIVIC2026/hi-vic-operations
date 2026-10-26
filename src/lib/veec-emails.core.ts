// VEEC assignment (rebate form) owner emails. Decision 169 (Jo, 24 Oct 2026):
//   Day 0 request  = the approved All done email (O44, `renderInstallCompleteEmail` in completion-emails.core.ts) — its
//                    "One last thing: sign your rebate form" box IS the request, so no separate day-0 email exists.
//   O61 reminder   docs/templates/owner/O61-veec-reminder.html   (days 1, 3 and 7)
//   O62 signed copy docs/templates/owner/O62-veec-copy.html      (the executed PDF attached, also on the job page)
// Both flags are on: real owners receive them through the guarded owner-email path, which still needs
// `customer_comms_enabled` (assertCustomerDeliveryAllowed) and the owner's contact consent; TEST jobs use test-send. Pure.
import * as K from "./email-kit.core";

export const VEEC_SIGN_EMAIL_APPROVED = true as boolean;
export const VEEC_COPY_EMAIL_APPROVED = true as boolean;

export type VeecReminderEmailInput = { firstName: string | null; rebate: number; signUrl: string; unsubscribeUrl: string | null; test?: boolean };

/** O61: "{First}, your rebate form still needs your signature" with the rebate amount and the Sign button. */
export function renderVeecReminderEmail(i: VeecReminderEmailInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const subject = `${first}, your rebate form still needs your signature`;
  const rebate = K.whole(i.rebate);
  const why = (strong: boolean) => `We can't claim your ${strong ? K.strong(rebate) : rebate} Victorian Energy Upgrades rebate until you've signed it. The rebate has already come off your price, so this is the last step.`;
  const how = "It takes a minute on your phone. The form shows your installer, what was installed and the price.";
  const wrong = "Something on the form look wrong? Reply to this email before signing.";
  const label = "Sign your rebate form";
  const body = [K.h1(subject, 8), K.p(why(true), "0 0 14px", true), K.p(how, "0 0 14px"), K.button(i.signUrl, label, "6px 0 4px"), K.small(wrong, "14px 0 0", { size: 14 })].join("\n");
  const html = K.emailShell({ body, previewText: null, testLabel: i.test === true, unsubscribe: i.unsubscribeUrl });
  const text = K.plainText([subject, "", why(false), "", how, "", `${label}: ${i.signUrl}`, "", wrong], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  return { subject, html, text };
}

export type VeecCopyEmailInput = { firstName: string | null; jobNumber: string; signedAt: string; myJobUrl: string; unsubscribeUrl: string | null; test?: boolean };

/** "21 November 2026" in Melbourne time. */
export const melbourneLongDate = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "long", year: "numeric" });

/** O62: "Here's your signed rebate form, {First}" — the executed copy is attached to this email and sits on the job page. */
export function renderVeecCopyEmail(i: VeecCopyEmailInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const subject = `Here's your signed rebate form, ${first}`;
  const copy = (strong: boolean) => `Thanks for signing. Your copy of the VEEC assignment form for ${strong ? K.strong(i.jobNumber) : i.jobNumber} is attached and also on your job page. Keep it with your home records.`;
  const signed = `Signed on ${melbourneLongDate(i.signedAt)}.`;
  const esc = "Questions about the rebate scheme? The Essential Services Commission is at veu@esc.vic.gov.au.";
  const label = "See my job";
  const body = [K.h1(subject, 8), K.p(copy(true), "0 0 14px", true), K.p(signed, "0 0 14px"), K.button(i.myJobUrl, label, "6px 0 4px"), K.small(esc, "14px 0 0", { size: 14 })].join("\n");
  const html = K.emailShell({ body, previewText: null, testLabel: i.test === true, unsubscribe: i.unsubscribeUrl });
  const text = K.plainText([subject, "", copy(false), "", signed, "", `${label}: ${i.myJobUrl}`, "", esc], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
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
