// Decision 106 (Jo 24 Oct 2026): our-lead job offers reach installers by text + email + app. This is the email that
// goes alongside the offer text (decision 50/76 wording, `readyCheckOfferText`): the same sentence plus the offer link
// as a button. Pure wording only; never the owner's name, address, phone or any price. Switched on by Jo 24 Oct 2026
// (decision 154): real partners get it through the office partner sender (master switch + partner guards unchanged).
import { simpleEmail } from "./simple-email.core";
import { readyCheckOfferText } from "./ready-check-times.core";

export const READY_CHECK_OFFER_EMAIL_APPROVED = true as boolean;
export const READY_CHECK_OFFER_EMAIL_VERSION = "ready-check-offer-email-v1";
export const READY_CHECK_OFFER_EMAIL_EVENT = "ready_check_offer_email";
export const READY_CHECK_OFFER_EMAIL_NOT_SENT_EVENT = "ready_check_offer_email_not_sent";

export const readyCheckOfferSubject = (suburb: string | null) => `New Ready Check job near ${suburb?.trim() || "you"}`;

export function renderReadyCheckOfferEmail(i: { installerFirstName: string | null; suburb: string | null; offerUrl: string; areaM2?: number | null; test?: boolean }) {
  const mail = simpleEmail(`Hi ${i.installerFirstName?.trim() || "there"},`, [readyCheckOfferText(i.suburb, i.offerUrl, i.areaM2 ?? null)], { label: "See the offer", url: i.offerUrl }, { testLabel: i.test === true });
  return { subject: readyCheckOfferSubject(i.suburb), html: mail.html, text: mail.text };
}
