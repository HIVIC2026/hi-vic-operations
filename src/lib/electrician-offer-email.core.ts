// Decision 326: E1 "New safety check job near you" — the approved electrician offer email
// (MJML refresh, Jo 26 Oct 2026: docs/templates/mjml/electrician_E1.mjml — the rate in a box).
// Pure wording only: suburb, the electrician's OWN agreed rate and the ceiling area — never the owner's name, address,
// phone or price. "The owner has offered three times." is printed only when the owner's times are open on the job.
import { mjEmail, esc } from "./mail-mjml.core";
import { plainText } from "./email-kit.core";
import { wholeDollars } from "./approved-texts.core";

export const ELECTRICIAN_OFFER_EMAIL_APPROVED = true as boolean;
export const ELECTRICIAN_OFFER_EMAIL_VERSION = "electrician-offer-email-e1-v1";
/** One per offer, recorded BEFORE sending. */
export const ELECTRICIAN_OFFER_EMAIL_EVENT = "electrician_offer_email";

export type ElectricianOfferEmailInput = { suburb: string | null; rate: number | null; areaM2: number | null; ownerTimesOpen: boolean; offerUrl: string; test?: boolean };

/** Null when a fact the approved wording needs (suburb, rate) is missing — the email is then not sent. */
export function renderElectricianOfferEmail(i: ElectricianOfferEmailInput): { subject: string; html: string; text: string } | null {
  const suburb = i.suburb?.trim() || null, rate = wholeDollars(i.rate);
  if (!suburb || !rate) return null;
  const subject = `New job in ${suburb} — ${rate}`;
  const headline = `New job in ${suburb}`;
  const area = typeof i.areaM2 === "number" && i.areaM2 > 0 ? `About ${Math.round(i.areaM2)} m² of ceiling.` : null;
  const what = `Pre Insulation Electrical Safety Assessment (PIESA).${area ? ` ${area}` : ""}`;
  const times = i.ownerTimesOpen ? "The owner has offered three times." : null;
  const first = "The first trade to accept gets the job.";
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(headline)}</mj-text><mj-text>${esc(what)}</mj-text>${times ? `<mj-text>${esc(times)}</mj-text>` : ""}</mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel"><mj-text mj-class="eyebrow center" padding="18px 12px 6px">Your rate</mj-text><mj-text mj-class="big-blue" padding="0 12px 18px">${esc(rate)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text padding="14px 12px 14px" font-weight="700">${esc(first)}</mj-text><mj-button href="${esc(i.offerUrl)}">See the job</mj-button></mj-column></mj-section>`,
  ].join("");
  const preview = [area, times, first].filter(Boolean).join(" ");
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: i.test === true });
  const text = plainText([headline, "", what, ...(times ? [times] : []), "", `Your rate: ${rate}`, "", first, "", `See the job: ${i.offerUrl}`], { testLabel: i.test === true });
  return { subject, html, text };
}
