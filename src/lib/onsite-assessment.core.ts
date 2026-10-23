// Jo 23 Oct 2026: owner insulation-answer display helpers (the "Needs onsite assessment" group was dropped 08:14 UTC).
import { INSULATION_DETAIL_QUESTIONS, type InsulationTapAnswers } from "./insulation-details.core";

const label = (key: string, value: string | undefined) =>
  INSULATION_DETAIL_QUESTIONS.find((q) => q.key === key)?.options.find((o) => o.value === value)?.label ?? null;

export function houseAgeLabel(tap: Partial<InsulationTapAnswers> | null): string {
  return label("house_built_period", tap?.house_built_period) ?? "Age not given";
}

/** One short line of what the owner said. */
export function onsiteInsulationLine(tap: Partial<InsulationTapAnswers> | null): string {
  if (!tap?.insulation_type) return "Doesn't know if there's insulation";
  const type = label("insulation_type", tap.insulation_type);
  const thick = label("insulation_thickness", tap.insulation_thickness);
  if (tap.insulation_type === "unknown" && (!tap.insulation_thickness || tap.insulation_thickness === "unknown")) return "Not sure of type or thickness";
  return [type, thick].filter(Boolean).join(" · ");
}
