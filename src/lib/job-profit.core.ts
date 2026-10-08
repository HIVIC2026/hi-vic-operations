// Per-job profit breakdown (office only; never shown to owners or trades). Pure; Jo's rules 4 Oct 2026.
// AP fee; VEEC spread = VEECs × (sale price − $70); PIESA markup = $349 − electrician's agreed rate;
// installer markup = (owner price − installer's agreed rate) × m², HIV jobs only. Amounts inc GST
// unless stated; ex GST = inc ÷ 1.1. VEEC spread is shown without GST (certificate sale, not an owner charge).
import { ghgEquivalentReduction, lookupLocation } from "./activity48.core";

export const VEEC_BOUGHT_PRICE = 70;
const r2 = (n: number) => Math.round(n * 100) / 100;

export type ProfitSide = {
  areaM2: number | null; areaBasis: "estimate" | "measured" | "none";
  veecs: number | null; veecPrice: number; veecPriceBasis: "current setting" | "actual sale";
  apFeeInc: number; piesaMarkupInc: number | null; installerMarkupInc: number | null;
  veecSpread: number | null; totalInc: number | null; totalEx: number | null; notes: string[];
};

export type ProfitInput = {
  hivJob: boolean;
  postcode: string | null;
  estimateAreaM2: number | null;
  measuredAreaM2: number | null; // set only once the Ready Check/measure-up is accepted
  removalM2: number;
  accessMultiplier: number;
  ownerR5IncPerM2: number; ownerRemovalIncPerM2: number;
  installerR5IncPerM2: number | null; installerRemovalIncPerM2: number | null;
  apFeeInc: number; piesaCustomerInc: number; electricianPiesaRateInc: number | null;
  /** Installer's own electrician invoices the owner directly: no HIV PIESA revenue, cost or markup. */
  piesaOwnerDirect?: boolean;
  currentVeecPrice: number;
  veecBuyPrice?: number; // office setting, default $70
  // actuals
  acceptedQuoteMarkupInc: number | null; acceptedQuoteLegacy: boolean;
  lodgedVeecs: number | null; saleVeecPrice: number | null;
};

export function veecCount(areaM2: number | null, postcode: string | null): number | null {
  const loc = lookupLocation(postcode);
  if (!areaM2 || !loc) return null;
  return Math.floor(ghgEquivalentReduction(areaM2, loc).ghgReduction);
}

function side(i: ProfitInput, actual: boolean): ProfitSide {
  const notes: string[] = [];
  const areaM2 = i.measuredAreaM2 ?? i.estimateAreaM2;
  const areaBasis = i.measuredAreaM2 != null ? "measured" : i.estimateAreaM2 != null ? "estimate" : "none";
  let veecs = veecCount(areaM2, i.postcode);
  if (veecs == null) notes.push(areaM2 ? "Postcode not in the official table – VEECs not worked out." : "No area yet – VEECs not worked out.");
  if (actual && i.lodgedVeecs != null) veecs = i.lodgedVeecs;
  const sold = actual && i.saleVeecPrice != null;
  const veecPrice = sold ? i.saleVeecPrice! : i.currentVeecPrice;
  const veecSpread = veecs == null ? null : r2(veecs * (veecPrice - (i.veecBuyPrice ?? VEEC_BOUGHT_PRICE)));
  const piesaMarkupInc = i.piesaOwnerDirect ? 0 : i.electricianPiesaRateInc == null ? null : r2(i.piesaCustomerInc - i.electricianPiesaRateInc);
  if (i.piesaOwnerDirect) notes.push("Electrician invoices the owner directly – no PIESA revenue or cost for Home Insulation Victoria.");
  else if (piesaMarkupInc == null) notes.push("Electrician PIESA rate to be confirmed.");
  let installerMarkupInc: number | null = 0;
  if (i.hivJob) {
    if (actual && i.acceptedQuoteMarkupInc != null) {
      installerMarkupInc = i.acceptedQuoteMarkupInc;
      if (i.acceptedQuoteLegacy) notes.push("Accepted quote used the old pricing (12% markup).");
    } else if (i.installerR5IncPerM2 == null || !areaM2) { installerMarkupInc = null; notes.push("Installer agreed rate or area missing – installer markup not worked out."); }
    else installerMarkupInc = r2((i.ownerR5IncPerM2 * i.accessMultiplier - i.installerR5IncPerM2) * areaM2 + (i.removalM2 > 0 && i.installerRemovalIncPerM2 != null ? (i.ownerRemovalIncPerM2 - i.installerRemovalIncPerM2) * i.removalM2 : 0));
  }
  const parts = [i.apFeeInc, piesaMarkupInc, installerMarkupInc];
  const known = parts.every((p) => p != null) && veecSpread != null;
  const feesInc = r2((i.apFeeInc) + (piesaMarkupInc ?? 0) + (installerMarkupInc ?? 0));
  return {
    areaM2, areaBasis, veecs, veecPrice, veecPriceBasis: sold ? "actual sale" : "current setting",
    apFeeInc: i.apFeeInc, piesaMarkupInc, installerMarkupInc, veecSpread,
    totalInc: known ? r2(feesInc + veecSpread!) : null, totalEx: known ? r2(feesInc / 1.1 + veecSpread!) : null, notes,
  };
}

export function jobProfitBreakdown(i: ProfitInput) {
  return { expected: side(i, false), actual: side(i, true) };
}
