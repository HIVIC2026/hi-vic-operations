// Step 3 – indicative customer price + Activity 48 VEU savings estimate. Pure.
// Customer retail prices come ONLY from retail_estimator_settings (user-approved, inc GST).
// Never derived from supplier/trade cost, legacy flat per-m² VEEC credit or AP margin settings.
import { ghgEquivalentReduction, type LocationVariables } from "./activity48.core";

export type RetailSettings = {
  id: string; version: number;
  r5_install_inc_gst_per_m2: number; removal_inc_gst_per_m2: number;
  piesa_assessment_inc_gst: number; ap_management_inc_gst: number;
  access_standard_multiplier: number; access_moderate_multiplier: number; access_difficult_multiplier: number;
  indicative_veec_value: number; veec_value_source_label: string; veec_value_source_url: string; veec_value_checked_at: string;
  minimum_customer_copayment_inc_gst: number; spec_version: string; spec_source_url: string;
  /** DEPRECATED (Jo, 5 Oct 2026): no maximum discount exists in the VEU program; columns kept, never applied. */
  max_discount_metro_inc_gst?: number; max_discount_regional_inc_gst?: number;
};

/** VEU program minimum customer contribution (inc GST) after the discount — official rule, never waived. */
export const MIN_CUSTOMER_CONTRIBUTION_INC_GST = 200;

export type DiscountRulesResult = { discount: number; cappedAtMax: boolean; reducedForMin: boolean; cap: number };
/**
 * The one discount guardrail (Jo, 5 Oct 2026, from the VEU Industry Pack): the customer always pays at least the
 * $200 inc GST minimum contribution; the discount is reduced if needed. There is NO maximum discount or VEEC cap
 * (the $1,500 / $2,100 figures are only the Government's 150 m² example). `metropolitan` is kept for call-site
 * compatibility and ignored; `cappedAtMax` is always false.
 */
export function applyDiscountRules(rawDiscount: number, preDiscountTotal: number, _metropolitan: boolean | null, s: Pick<RetailSettings, "minimum_customer_copayment_inc_gst">): DiscountRulesResult {
  const floor = Number(s.minimum_customer_copayment_inc_gst);
  const raw = Math.max(0, rawDiscount);
  const discount = Math.min(raw, Math.max(0, preDiscountTotal - floor));
  return { discount, cappedAtMax: false, reducedForMin: discount < raw, cap: Infinity };
}

/** Plain-English quote/invoice line when the $200 minimum reduced the discount (Jo-approved wording, 5 Oct 2026). */
export const DISCOUNT_REDUCED_MIN_NOTE = "Discount reduced so the minimum $200 customer contribution applies";
export function discountNotes(r: Pick<DiscountRulesResult, "cappedAtMax" | "reducedForMin">): string[] {
  const notes: string[] = [];
  if (r.reducedForMin) notes.push(DISCOUNT_REDUCED_MIN_NOTE);
  return notes;
}

/** The one VEU discount basis everywhere (calculator, office quotes, installer drafts, bulk import): whole VEECs (Eq 48.1 rounded down) × consumer $/VEEC, before the $200 minimum rule. */
export function wholeVeecDiscount(areaM2: number, loc: Pick<LocationVariables, "metropolitan_or_regional" | "climate_region">, veecValue: number) {
  const veecs = Math.floor(ghgEquivalentReduction(areaM2, loc).ghgReduction);
  return { veecs, unitValue: Number(veecValue), raw: Math.round(veecs * Number(veecValue) * 100) / 100 };
}
export const veecDiscountLabel = (veecs: number, unitValue: number) => `VEU discount, ${veecs} VEECs × $${Number(unitValue).toLocaleString("en-AU")}`;

export type Access = "standard" | "moderate" | "difficult";
export const ACCESS_LEVELS: Access[] = ["standard", "moderate", "difficult"];

export type AreaCandidate = { m2: number; source: "accepted_measurement" | "area_estimate" | "owner_estimate" | "typical_default"; basis: string; id: string | null; label: string };
/** Typical Victorian home ceiling size used only when nothing better is known, so every customer always sees an estimated ceiling size. Matches the Government's published 150 m² benchmark example. */
export const DEFAULT_ESTIMATED_AREA_M2 = 150;
/** Strongest preliminary area: accepted current measurement > job (owner) estimate > trusted area estimate > typical-home default (clearly labelled, never presented as measured). */
export function pickArea(c: { measurement?: { id: string; m2: number | null; label?: string } | null; estimate?: { id: string; m2: number | null; tier: string } | null; owner?: number | null }): AreaCandidate {
  const ok = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
  if (c.measurement && ok(c.measurement.m2)) return { m2: c.measurement.m2, source: "accepted_measurement", basis: "measured", id: c.measurement.id, label: c.measurement.label ?? "Accepted ceiling measure-up" };
  // Owner-supplied size beats any research area for the preliminary enquiry quote (Jo, 19 Oct 2026).
  if (ok(c.owner)) return { m2: c.owner, source: "owner_estimate", basis: "declared", id: null, label: "Your estimate" };
  if (c.estimate && ok(c.estimate.m2)) return { m2: c.estimate.m2, source: "area_estimate", basis: `researched (tier ${c.estimate.tier})`, id: c.estimate.id, label: `Property research estimate (tier ${c.estimate.tier})` };
  return { m2: DEFAULT_ESTIMATED_AREA_M2, source: "typical_default", basis: "typical default", id: null, label: `Typical Victorian home estimate (${DEFAULT_ESTIMATED_AREA_M2} m²)` };
}
/** Tiers trusted for Step 3 pricing. Tier E (aerial/Solar ground footprint) and F are excluded – footprint is not ceiling area. */
export const TRUSTED_ESTIMATE_TIERS = ["A", "B", "C", "D"];

