// The owner's "we need your full address" email and its one reminder. PURE renderer; kept apart from
// address-request.core.ts so the owner page that reads the rules never bundles the email code.
// DRAFT wording (plan 2026-10-28 full address required): shown to Jo before the feature goes live.
import * as K from "./email-kit.core";
import { mjEmail } from "./mail-mjml.core";

export type AddressRequestEmailInput = { pickUrl: string; unsubscribeUrl: string | null; reminder: boolean; test?: boolean };

export const ADDRESS_REQUEST_SUBJECT = "We need your full address";
export const ADDRESS_REQUEST_REMINDER_SUBJECT = "Reminder: we need your full address";
const LEAD = "We need your full address to check your home.";
const ASK = "Please tap the button below and pick your address from the list.";
const BUTTON = "Pick my address";
const SIGN_OFF = "Cheers, the Home Insulation Victoria team";

export function renderAddressRequestEmail(i: AddressRequestEmailInput) {
  const subject = i.reminder ? ADDRESS_REQUEST_REMINDER_SUBJECT : ADDRESS_REQUEST_SUBJECT;
  const lead = i.reminder ? `Just a reminder — ${LEAD.charAt(0).toLowerCase()}${LEAD.slice(1)}` : LEAD;
  const body = `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${K.esc(lead)}</mj-text><mj-text>${K.esc(ASK)}</mj-text><mj-button href="${K.esc(i.pickUrl)}">${K.esc(BUTTON)}</mj-button><mj-text>${K.esc(SIGN_OFF)}</mj-text></mj-column></mj-section>`;
  const html = mjEmail({ subject, preview: ASK, body, unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  const text = K.plainText([lead, "", ASK, `${BUTTON}: ${i.pickUrl}`, "", SIGN_OFF], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  return { subject, html, text };
}
