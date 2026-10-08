import { insulationOnly, type StoredAudit } from "./enquiry-groups.core";
import { GATE1_RULESET_VERSION } from "./eligibility.core";
export const INSULATION_REVIEW_OPTIONS = [
  { id: "loose_fill_only", label: "Is your existing insulation loose-fill only (no batts)?", confirmation: "I confirm it is loose-fill insulation only", explanation: "Loose material, with no insulation batts." },
  { id: "photos", label: "Upload photos of your existing insulation" },
  { id: "video", label: "Take a video from the manhole" },
  { id: "below_r2", label: "Is your existing insulation less than R2?", confirmation: "I confirm my existing insulation is less than R2" },
] as const;
export type InsulationReviewOption = typeof INSULATION_REVIEW_OPTIONS[number]["id"];
export type InsulationDeclaration = "loose_fill_only" | "below_r2";
export function insulationDeclarationRecord(type: unknown, confirmed: unknown) {
  if (confirmed !== true || (type !== "loose_fill_only" && type !== "below_r2")) throw new Error("Choose a declaration and confirm it before submitting.");
  const declaration = type === "loose_fill_only" ? "I confirm it is loose-fill insulation only" : "I confirm my existing insulation is less than R2";
  return { eventType: type === "loose_fill_only" ? "owner_insulation_loose_fill_only_declared" : "owner_insulation_below_r2_declared", declaration, basis: "owner_declared", reviewReason: `Owner declared — preliminary queue qualification: ${declaration}. Final onsite verification required.` };
}
export function declarationCriteriaPassed(x: { outcome: string | null; decisionSource: string | null; reviewRequired: boolean; audit: StoredAudit; insulation: "none" | "present" | "unknown" | null; intakeActive: boolean }): boolean {
  return !x.reviewRequired && !x.intakeActive && ["likely_eligible", "needs_onsite_confirmation"].includes(x.outcome ?? "") &&
    ["system", "admin"].includes(x.decisionSource ?? "") && (x.decisionSource !== "system" || x.audit?.ruleset_version === GATE1_RULESET_VERSION) &&
    !(x.audit?.hard_failures?.length || x.audit?.review_reasons?.length || x.audit?.rules?.some((r) => r.result === "fail")) && insulationOnly(x.audit, x.insulation).ok;
}
export function qualifyingDeclaration(events: { event_type: string; details: unknown }[]): boolean {
  return events.some((event) => {
    if (!event.details || typeof event.details !== "object") return false;
    const m = event.details as Record<string, unknown>;
    return m['answer'] === "yes" && m['preliminary_queue_qualification'] === true && m['basis'] === "owner_declared" &&
      ((event.event_type === "owner_insulation_loose_fill_only_declared" && m['declaration_type'] === "loose_fill_only") || (event.event_type === "owner_insulation_below_r2_declared" && m['declaration_type'] === "below_r2"));
  });
}
export const INSULATION_REVIEW_INVITATION = "Help us check your existing insulation. Choose one option below. Is your existing insulation loose-fill only (no batts)? Is your existing insulation less than R2? If you answer Yes to either question and the other initial checks pass, you can save your spot. Alternatively, upload photos of your existing insulation or take a video from the manhole for office review. Record from the manhole opening. Please do not climb into the roof space. Not sure? You can upload photos or a video, or we can check onsite. Final onsite and compliance verification still apply.";