/**
 * P1-R3-COM-09 — Read-only personal-estimate route (DEP-1) + Ready Check CTA binding (DEP-2).
 *
 * PURE module: no network, no database, no email. It only:
 *  - builds the two customer URLs from the EXISTING personal-estimate token (no new token semantics, no TTL change),
 *  - assembles the immutable saved-pricing snapshot used by the read-only route and by COM-08 Template 8,
 *  - fails CLOSED (returns null) whenever the saved snapshot is incomplete, so nothing is ever fabricated.
 *
 * The saved estimate is authoritative: it is read from lead_campaign_responses (the frozen Save-My-Spot totals) and the
 * frozen fee settings on indicative_estimates.snapshot. Nothing here recalculates with current pricing, calls the
 * public calculator, creates/updates an estimate, mutates the pricing cohort, or triggers communications.
 */
import type { JoEstimateFigures, SavedPricingSnapshot } from "./jo-email-templates.core";
import { isWellFormedToken, linkUsable } from "./estimatelink.core";

/** Public read-only personal-estimate page (DEP-1). */
export const PERSONAL_ESTIMATE_ROUTE = "/my-estimate";
/** Existing token-bound Step-3 page that hosts the Ready Check acceptance + times picker (DEP-2). */
export const READY_CHECK_ROUTE = "/estimate";

/** DEP-1 URL: the customer's own read-only saved estimate. The token is the only credential. */
export function personalEstimateUrl(token: string): string {
  return `${PERSONAL_ESTIMATE_ROUTE}/${token}`;
}

/**
 * DEP-2 URL: the EXISTING Ready Check booking workflow for this customer. Opening it does NOT book anything — the
 * customer must view the estimate (price-seen gate) and then explicitly accept + pick times. No parallel booking system.
 */
export function readyCheckBookingUrl(token: string): string {
  return `${READY_CHECK_ROUTE}/${token}`;
}

/** The frozen Save-My-Spot totals (authoritative) for one saved spot. */
export type SavedEstimateCore = {
  savedTotal: number | null;
  savedVeuDiscount: number | null;
  savedGrossTotal: number | null;
  savedAreaM2: number | null;
  savedInsulation: string | null;
  /** true when the saved size was an assumption (e.g. 150 m²) rather than a customer-declared size. */
  areaAssumed: boolean;
  savedAt: string;
};

/** Frozen fee settings captured on indicative_estimates.snapshot.settings. Optional — never invented. */
export type SavedFeeSettings = {
  piesa_assessment_inc_gst?: number | null;
  ap_management_inc_gst?: number | null;
  r5_install_inc_gst_per_m2?: number | null;
  indicative_veec_value?: number | null;
} | null | undefined;

/** Reuse the EXISTING link rules (well-formed + active + within the 30-day TTL). Never extends validity. */
export function personalEstimateTokenUsable(
  link: { status: string; expires_at: string } | null | undefined,
  token: unknown,
  now: number = Date.now(),
): boolean {
  if (!isWellFormedToken(token)) return false;
  return linkUsable(link ?? null, now);
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Derive the line-item split from the FROZEN saved gross + frozen fees. Returns null when the frozen fees are
 * unavailable so the caller can fail closed / show a limited view instead of fabricating an installation amount.
 */
function splitFromSavedFees(
  gross: number,
  fees: SavedFeeSettings,
): { piesaFee: number; apFee: number; installation: number } | null {
  const piesa = num(fees?.piesa_assessment_inc_gst);
  const ap = num(fees?.ap_management_inc_gst);
  if (piesa === null || ap === null) return null;
  const installation = gross - piesa - ap;
  if (!Number.isFinite(installation)) return null;
  return { piesaFee: piesa, apFee: ap, installation };
}

/**
 * Read-only personal-estimate view. Returns null (fail closed) when the saved core totals are missing.
 * Optional fee breakdown is only included when the frozen fees are present — never invented.
 */
export function buildPersonalEstimateView(
  core: SavedEstimateCore | null | undefined,
  fees: SavedFeeSettings,
  token: string,
) {
  if (!core) return null;
  const total = num(core.savedTotal);
  const rebate = num(core.savedVeuDiscount);
  const gross = num(core.savedGrossTotal);
  if (total === null || rebate === null || gross === null) return null;
  const split = splitFromSavedFees(gross, fees);
  return {
    // Public whitelist — no internal ids, no other-customer data, nothing editable.
    savedAt: core.savedAt,
    veuRebate: rebate,
    customerTotal: total,
    totalBeforeRebate: gross,
    ceilingAreaM2: num(core.savedAreaM2),
    insulation: core.savedInsulation,
    areaEstimated: !!core.areaAssumed,
    ...(split ? { piesaFee: split.piesaFee, apFee: split.apFee, installation: split.installation } : {}),
    personalEstimateUrl: personalEstimateUrl(token),
    readyCheckBookingUrl: readyCheckBookingUrl(token),
  };
}

/**
 * Template 8 saved-pricing snapshot for the Ready Check invitation email. Returns null (fail closed) unless the
 * FULL saved snapshot — core totals AND frozen fee breakdown AND a readable personal-estimate link — is present.
 * No public-calculator substitute is ever used.
 */
export function buildTemplate8Snapshot(
  core: SavedEstimateCore | null | undefined,
  fees: SavedFeeSettings,
  token: string,
): SavedPricingSnapshot | null {
  if (!core) return null;
  const total = num(core.savedTotal);
  const rebate = num(core.savedVeuDiscount);
  const gross = num(core.savedGrossTotal);
  if (total === null || rebate === null || gross === null) return null;
  const split = splitFromSavedFees(gross, fees);
  if (!split) return null; // incomplete snapshot -> fail closed, do not fabricate
  const areaM2 = num(core.savedAreaM2);
  if (areaM2 === null) return null;
  const figures: JoEstimateFigures = {
    veuRebate: rebate,
    customerTotal: total,
    totalBeforeRebate: gross,
    installation: split.installation,
    piesaFee: split.piesaFee,
    apFee: split.apFee,
    ceilingAreaM2: areaM2,
    areaEstimated: !!core.areaAssumed,
  };
  return Object.freeze({
    ...figures,
    savedAt: core.savedAt,
    personalEstimateUrl: personalEstimateUrl(token),
    readyCheckBookingUrl: readyCheckBookingUrl(token),
  }) as SavedPricingSnapshot;
}
