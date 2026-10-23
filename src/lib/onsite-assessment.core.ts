// Jo 23 Oct 2026: "Needs onsite assessment" holding group on Office Enquiries. NOT a to-do list.
// Pure membership + display rules only; sending reuses the normal guarded Save my spot path.
import { INSULATION_DETAIL_QUESTIONS, insulationTapRoute, type InsulationTapAnswers } from "./insulation-details.core";

export type OnsiteMemberInput = {
  tap: Partial<InsulationTapAnswers> | null;
  declaredInsulation: "none" | "present" | "unknown" | null;
  mediaCount: number;
  spotOffered?: boolean;
};

/** Members: tap answers routed onsite (hand/thicker/can't tell, 1991+/not sure, incl. type Not sure only),
 *  or website "don't know" insulation with no tap answers. Any photos/video → existing office photo review. */
export function onsiteAssessmentMember(x: OnsiteMemberInput): boolean {
  if (x.mediaCount > 0 || x.spotOffered) return false;
  if (x.tap && x.tap.insulation_type) {
    return insulationTapRoute({ insulation_type: x.tap.insulation_type, insulation_thickness: x.tap.insulation_thickness ?? "unknown", house_built_period: x.tap.house_built_period }) === "needs_onsite_assessment";
  }
  return x.declaredInsulation === "unknown";
}

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