export type Gate1View = { outcome: string | null; reviewRequired: boolean; recorded: boolean };
export type DisplayMode = "likely" | "onsite" | "withheld_review" | "none_ineligible" | "withheld_undecided";
export function displayModeFor(g: Gate1View): DisplayMode {
  if (!g.recorded) return "withheld_undecided";
  if (g.reviewRequired) return "withheld_review";
  if (g.outcome === "likely_eligible") return "likely";
  if (g.outcome === "needs_onsite_confirmation") return "onsite";
  if (g.outcome === "does_not_appear_eligible") return "none_ineligible";
  return "withheld_undecided";
}
export const customerCanSee = (m: DisplayMode) => m === "likely" || m === "onsite";

export type InsulationDeclared = "none" | "present" | "unknown" | null;
/** Only an explicit owner declaration of "present" shows the removal scenario; none/unknown/unanswered => single no-removal scenario. */
export const needsRemovalScenario = (d: InsulationDeclared) => d === "present";

export type AccessTotals = { access: Access; multiplier: number; installation: number; pre_discount_total: number; applied_discount: number; estimated_customer_total: number; copayment_capped: boolean; cap_applied: boolean };
export type Scenario = { key: "can_remain" | "full_removal"; label: string; removal_m2: number; removal: number; fixed: number; by_access: Record<Access, AccessTotals> };

const cents = (n: number) => Math.round(n * 100) / 100;
export function priceScenario(key: Scenario["key"], areaM2: number, removalM2: number, s: RetailSettings, rawDiscount: number, metropolitan: boolean | null = null): Scenario {
  const mult: Record<Access, number> = { standard: Number(s.access_standard_multiplier), moderate: Number(s.access_moderate_multiplier), difficult: Number(s.access_difficult_multiplier) };
  const removal = removalM2 * Number(s.removal_inc_gst_per_m2);
  const fixed = Number(s.piesa_assessment_inc_gst) + Number(s.ap_management_inc_gst);
  const by = {} as Record<Access, AccessTotals>;
  for (const a of ACCESS_LEVELS) {
    const installation = areaM2 * Number(s.r5_install_inc_gst_per_m2) * mult[a];
    const pre = installation + removal + fixed;
    const rules = applyDiscountRules(rawDiscount, pre, metropolitan, s);
    by[a] = { access: a, multiplier: mult[a], installation: cents(installation), pre_discount_total: cents(pre), applied_discount: cents(rules.discount), estimated_customer_total: cents(pre - rules.discount), copayment_capped: rules.reducedForMin, cap_applied: rules.cappedAtMax };
  }
  return { key, label: key === "can_remain" ? "If your existing insulation can remain" : "If full removal is required", removal_m2: removalM2, removal: cents(removal), fixed: cents(fixed), by_access: by };
}

export type EstimateResult = {
  area: AreaCandidate; location: LocationVariables;
  ghg: ReturnType<typeof ghgEquivalentReduction>;
  raw_estimated_discount: number; applied_discount: number;
  scenarios: Scenario[]; primary: Scenario;
  access_adjustment: { moderate: number; difficult: number };
};
/** Full indicative estimate. Discount = whole VEECs (Eq 48.1 reduction rounded down) × indicative VEEC value, then reduced if needed so the customer pays at least the $200 minimum. */
export function computeEstimate(area: AreaCandidate, loc: LocationVariables, insulation: InsulationDeclared, s: RetailSettings): EstimateResult {
  const ghg = ghgEquivalentReduction(area.m2, loc);
  const raw = Math.floor(ghg.ghgReduction) * Number(s.indicative_veec_value); // whole VEECs only (rounded down)
  const metro = loc.metropolitan_or_regional === "Metropolitan";
  const scenarios = [priceScenario("can_remain", area.m2, 0, s, raw, metro)];
  if (needsRemovalScenario(insulation)) scenarios.push(priceScenario("full_removal", area.m2, area.m2, s, raw, metro));
  const primary = scenarios[0]!;
  const st = primary.by_access.standard;
  return {
    area, location: loc, ghg, raw_estimated_discount: raw, applied_discount: st.applied_discount, scenarios, primary,
    access_adjustment: { moderate: cents(primary.by_access.moderate.estimated_customer_total - st.estimated_customer_total), difficult: cents(primary.by_access.difficult.estimated_customer_total - st.estimated_customer_total) },
  };
}

