import { READY_CHECK_FEE_LOCKED_FREE, effectiveReadyCheckFee } from "./readycheck.core";
// Versioned customer pricing cohorts (Jo, 12 Oct 2026). Pure — no network, no database.
//
// Rule: before the cutover is activated, everyone keeps the current (legacy) owner prices and a free Ready Check.
// After the cutover, a job that saved its spot before the cutover keeps its frozen snapshot (original rates,
// free Ready Check, original saved totals). Every other job uses the new version. A job that has saved its spot but
// has no readable snapshot FAILS CLOSED — the new price is never assumed for a possibly-protected customer.

export type PricingRates = {
  settingsId: string | null;
  settingsVersion: number;
  r5InstallIncGstPerM2: number;
  removalIncGstPerM2: number;
  piesaIncGst: number;
  apIncGst: number;
  readyCheckFeeIncGst: number;
};

/** Frozen per-job snapshot written once by the cutover (or at save time after the cutover). Never edited. */
export type CohortSnapshot = PricingRates & {
  cohort: "legacy_saved_spot" | "current";
  spotSavedAt: string | null;
  savedTotal: number | null; savedGrossTotal: number | null; savedVeuDiscount: number | null; savedAreaM2: number | null;
};

export type Cutover = { cutoverAt: string; newSettings: PricingRates } | null;

export type CohortFacts = {
  /** null = unreadable/unknown → fail closed. */
  spotSavedAt: string | null | undefined;
  snapshot: CohortSnapshot | null | undefined;
};

export type ResolvedPricing = PricingRates & { cohort: "pre_cutover" | "legacy_saved_spot" | "current"; savedTotalsAuthoritative: boolean };

export class PricingCohortUnknownError extends Error {
  constructor(msg = "This customer's price version cannot be confirmed, so no price is shown. Office review required.") { super(msg); this.name = "PricingCohortUnknownError"; }
}

export { READY_CHECK_FEE_LOCKED_FREE, effectiveReadyCheckFee };
const free = <T extends PricingRates>(r: T): T => ({ ...r, readyCheckFeeIncGst: effectiveReadyCheckFee(r.readyCheckFeeIncGst) });

const fin = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
function assertRates(r: PricingRates): PricingRates {
  if (![r.r5InstallIncGstPerM2, r.removalIncGstPerM2, r.piesaIncGst, r.apIncGst, r.readyCheckFeeIncGst].every(fin)) throw new PricingCohortUnknownError("Price version is incomplete. Office review required.");
  return r;
}

/**
 * The one pricing decision. `legacyCurrent` is the pre-cutover current settings row (Ready Check fee 0).
 * Unknown facts (undefined) fail closed whenever a cutover exists.
 */
export function resolveCustomerPricing(facts: CohortFacts | null | undefined, legacyCurrent: PricingRates | null, cutover: Cutover): ResolvedPricing {
  if (!cutover) {
    if (!legacyCurrent) throw new PricingCohortUnknownError("Owner prices are not set.");
    // Pre-cutover: unchanged behaviour. Ready Check stays free whatever the row says.
    return { ...assertRates({ ...legacyCurrent, readyCheckFeeIncGst: 0 }), cohort: "pre_cutover", savedTotalsAuthoritative: !!facts?.spotSavedAt };
  }
  if (!facts || facts.spotSavedAt === undefined || facts.snapshot === undefined) throw new PricingCohortUnknownError();
  if (facts.snapshot) {
    return { ...assertRates(free(facts.snapshot)), cohort: facts.snapshot.cohort, savedTotalsAuthoritative: facts.snapshot.cohort === "legacy_saved_spot" };
  }
  if (facts.spotSavedAt) {
    // Saved before the cutover with no snapshot = cutover sweep missed it → never charge new prices.
    if (Date.parse(facts.spotSavedAt) < Date.parse(cutover.cutoverAt) || Number.isNaN(Date.parse(facts.spotSavedAt))) throw new PricingCohortUnknownError();
    // Saved after cutover but no snapshot row (save trigger must create one) → still fail closed.
    throw new PricingCohortUnknownError();
  }
  return { ...assertRates(free(cutover.newSettings)), cohort: "current", savedTotalsAuthoritative: false };
}

