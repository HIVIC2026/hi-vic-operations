import { mjEmail, esc } from "./mail-mjml.core";

export const OWNER_CODE_PURPOSE = "owner_verification_code";

export function ownerCodeSmsBody(code: string) {
  return `Your signing code is ${code}. It expires in 10 minutes. If you did not request this, ignore this text.`;
}

const OWNER_CODE_SUBJECT = "Your signing code";

/** Owner signing-code email (design docs/templates/mjml/owner_signing-code.mjml). The text's first line is the subject
 *  (owner-code-delivery.server reads it). No unsubscribe link and no TEST label, as before. */
export function ownerCodeEmail(code: string) {
  const intro = "Here's your Home Insulation Victoria signing code.";
  const expires = "Expires in 10 minutes";
  const ignore = "If you didn't ask for this, you can ignore this email.";
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(OWNER_CODE_SUBJECT)}</mj-text><mj-text>${esc(intro)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel"><mj-text mj-class="center" font-family="'Courier New', Courier, monospace" font-size="42px" line-height="50px" font-weight="700" letter-spacing="8px" color="#22376B" padding="22px 12px 6px">${esc(code)}</mj-text><mj-text mj-class="small center" padding="0 12px 18px">${esc(expires)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text mj-class="small" padding="16px 12px 0">${esc(ignore)}</mj-text></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject: OWNER_CODE_SUBJECT, preview: `Your Home Insulation Victoria signing code is ${code}. It expires in 10 minutes.`, body, unsubscribe: null, testLabel: false });
  const text = [OWNER_CODE_SUBJECT, "", `Your Home Insulation Victoria signing code is ${code}.`, "It expires in 10 minutes. If you didn't ask for this, you can ignore this email."].join("\n");
  return { html, text };
}

export function ownerCodeDeliveryKey(codeId: string) {
  return `owner-code-${codeId}`;
}
