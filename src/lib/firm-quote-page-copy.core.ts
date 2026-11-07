import { AP_NUMBER, m2, whole } from "./email-kit.core";

// Jo-approved (7 Nov 2026) wording for the page shown after "Proceed to firm quote". PURE.
export const FIRM_PAGE_COPY = {
  thanks: (first: string | null) => `Thanks${first ? `, ${first}` : ""}. We're on it.`,
  assessment: "One of our certified installers will now do a desktop assessment using your photos, aerial imagery and floor plan records.",
  emailBy: "We'll email your firm quote by",
  nothingLocked: "Nothing is locked in until you accept your firm quote.",
  footer: `Home Insulation Victoria · VEU Accredited Person ${AP_NUMBER}`,
} as const;

/** Jo 7 Nov (3a): the estimate link after Proceed shows the rebate box with email 1's approved words (no new wording). */
export function firmEstimateBox(i: { rebate: number; price: number; fullPrice: number; areaM2: number }) {
  return {
    rebateLabel: "Your estimated rebate", rebate: `You save ${whole(i.rebate)}`,
    priceLabel: "Your estimated quote based on what you've told us", price: whole(i.price),
    fullPrice: `incl. GST · full price ${whole(i.fullPrice)}`, basis: `Based on what you told us: ${m2(i.areaM2)} ceiling.`,
  };
}
