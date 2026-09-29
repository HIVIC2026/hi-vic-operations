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
};

export type Access = "standard" | "moderate" | "difficult";
export const ACCESS_LEVELS: Access[] = ["standard", "moderate", "difficult"];

export type AreaCandidate = { m2: number; source: "accepted_measurement" | "area_estimate" | "owner_estimate"; basis: string; id: string | null; label: string };
/** Strongest preliminary area: accepted current measurement > trusted area estimate > job (owner) estimate. Never invents one. */
export function pickArea(c: { measurement?: { id: string; m2: number | null; label?: string } | null; estimate?: { id: string; m2: number | null; tier: string } | null; owner?: number | null }): AreaCandidate | null {
  const ok = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
  if (c.measurement && ok(c.measurement.m2)) return { m2: c.measurement.m2, source: "accepted_measurement", basis: "measured", id: c.measurement.id, label: c.measurement.label ?? "Accepted ceiling measure-up" };
  if (c.estimate && ok(c.estimate.m2)) return { m2: c.estimate.m2, source: "area_estimate", basis: `researched (tier ${c.estimate.tier})`, id: c.estimate.id, label: `Property research estimate (tier ${c.estimate.tier})` };
  if (ok(c.owner)) return { m2: c.owner, source: "owner_estimate", basis: "declared", id: null, label: "Your estimate" };
  return null;
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

export type AccessTotals = { access: Access; multiplier: number; installation: number; pre_discount_total: number; applied_discount: number; estimated_customer_total: number; copayment_capped: boolean };
export type Scenario = { key: "can_remain" | "full_removal"; label: string; removal_m2: number; removal: number; fixed: number; by_access: Record<Access, AccessTotals> };

const cents = (n: number) => Math.round(n * 100) / 100;
export function priceScenario(key: Scenario["key"], areaM2: number, removalM2: number, s: RetailSettings, rawDiscount: number): Scenario {
  const mult: Record<Access, number> = { standard: Number(s.access_standard_multiplier), moderate: Number(s.access_moderate_multiplier), difficult: Number(s.access_difficult_multiplier) };
  const removal = removalM2 * Number(s.removal_inc_gst_per_m2);
  const fixed = Number(s.piesa_assessment_inc_gst) + Number(s.ap_management_inc_gst);
  const floor = Number(s.minimum_customer_copayment_inc_gst);
  const by = {} as Record<Access, AccessTotals>;
  for (const a of ACCESS_LEVELS) {
    const installation = areaM2 * Number(s.r5_install_inc_gst_per_m2) * mult[a];
    const pre = installation + removal + fixed;
    const applied = Math.min(rawDiscount, Math.max(0, pre - floor));
    by[a] = { access: a, multiplier: mult[a], installation: cents(installation), pre_discount_total: cents(pre), applied_discount: cents(applied), estimated_customer_total: cents(pre - applied), copayment_capped: applied < rawDiscount };
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
/** Full indicative estimate. Discount = unrounded Eq 48.1 reduction × indicative VEEC value, capped by the minimum co-payment. */
export function computeEstimate(area: AreaCandidate, loc: LocationVariables, insulation: InsulationDeclared, s: RetailSettings): EstimateResult {
  const ghg = ghgEquivalentReduction(area.m2, loc);
  const raw = ghg.ghgReduction * Number(s.indicative_veec_value);
  const scenarios = [priceScenario("can_remain", area.m2, 0, s, raw)];
  if (needsRemovalScenario(insulation)) scenarios.push(priceScenario("full_removal", area.m2, area.m2, s, raw));
  const primary = scenarios[0]!;
  const st = primary.by_access.standard;
  return {
    area, location: loc, ghg, raw_estimated_discount: raw, applied_discount: st.applied_discount, scenarios, primary,
    access_adjustment: { moderate: cents(primary.by_access.moderate.estimated_customer_total - st.estimated_customer_total), difficult: cents(primary.by_access.difficult.estimated_customer_total - st.estimated_customer_total) },
  };
}

/** Material inputs only. Same signature => no new estimate row. */
export function estimateSignature(i: { mode: DisplayMode; area: AreaCandidate; postcode: string; insulation: InsulationDeclared; settingsId: string; settingsVersion: number; veecValue: number; veecSource: string; specVersion: string }): string {
  return JSON.stringify([i.mode, i.area.source, i.area.id, Number(i.area.m2), i.postcode, i.insulation, i.settingsId, i.settingsVersion, Number(i.veecValue), i.veecSource, i.specVersion]);
}

export const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;
export const electricalNote = (fee: number) => `Electrical safety assessment included in the ${dollars(fee)} onsite assessment. Any electrical rectification identified by the PIESA is not included in this estimate and will be itemised for approval before work proceeds.`;
export const DISCLAIMER = "Indicative estimate only. Your final price depends on the onsite measurement, existing insulation, access, electrical safety, eligibility and the VEEC market value at the time.";
export const MEASURE_REQUIRED = "We need a ceiling-area estimate before we can calculate indicative savings";

// ---- Step 3 refinement: public wording + customer what-if calculator (pure; never persisted) ----
export const FEE_LABEL = "Home Insulation Victoria — Accredited Person Management";
export const FEE_DESCRIPTION = "Covers eligibility management, Accredited Person compliance, job administration, evidence review and VEEC processing.";
export const BENCHMARK_LABEL = "Consumer estimate benchmark";
export const benchmarkNote = (v: number) => `Your estimated VEU discount uses a ${dollars(v)} per VEEC-equivalent benchmark calibrated to the Victorian Government's published 150 m² Metropolitan/Mild example (about $1,482). It is not the live VEEC market price. Certificate values fluctuate, so your final discount may change.`;
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
