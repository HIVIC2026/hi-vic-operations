// Jo's approved 6 Nov drafts. Pure rendering only; no sends or switch reads.
import { esc, m2, plainText, whole } from "./email-kit.core";
import { REMOVE_ENQUIRY_TEXT_SLOT } from "./emailsafety.core";
import { formatDueDate } from "./firm-quote.core";
import { mjHeadline, mjRebateAndPrice, mjExistingInsulation, mjSubSection, mjSmallEnd, rebateAndPriceText } from "./jo-outcome-email.core";
import { mjEmail, plusRow } from "./mail-mjml.core";
import { veuBoxMj, veuBoxText } from "./owner-wording.core";

export type FirmQuoteEmail = { subject: string; previewText: string; html: string; plainText: string };
export type PreliminaryEstimateEmailInput = {
  firstName: string; price: number; rebate: number; fullPrice: number; areaM2: number;
  insulation: "none" | "present" | "unknown"; removalRatePerM2: number; proceedUrl: string;
};
export type FirmQuoteReadyEmailInput = {
  firstName: string; price: number; rebate: number; fullPrice: number; ownerM2: number | null;
  confirmedM2: number; removalM2: number; removalRatePerM2: number; validUntil: string; acceptUrl: string;
};

const sec = (inner: string, cls?: string) => `<mj-section><mj-column${cls ? ` mj-class="${cls}"` : ""}>${inner}</mj-column></mj-section>`;
const SIGN_TEXT = "Cheers, the Home Insulation Victoria team";
const SIGN = mjSmallEnd(SIGN_TEXT);
const WHY_LINES = [
  "Your ceiling size is different from your estimate",
  "Old insulation needs removing",
  "The roof space is hard to get to",
  "Electrical work, if needed, is quoted separately",
];
const why = sec(`<mj-text mj-class="h2" padding="18px 18px 10px">Why the price might change</mj-text><mj-table padding="0 18px 6px">${WHY_LINES.map(plusRow).join("")}</mj-table>`, "panel-card");

function finish(subject: string, previewText: string, sections: string[], lines: string[]): FirmQuoteEmail {
  return {
    subject, previewText,
    html: mjEmail({ subject, preview: previewText, unsubscribe: "slot", body: sections.join("\n") }),
    plainText: plainText(lines) + `\nUnsubscribe: ${REMOVE_ENQUIRY_TEXT_SLOT}`,
  };
}

export function preliminaryEstimateEmail(i: PreliminaryEstimateEmailInput): FirmQuoteEmail {
  const subject = `${i.firstName}, your preliminary estimate: ${whole(i.price)} after a ${whole(i.rebate)} rebate`;
  const preview = "Happy with it? Press Proceed to firm quote.";
  const headline = `${i.firstName}, your preliminary estimate is ready`;
  const intro = "Thanks for sending your photos. Here's your preliminary estimate, based on what you told us.";
  const box = { rebateLabel: "Your estimated rebate", rebate: i.rebate, priceLabel: "Your preliminary estimate", price: i.price, fullPrice: i.fullPrice, basis: `Based on your ${m2(i.areaM2)} ceiling estimate`, calculatorUrl: null };
  const removal = i.insulation === "present" || i.insulation === "unknown";
  const removalUpTo = i.areaM2 * i.removalRatePerM2;
  const happy = "Press the button and we'll get your firm quote started.";
  const next = "One of our certified installers does a desktop assessment, checking your ceiling size using aerial imagery, floor plan records and your photos. We email your firm quote within 7 business days.";
  const nothingLocked = "Nothing is locked in until you accept your firm quote.";
  return finish(subject, preview, [
    mjHeadline(headline, intro),
    mjRebateAndPrice(box),
    ...(removal ? [mjExistingInsulation(i.areaM2, i.removalRatePerM2, removalUpTo)] : []),
    mjSubSection("Happy with it?", happy, { href: i.proceedUrl, label: "Proceed to firm quote" }),
    mjSubSection("What happens next", next),
    why,
    mjSmallEnd(nothingLocked),
    SIGN,
    veuBoxMj(),
  ], [
    headline, "", intro, "", ...rebateAndPriceText(box), "",
    ...(removal ? ["YOUR EXISTING INSULATION", "Good news: it may be able to stay.", "✓ If it can stay: $0. New batts go straight over the top.", `+ If some needs removing: $${i.removalRatePerM2}/m², only the areas that need it. Up to ${whole(removalUpTo)} for your ${m2(i.areaM2)} ceiling.`, "Prices incl. GST. You'll know the exact cost before you agree to anything.", ""] : []),
    "Happy with it?", happy, `Proceed to firm quote: ${i.proceedUrl}`, "",
    "What happens next", next, "", "Why the price might change", ...WHY_LINES.map(line => `+ ${line}`), "",
    nothingLocked, "", SIGN_TEXT, "", ...veuBoxText(),
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