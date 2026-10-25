/** Snapshot facts only; declarations never establish removal requirements or cost. */
export type EstimateRemoval = { kind: "excluded" } | { kind: "included"; amount: number; areaM2: number } | { kind: "unknown" };
/** Jo 12 Oct 2026 23:18 UTC — exact budget sentence for existing-insulation emails when removal is not itemised (excluded or unknown). */
export const REMOVAL_BUDGET_EMAIL_NOTE = "Existing insulation may need to be removed. Please budget $15 per m² including GST for the areas that need removal only. We’ll confirm the area and cost before you approve any removal.";
export const REMOVAL_EXCLUDED = REMOVAL_BUDGET_EMAIL_NOTE;
export const EXISTING_PRELIMINARY = "This saves your place in line only. Whether your existing insulation can stay, your eligibility and your final price are all confirmed before you agree to anything. No payment is required to save your place.";
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
  if (fact.kind === "included") return `This estimate includes $${fact.amount.toLocaleString("en-AU", { maximumFractionDigits: 2 })} inc GST for removal of ${fact.areaM2.toLocaleString("en-AU")} m² of existing insulation. Whether removal is required, and the final scope and price, are confirmed before you agree to proceed.`;
  return REMOVAL_BUDGET_EMAIL_NOTE;
}