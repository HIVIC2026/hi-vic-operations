// Decision 106 (Jo 24 Oct 2026): our-lead job offers reach installers by text + email + app. This is the email that
// goes alongside the offer text (decision 50/76 wording, `readyCheckOfferText`): the same facts plus the offer link
// as a button. Pure wording only; never the owner's name, address, phone or any price. Switched on by Jo 24 Oct 2026
// (decision 154): real partners get it through the office partner sender (master switch + partner guards unchanged).
// Design (MJML refresh, Jo 26 Oct 2026): docs/templates/mjml/installer_job-offer.mjml — the ceiling size in a box.
import { mjEmail, esc } from "./mail-mjml.core";
import { plainText } from "./email-kit.core";

export const READY_CHECK_OFFER_EMAIL_APPROVED = true as boolean;
export const READY_CHECK_OFFER_EMAIL_VERSION = "ready-check-offer-email-v1";
export const READY_CHECK_OFFER_EMAIL_EVENT = "ready_check_offer_email";
export const READY_CHECK_OFFER_EMAIL_NOT_SENT_EVENT = "ready_check_offer_email_not_sent";

export const readyCheckOfferSubject = (suburb: string | null) => `New Ready Check job near ${suburb?.trim() || "you"}`;

export function renderReadyCheckOfferEmail(i: { installerFirstName: string | null; suburb: string | null; offerUrl: string; areaM2?: number | null; test?: boolean }) {
  const subject = readyCheckOfferSubject(i.suburb);
  const hi = `Hi ${i.installerFirstName?.trim() || "there"},`;
  const area = typeof i.areaM2 === "number" && i.areaM2 > 0 ? `about ${Math.round(i.areaM2)} m²` : null;
  const take = "To take it, offer the owner 3 times within 24 hours.";
  const preview = `${area ? `About ${Math.round(i.areaM2!)} m². ` : ""}Offer the owner 3 times within 24 hours to take it.`;
  const body = [
    `<mj-section><mj-column><mj-text mj-class="hi">${esc(hi)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${esc(subject)}</mj-text></mj-column></mj-section>`,
    area ? `<mj-section><mj-column mj-class="panel"><mj-text mj-class="eyebrow center" padding="18px 12px 6px">Ceiling size</mj-text><mj-text mj-class="big-blue" padding="0 12px 18px">${esc(area)}</mj-text></mj-column></mj-section>` : "",
    `<mj-section><mj-column><mj-text${area ? ' padding="14px 12px 14px"' : ""}>${esc(take)}</mj-text><mj-button href="${esc(i.offerUrl)}">See the offer</mj-button></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: i.test === true });
  const text = plainText([hi, "", subject, ...(area ? ["", `Ceiling size: ${area}`] : []), "", take, "", `See the offer: ${i.offerUrl}`], { testLabel: i.test === true });
  return { subject, html, text };
}