const money = (n: number) => `$${Number.isInteger(n) ? n.toLocaleString("en-AU") : n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Customer wording for the Ready Check fee. Protected/legacy customers keep "free". */
export function readyCheckFeeLabel(p: Pick<PricingRates, "readyCheckFeeIncGst">): string {
  const fee = effectiveReadyCheckFee(p.readyCheckFeeIncGst);
  return fee > 0 ? `${money(fee)} including GST` : "free";
}

/** Supply/install wording. New cohort shows ex and inc GST; legacy shows its original inc-GST rate only. */
export function installRateLabel(p: Pick<ResolvedPricing, "r5InstallIncGstPerM2" | "cohort">): string {
  const inc = p.r5InstallIncGstPerM2;
  if (p.cohort === "current") return `${money(r2(inc / 1.1))} per m² plus GST (${money(inc)} per m² including GST)`;
  return `${money(inc)} per m² including GST`;
}

export type Breakdown = { installation: number; removal: number; piesa: number; ap: number; readyCheck: number; extras: number; gross: number; rebate: number; total: number; payableNow: number; remaining: number };

/**
 * Customer breakdown, all GST-inclusive. Ready Check fee appears ONCE in gross; the remaining balance subtracts it
 * once (it is collected separately), so invoices for the remaining balance never include it again.
 * Removal is charged only on the area that needs removal. Rebate is supplied (unchanged calculation upstream).
 */
export function customerBreakdown(rates: PricingRates, areaM2: number, removalM2: number, rebate: number, extras = 0): Breakdown {
  if (!(areaM2 > 0) || !(removalM2 >= 0) || removalM2 > areaM2 || !(rebate >= 0) || !(extras >= 0)) throw new Error("Invalid breakdown inputs.");
  const p = free(rates);
  const installation = r2(areaM2 * p.r5InstallIncGstPerM2);
  const removal = r2(removalM2 * p.removalIncGstPerM2);
  const gross = r2(installation + removal + p.piesaIncGst + p.apIncGst + p.readyCheckFeeIncGst + extras);
  const total = r2(gross - Math.min(rebate, gross));
  const payableNow = p.readyCheckFeeIncGst;
  return { installation, removal, piesa: p.piesaIncGst, ap: p.apIncGst, readyCheck: p.readyCheckFeeIncGst, extras, gross, rebate: r2(Math.min(rebate, gross)), total, payableNow, remaining: r2(Math.max(0, total - payableNow)) };
}

/** Protected customers: the original saved totals are authoritative; a re-render must reproduce them, never a recalculation. */
export function protectedSavedTotals(s: CohortSnapshot): { total: number; gross: number; rebate: number; areaM2: number } {
  if (s.cohort !== "legacy_saved_spot" || !fin(s.savedTotal) || !fin(s.savedGrossTotal) || !fin(s.savedVeuDiscount) || !(Number(s.savedAreaM2) > 0)) throw new PricingCohortUnknownError("Original saved price is incomplete. Office review required.");
  return { total: s.savedTotal!, gross: s.savedGrossTotal!, rebate: s.savedVeuDiscount!, areaM2: s.savedAreaM2! };
}

/** Measured area differs from the saved area: original rates still apply; the difference is shown explicitly for approval. */
export function scopeDifference(s: CohortSnapshot, measuredAreaM2: number): { changed: boolean; deltaM2: number; deltaInstallIncGst: number; needsApproval: boolean } {
  const saved = protectedSavedTotals(s).areaM2;
  const deltaM2 = r2(measuredAreaM2 - saved);
  const deltaInstallIncGst = r2(deltaM2 * s.r5InstallIncGstPerM2);
  return { changed: deltaM2 !== 0, deltaM2, deltaInstallIncGst, needsApproval: deltaM2 !== 0 };
}

/** Binding quotes (issued/accepted) are never repriced by a new version. */
export function mayReprice(quoteStatus: string): boolean {
  return !["issued", "accepted"].includes(quoteStatus);
}

// ---------------- Calculators (public + owner-specific) ----------------

/** Jo, 12 Oct 2026 — exact wording, shown directly under the existing-insulation answer whenever "Some there" is chosen. */
export const REMOVAL_BUDGET_NOTE = "Existing insulation may need to be removed. Please budget an additional $15 per m², including GST, only for the areas that require removal. We’ll confirm the area and cost at your Ready Check.";
export const showRemovalBudgetNote = (insulation: string | null | undefined) => insulation === "present";

/**
 * Which price version the anonymous public calculator shows. It has no job, so it cannot hold a protected customer.
 * Flip to "new" ONLY in the same release as activate_pricing_cutover (activation step, not before).
 */
export const PUBLIC_CALCULATOR_PRICING: "legacy" | "new" = "legacy";
export function publicCalculatorPricing(v: "legacy" | "new" = PUBLIC_CALCULATOR_PRICING): { r5InstallIncGstPerM2: number; readyCheckFeeIncGst: number; cohort: "pre_cutover" | "current" } {
  return v === "new" ? { r5InstallIncGstPerM2: 33, readyCheckFeeIncGst: 0, cohort: "current" } : { r5InstallIncGstPerM2: 30, readyCheckFeeIncGst: 0, cohort: "pre_cutover" };
}

/**
 * Calculator totals: the install-only scenario (never whole-ceiling removal) plus the Ready Check fee ONCE.
 * Removal stays excluded unless an explicit itemised amount is supplied, and is then added once.
 */
export function calculatorTotals(standard: { pre_discount_total: number; estimated_customer_total: number; applied_discount: number }, readyCheckFeeIncGst: number, itemisedRemovalIncGst = 0) {
  if (!(readyCheckFeeIncGst >= 0) || !(itemisedRemovalIncGst >= 0)) throw new Error("Invalid calculator extras.");
  readyCheckFeeIncGst = effectiveReadyCheckFee(readyCheckFeeIncGst);
  const extra = r2(readyCheckFeeIncGst + itemisedRemovalIncGst);
  return { gross: r2(standard.pre_discount_total + extra), total: r2(standard.estimated_customer_total + extra), rebate: standard.applied_discount, readyCheck: readyCheckFeeIncGst, removal: itemisedRemovalIncGst };
}

/** Saved-spot price from a calculator/estimate: adds the cohort's Ready Check fee once. Fee 0 (legacy/protected) returns it unchanged. */
export function withReadyCheckFee<T extends { total: number; gross: number }>(price: T | null, readyCheckFeeIncGst: number): T | null {
  readyCheckFeeIncGst = effectiveReadyCheckFee(readyCheckFeeIncGst);
  if (!price || readyCheckFeeIncGst === 0) return price;
  return { ...price, total: r2(price.total + readyCheckFeeIncGst), gross: r2(price.gross + readyCheckFeeIncGst) };
}
