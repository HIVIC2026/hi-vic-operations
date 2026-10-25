// Decision 326: E1 "New safety check job near you" — the approved electrician offer email
// (docs/templates/approved/electrician/E1-piesa-offer-email.html, drawn from the live TEST sender in jo-tradie.server.ts).
// Pure wording only: suburb, the electrician's OWN agreed rate and the ceiling area — never the owner's name, address,
// phone or price. "The owner has offered three times." is printed only when the owner's times are open on the job.
import { simpleEmail } from "./simple-email.core";
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
  const area = typeof i.areaM2 === "number" && i.areaM2 > 0 ? `About ${Math.round(i.areaM2)} m² of ceiling. ` : "";
  const lines = [
    `Pre Insulation Electrical Safety Assessment (PIESA) — your rate ${rate}.`,
    `${area}${i.ownerTimesOpen ? "The owner has offered three times. " : ""}The first trade to accept gets the job.`,
  ];
  const mail = simpleEmail(`New job in ${suburb}`, lines, { label: "See the job", url: i.offerUrl }, { testLabel: i.test === true });
  return { subject: `New job in ${suburb} — ${rate}`, html: mail.html, text: mail.text };
}
