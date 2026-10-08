/** Snapshot facts only; declarations never establish removal requirements or cost. */
export type EstimateRemoval = { kind: "excluded" } | { kind: "included"; amount: number; areaM2: number } | { kind: "unknown" };
export const REMOVAL_EXCLUDED = "This estimate does not include removal of existing insulation. It may be able to stay. If removal is required, we’ll confirm the additional cost in your final quote before you agree to proceed.";
export const EXISTING_PRELIMINARY = "This qualifies you for the preliminary queue only. Your free Ready Check determines whether the existing insulation can remain and confirms eligibility and the final price. No payment is required to save your place.";
export function removalFromScenario(scenario: unknown): EstimateRemoval {
  if (!scenario || typeof scenario !== "object") return { kind: "unknown" };
  const s = scenario as { removal?: unknown; removal_m2?: unknown };
  if (typeof s.removal !== "number" || !Number.isFinite(s.removal) || s.removal < 0) return { kind: "unknown" };
  if (s.removal === 0 && s.removal_m2 === 0) return { kind: "excluded" };
  if (s.removal > 0 && typeof s.removal_m2 === "number" && Number.isFinite(s.removal_m2) && s.removal_m2 > 0) return { kind: "included", amount: s.removal, areaM2: s.removal_m2 };
  return { kind: "unknown" };
}
export function removalNote(fact: EstimateRemoval): string {
  if (fact.kind === "excluded") return REMOVAL_EXCLUDED;
  if (fact.kind === "included") return `This estimate includes $${fact.amount.toLocaleString("en-AU", { maximumFractionDigits: 2 })} inc GST for removal of ${fact.areaM2.toLocaleString("en-AU")} m² of existing insulation. Your free Ready Check confirms whether removal is required and the final scope and price before you agree to proceed.`;
  return "Removal of existing insulation has not been confirmed in this estimate. Your free Ready Check confirms whether it can remain and any removal cost in your final quote before you agree to proceed.";
}