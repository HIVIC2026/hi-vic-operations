// Jo's approved 6 Nov drafts. Pure rendering only; no sends or switch reads.
import { esc, m2, plainText, whole } from "./email-kit.core";
import { REMOVE_ENQUIRY_TEXT_SLOT } from "./emailsafety.core";
import { formatDueDate } from "./firm-quote.core";
import { includedCardsText, mjHeadline, mjIncludedCards, mjRebateAndPrice, mjExistingInsulation, mjSubSection, mjSmallEnd, O1_INTRO, O2_CLOSING, rebateAndPriceText } from "./jo-outcome-email.core";
import { mjEmail, plusRow } from "./mail-mjml.core";
import { veuBoxMj, veuBoxText } from "./owner-wording.core";

export type FirmQuoteEmail = { subject: string; previewText: string; html: string; plainText: string };
export type PreliminaryEstimateEmailInput = {
  firstName: string; price: number; rebate: number; fullPrice: number; areaM2: number;
  /** Ignored since Jo's 7 Nov email 1: one version for every firm-quote job. Kept so existing callers still type-check. */
  insulation?: "none" | "present" | "unknown"; removalRatePerM2: number; proceedUrl: string;
};
export type FirmQuoteReadyEmailInput = {
  firstName: string; price: number; rebate: number; fullPrice: number; ownerM2: number | null;
  confirmedM2: number; removalM2: number; removalRatePerM2: number; validUntil: string; acceptUrl: string;
};

const sec = (inner: string, cls?: string) => `<mj-section><mj-column${cls ? ` mj-class="${cls}"` : ""}>${inner}</mj-column></mj-section>`;
const SIGN_TEXT = "Cheers, the Home Insulation Victoria team";
const SIGN = mjSmallEnd(SIGN_TEXT);

function finish(subject: string, previewText: string, sections: string[], lines: string[]): FirmQuoteEmail {
  return {
    subject, previewText,
    html: mjEmail({ subject, preview: previewText, unsubscribe: "slot", body: sections.join("\n") }),
    plainText: plainText(lines) + `\nUnsubscribe: ${REMOVE_ENQUIRY_TEXT_SLOT}`,
  };
}

/** Email 1 (Jo, 7 Nov): today's Save my spot "some insulation" (O2) layout with Jo's firm-quote changes, one version for
 *  every firm-quote job whatever the insulation answer. No spot wording, no sign-off (footer as today). */
export const FIRM_EMAIL1_ACTION_TITLE = "Get your firm quote – no home visit needed";
export const FIRM_EMAIL1_ACTION_TEXT = "One of our certified installers will do a desktop assessment using your photos, aerial imagery and floor plan records. We'll email your firm quote within 7 business days. If your photos are unclear or don't show enough of your roof space, our panel of certified installers may not be able to complete the desktop assessment.";
export const FIRM_EMAIL1_EXISTING_HEADING = "If you have existing insulation";
export function preliminaryEstimateEmail(i: PreliminaryEstimateEmailInput): FirmQuoteEmail {
  const price = whole(i.price), rebate = whole(i.rebate);
  const subject = `${i.firstName}, your preliminary estimate: ${price} after a ${rebate} rebate`;
  const preview = `Your price could be ${price} after the government rebate.`;
  const headline = `${i.firstName}, you could save ${rebate} on ceiling insulation`;
  const box = { rebateLabel: "Your estimated rebate", rebate: i.rebate, priceLabel: "Your estimated quote based on what you've told us", price: i.price, fullPrice: i.fullPrice, basis: `Based on what you told us: ${m2(i.areaM2)} ceiling.`, calculatorUrl: null };
  const removalUpTo = i.areaM2 * i.removalRatePerM2;
  const cards = { price: i.price, rebate: i.rebate, someInsulation: true, removalRatePerM2: i.removalRatePerM2 };
  return finish(subject, preview, [
    mjHeadline(headline, O1_INTRO),
    mjRebateAndPrice(box),
    mjExistingInsulation(i.areaM2, i.removalRatePerM2, removalUpTo, FIRM_EMAIL1_EXISTING_HEADING),
    mjSubSection(FIRM_EMAIL1_ACTION_TITLE, FIRM_EMAIL1_ACTION_TEXT, { href: i.proceedUrl, label: "Proceed to firm quote" }),
    mjIncludedCards(cards),
    mjSmallEnd(esc(O2_CLOSING)),
    veuBoxMj(),
  ], [
    headline, "", O1_INTRO, "", ...rebateAndPriceText(box), "",
    FIRM_EMAIL1_EXISTING_HEADING.toUpperCase(), "Good news: it may be able to stay.", "✓ If it can stay: $0. New batts go straight over the top.", `+ If some needs removing: $${i.removalRatePerM2}/m², only the areas that need it. Up to ${whole(removalUpTo)} for your ${m2(i.areaM2)} ceiling.`, "Prices incl. GST. You'll know the exact cost before you agree to anything.", "",
    FIRM_EMAIL1_ACTION_TITLE.toUpperCase(), FIRM_EMAIL1_ACTION_TEXT, `Proceed to firm quote: ${i.proceedUrl}`, "",
    ...includedCardsText(cards), "",
    O2_CLOSING, "", ...veuBoxText(),
  ]);
}

