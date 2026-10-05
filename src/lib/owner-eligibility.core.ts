// PURE: owner eligibility link for installer-sourced customers. Quick questions only —
// no signatures, no consent, no VEEC assignment (those are signed only at quote acceptance).
// The result comes from the one Gate 1 categoriser; internal review is never shown — it reads as "needs an assessment".
import { evaluateGate1, GATE1_RULESET_VERSION, type CustomerOutcome } from "./eligibility.core";

export const OWNER_LINK_DAYS = 30;

export const OWNER_QUESTIONS = {
  property_type: { label: "What type of home is it?", options: [["house", "House"], ["townhouse", "Townhouse"], ["unit", "Unit or apartment"], ["other", "Something else (e.g. shop or office)"]] },
  top_floor: { label: "If it's a unit or apartment, is it on the top floor with the roof directly above?", options: [["yes", "Yes"], ["no", "No"], ["unknown", "Not sure"]] },
  over_five_years: { label: "Was the home built more than 5 years ago?", options: [["yes", "Yes"], ["no", "No"], ["unknown", "Not sure"]] },
  insulation: { label: "Is there any insulation in the ceiling now?", options: [["none", "No insulation"], ["present", "Yes, some insulation"], ["unknown", "Not sure"]] },
  life_support: { label: "Does anyone at the home use life support equipment?", options: [["no", "No"], ["yes", "Yes"], ["unknown", "Not sure"]] },
} as const;

export type OwnerAnswers = { [K in keyof typeof OWNER_QUESTIONS]: string };

export const OUTCOME_LABEL: Record<CustomerOutcome, string> = {
  likely_eligible: "Eligible",
  needs_onsite_confirmation: "Needs assessment",
  does_not_appear_eligible: "Not eligible",
};

export function validateOwnerAnswers(a: Record<string, unknown>): OwnerAnswers | string {
  const out: Record<string, string> = {};
  for (const [k, q] of Object.entries(OWNER_QUESTIONS)) {
    const v = String(a[k] ?? "");
    if (k === "top_floor" && a["property_type"] !== "unit") { out[k] = ""; continue; }
    if (!q.options.some(([o]) => o === v)) return `Please answer: ${q.label}`;
    out[k] = v;
  }
  return out as OwnerAnswers;
}

export function evaluateOwnerAnswers(a: OwnerAnswers, p: { state: string | null; postcode: string | null }, currentYear: number, today: string) {
  const d = evaluateGate1({
    state: p.state, postcode: p.postcode, occupancy: null, isResidential: null, yearBuilt: null, yearBuiltVerified: false,
    minBuildingAgeYears: 5, lifeSupportStatus: a.life_support, previousCeilingUpgrade: null, flatRoofOrAccessConcern: false,
    preliminaryOutcome: null, currentYear, declaredOverMinAge: a.over_five_years as "yes" | "no" | "unknown",
    declaredPropertyType: a.property_type === "other" ? "commercial premises" : a.property_type,
    declaredTopFloor: a.property_type === "unit" ? (a.top_floor as "yes" | "no" | "unknown") : null,
    declaredHouse: a.property_type === "house" || a.property_type === "townhouse",
    declaredInsulation: a.insulation as "none" | "present" | "unknown", referenceDate: today,
  });
  const result: CustomerOutcome = d.outcome ?? "needs_onsite_confirmation";
  const reasons = result === "does_not_appear_eligible" ? d.failed : result === "needs_onsite_confirmation" ? [...d.onsite, ...d.review] : [];
  return { result, label: OUTCOME_LABEL[result], reasons, ruleset: GATE1_RULESET_VERSION };
}
