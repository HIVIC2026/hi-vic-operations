// Batch 3a: O78 "Your quote has expired". PURE renderer. Wording approved by Jo 29 Oct 2026 (QUOTE_EXPIRED_EMAIL_APPROVED = true).
// MJML design: docs/templates/mjml/owner_O78.mjml.
import * as K from "./email-kit.core";
import { mjEmail } from "./mail-mjml.core";

export const QUOTE_EXPIRED_EMAIL_APPROVED = true;
export const QUOTE_EXPIRED_SUBJECT = "Your quote has expired";
export const QUOTE_EXPIRED_BUTTON = "Send me a new quote";
export const QUOTE_EXPIRED_SIGNOFF = "Cheers, the Home Insulation Victoria team";
const PREVIEW = "Tap below and we'll prepare a new quote at today's prices.";

export type QuoteExpiredEmailInput = { firstName: string | null; address: string; link: string; unsubscribeUrl?: string | null; test?: boolean };

const hiLine = (first: string | null) => `Hi${first ? ` ${first}` : ""},`;
const bodyLine = (address: string) => `your insulation quote for ${address} has now expired. If you'd still like to go ahead, tap below and we'll prepare a new quote at today's prices.`;

export function renderQuoteExpiredEmail(i: QuoteExpiredEmailInput) {
  const first = K.cleanName(i.firstName);
  const para = `${hiLine(first)} ${bodyLine(i.address)}`;
  const body = `<mj-section><mj-column><mj-text>${K.esc(para)}</mj-text><mj-button href="${K.esc(i.link)}">${K.esc(QUOTE_EXPIRED_BUTTON)}</mj-button><mj-text>${K.esc(QUOTE_EXPIRED_SIGNOFF)}</mj-text></mj-column></mj-section>`;
  const html = mjEmail({ subject: QUOTE_EXPIRED_SUBJECT, preview: PREVIEW, body, unsubscribe: i.unsubscribeUrl ?? null, testLabel: i.test === true });
  const text = K.plainText([para, "", `${QUOTE_EXPIRED_BUTTON}: ${i.link}`, "", QUOTE_EXPIRED_SIGNOFF], { unsubscribe: i.unsubscribeUrl ?? null, testLabel: i.test === true });
  return { subject: QUOTE_EXPIRED_SUBJECT, html, text };
}
