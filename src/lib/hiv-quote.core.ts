// Pure pricing for NEW installation quotes on Home Insulation Victoria-generated jobs (Jo, 4 Oct 2026).
// Owner prices are fixed for every installer (the same owner prices as the estimate). Our installer
// markup = owner price − that installer's agreed rate, both inc GST. PIESA and the AP fee are two
// separate $349 lines. Installer-supplied jobs never use this (no installer markup there).
export const HIV_PRICING_RULE = "hiv_fixed_owner_price_v1";
const r2 = (n: number) => Math.round(n * 100) / 100;
import { productQuoteDescription, type ProductRValue, type UsualProduct } from "./usual-product.core";

/** Jo 22 Oct 2026: owner R6.0/R7.0 prices inc GST per m². R5.0 stays the office-set owner price ($30). */
export const OWNER_HIGHER_R_INC_PER_M2: Record<Exclude<ProductRValue, "R5.0">, number> = { "R6.0": 32, "R7.0": 33 };
export const R_VALUE_CODE: Record<ProductRValue, string> = { "R5.0": "R5_BATTS", "R6.0": "R6_BATTS", "R7.0": "R7_BATTS" };
export const ownerRateForR = (r: ProductRValue, ownerR5IncPerM2: number) => (r === "R5.0" ? ownerR5IncPerM2 : OWNER_HIGHER_R_INC_PER_M2[r]);
export const rateAboveOwnerReason = (r: ProductRValue) => `This installer's agreed ${r} rate is above the owner price – office review needed.`;

export type HivQuoteInput = {
  areaM2: number;
  removalM2: number;
  accessMultiplier: number; // owner access loading, as on the estimate (1 / 1.1 / 1.25)
  ownerR5IncPerM2: number; // $30
  ownerRemovalIncPerM2: number; // $15
  piesaIncGst: number; // $349
  apFeeIncGst: number; // $349
  gstRate: number; // 0.1
  installerR5ExPerM2: number | null; // agreed rate card (stored ex GST)
  installerRemovalExPerM2: number | null;
  installerTravelEx: number | null; // installer cost with no owner line (reduces our markup)
  /** Chosen R-value (installer's form or usual product). Absent = R5.0, as before. */
  rValue?: ProductRValue;
  /** Agreed installer rate (ex GST) for rValue; required when rValue is R6.0/R7.0. */
  installerRExPerM2?: number | null;
  product?: UsualProduct | null;
};

export type HivLine = { code: string; description: string; quantity: number; unit: string; unit_price_inc_gst: number; line_total_inc_gst: number; is_other: false; explanation: null; sort: number };

export function priceHivQuote(i: HivQuoteInput) {
  const gst = 1 + i.gstRate;
  if (!(i.areaM2 > 0)) throw new Error("No measured area to quote.");
  const rv: ProductRValue = i.rValue ?? "R5.0";
  const instRateEx = rv === "R5.0" ? i.installerR5ExPerM2 : i.installerRExPerM2 ?? null;
  if (instRateEx == null) throw new Error(`This installer has no agreed ${rv} rate – office must add it before quoting.`);
  if (i.removalM2 > 0 && i.installerRemovalExPerM2 == null) throw new Error("This installer has no agreed removal rate – office must add it before quoting.");
  const ownerR5 = r2(ownerRateForR(rv, i.ownerR5IncPerM2) * i.accessMultiplier);
  const instR5Inc = r2(instRateEx * gst);
  const instRemInc = i.removalM2 > 0 ? r2(i.installerRemovalExPerM2! * gst) : 0;
  // Jo 22 Oct 2026: agreed rate above the owner price → quote is still prepared but HELD for office review.
  const holdReasons = instR5Inc > ownerR5 ? [rateAboveOwnerReason(rv)] : [];
  if (i.removalM2 > 0 && instRemInc > i.ownerRemovalIncPerM2) throw new Error("This installer's agreed removal rate is above the owner price – office review needed.");

  const lines: HivLine[] = [];
  const add = (code: string, description: string, quantity: number, unit: string, unitInc: number) =>
    lines.push({ code, description, quantity, unit, unit_price_inc_gst: r2(unitInc), line_total_inc_gst: r2(unitInc * quantity), is_other: false, explanation: null, sort: lines.length });
  add(R_VALUE_CODE[rv], i.product ? productQuoteDescription(i.product, null) : `${rv} ceiling insulation supply & install`, i.areaM2, "m2", ownerR5);
  if (i.removalM2 > 0) add("REMOVAL", "Removal & disposal of existing insulation", i.removalM2, "m2", i.ownerRemovalIncPerM2);
  add("PIESA", "Mandatory Pre Insulation Electrical Safety Assessment (PIESA)", 1, "flat", i.piesaIncGst);
  add("AP_FEE", "Accredited Provider fee (Home Insulation Victoria)", 1, "flat", i.apFeeIncGst);

  const r5MarkupInc = r2((ownerR5 - instR5Inc) * i.areaM2);
  const removalMarkupInc = r2((i.ownerRemovalIncPerM2 - instRemInc) * i.removalM2);
  const travelInc = r2((i.installerTravelEx ?? 0) * gst);
  const markupInc = r2(r5MarkupInc + removalMarkupInc - travelInc);
  const installerCostEx = r2(instRateEx * i.areaM2 + (i.removalM2 > 0 ? i.installerRemovalExPerM2! * i.removalM2 : 0) + (i.installerTravelEx ?? 0));
  return {
    lines, rValue: rv, holdReasons,
    installerMarkup: { r5MarkupInc, removalMarkupInc, travelInc, markupInc, markupEx: r2(markupInc / gst), ownerR5IncPerM2: ownerR5, installerR5IncPerM2: instR5Inc, installerRemovalIncPerM2: instRemInc },
    installerCostEx,
  };
}