/** Bumped whenever the pricing maths changes (not just settings), so every old estimate is recalculated. */
export const ESTIMATE_CALC_VERSION = "whole-veec-2026-10-05";
/** True when a discount is a whole number of VEECs at the given value, or was reduced only to keep the $200 minimum. */
export function discountIsWholeVeecs(discount: number, total: number, veecValue: number, minimum = MIN_CUSTOMER_CONTRIBUTION_INC_GST): boolean {
  if (!(veecValue > 0) || !Number.isFinite(discount)) return false;
  const veecs = discount / veecValue;
  return Math.abs(veecs - Math.round(veecs)) < 1e-9 || Math.abs(total - minimum) < 0.005;
}
/** Material inputs only. Same signature => no new estimate row. */
export function estimateSignature(i: { mode: DisplayMode; area: AreaCandidate; postcode: string; insulation: InsulationDeclared; settingsId: string; settingsVersion: number; veecValue: number; veecSource: string; specVersion: string }): string {
  return JSON.stringify([ESTIMATE_CALC_VERSION, i.mode, i.area.source, i.area.id, Number(i.area.m2), i.postcode, i.insulation, i.settingsId, i.settingsVersion, Number(i.veecValue), i.veecSource, i.specVersion]);
}

export const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;
export const electricalNote = (fee: number) => `Electrical safety assessment included in the ${dollars(fee)} onsite assessment. Any electrical rectification identified by the PIESA is not included in this estimate and will be itemised for approval before work proceeds.`;
export const DISCLAIMER = "Indicative estimate only. Your final price depends on the onsite measurement, existing insulation, access, electrical safety, eligibility and the VEEC market value at the time.";
export const MEASURE_REQUIRED = "We need a ceiling-area estimate before we can calculate indicative savings";

// ---- Step 3 refinement: public wording + customer what-if calculator (pure; never persisted) ----
export const FEE_LABEL = "Home Insulation Victoria — Accredited Person Management";
export const FEE_DESCRIPTION = "Covers eligibility management, Accredited Person compliance, job administration, evidence review and VEEC processing.";
export const BENCHMARK_LABEL = "Consumer estimate benchmark";
export const benchmarkNote = (v: number) => `Your estimated VEU discount uses a ${dollars(v)} per VEEC-equivalent benchmark calibrated to the Victorian Government's published 150 m² Metropolitan/Mild example (21 whole VEECs, about $1,470). It is not the live VEEC market price. Certificate values fluctuate, so your final discount may change.`;
export const CALC_ASSUMPTION_LABEL = "Calculator assumption — not a measured area";
export const CALC_NOTE = "This calculator is for exploring possible costs only. Changing the m² here does not change your recorded property details. Your onsite measure confirms the actual eligible ceiling area.";
export const CALC_EMPTY_TITLE = "Not sure of your ceiling area? Try an estimate.";
export const CALC_EMPTY_BODY = "Enter an approximate ceiling or upper-floor area to see what your project could cost.";
export const CALC_QUICK = [100, 125, 150, 200] as const;
export const CALC_MIN_M2 = 20, CALC_MAX_M2 = 1000;
/** Valid customer assumption in m², or null. Blocks NaN, zero, negative and out-of-range values. */
export function parseAssumption(raw: string | number | null | undefined): number | null {
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) && n >= CALC_MIN_M2 && n <= CALC_MAX_M2 ? n : null;
}
/** What-if estimate: same computeEstimate/Eq 48.1 core, property's resolved v25 location, current settings. */
export function whatIfEstimate(m2: number | null, loc: LocationVariables | null, insulation: InsulationDeclared, s: RetailSettings | null): EstimateResult | null {
  if (m2 == null || !loc || !s) return null;
  return computeEstimate({ m2, source: "owner_estimate", basis: "calculator assumption", id: null, label: CALC_ASSUMPTION_LABEL }, loc, insulation, s);
}

/** Review F: office quote edits. Discount = whole VEECs × the settings VEEC value, unless an audited override; the minimum contribution always applies. */
export function quoteAdjustmentDiscount(requested: number, subtotal: number, veecValue: number, minimum: number, override: boolean):
  { ok: true; discount: number; veecs: number | null; reducedForMin: boolean } | { ok: false; error: string } {
  if (!(veecValue > 0)) return { ok: false, error: "VEEC value is not set in settings." };
  const req = Math.max(0, Math.round(requested * 100) / 100);
  const n = req / veecValue;
  const whole = Math.abs(n - Math.round(n)) < 1e-9;
  if (!whole && !override) return { ok: false, error: `The discount must be a whole number of VEECs × $${veecValue}. Tick "office override" and give a reason to use another amount.` };
  const discount = Math.round(Math.min(req, Math.max(0, subtotal - minimum)) * 100) / 100;
  return { ok: true, discount, veecs: whole && discount === req ? Math.round(n) : null, reducedForMin: discount < req };
}