export function firmQuoteOnItsWayEmail(i: { firstName: string; dueDate: string }): FirmQuoteEmail {
  const subject = "Your firm quote is on its way";
  const preview = `Your firm quote will be with you by ${formatDueDate(i.dueDate)}.`;
  const intro = `Your installer is checking your ceiling size and photos now. ${preview} Nothing for you to do in the meantime.`;
  return finish(subject, preview, [mjHeadline(subject, intro), SIGN], [subject, "", intro, "", SIGN_TEXT]);
}

export function firmQuoteReadyEmail(i: FirmQuoteReadyEmailInput): FirmQuoteEmail {
  const subject = `Your firm quote is ready: ${whole(i.price)} after rebate`;
  const preview = `We confirmed your ceiling at ${m2(i.confirmedM2)}.`;
  const headline = `${i.firstName}, your firm quote is ready`;
  const intro = "Your installer has checked your ceiling size and photos.";
  const basis = `${i.ownerM2 === null ? "" : `You told us ${m2(i.ownerM2)}. `}We confirmed ${m2(i.confirmedM2)}.`;
  const box = { rebateLabel: "Your rebate", rebate: i.rebate, priceLabel: "Your firm quote", price: i.price, fullPrice: i.fullPrice, basis, calculatorUrl: null };
  const removalLine = `${m2(i.removalM2)} × $${i.removalRatePerM2} = ${whole(i.removalM2 * i.removalRatePerM2)}`;
  const valid = `Your quote is valid for 30 days, until ${formatDueDate(i.validUntil)}.`;
  return finish(subject, preview, [
    mjHeadline(headline, intro),
    mjRebateAndPrice(box),
    ...(i.removalM2 > 0 ? [sec(`<mj-text mj-class="h2" padding="18px 18px 10px">Your quote includes</mj-text><mj-table padding="0 18px 6px">${plusRow(`<strong>Removal of old insulation</strong><br /><span class="muted">${esc(removalLine)}</span>`)}</mj-table>`, "panel-card")] : []),
    mjSubSection("Ready to go ahead?", valid, { href: i.acceptUrl, label: "Accept my quote" }),
    SIGN,
    veuBoxMj(),
  ], [
    headline, "", intro, "", ...rebateAndPriceText(box), "",
    ...(i.removalM2 > 0 ? ["Your quote includes", `+ Removal of old insulation: ${removalLine}`, ""] : []),
    "Ready to go ahead?", valid, `Accept my quote: ${i.acceptUrl}`, "", SIGN_TEXT, "", ...veuBoxText(),
  ]);
}