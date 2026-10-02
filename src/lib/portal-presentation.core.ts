import type { AdminTab } from "./waiting.core";

export type PortalTarget =
  | "people"
  | "gate1-evidence"
  | "intake-consent"
  | "ready-check"
  | "quotes"
  | "deposit-request"
  | "electronic-signing"
  | "piesa"
  | "installation"
  | "installation-evidence"
  | "ap-evidence"
  | "veec"
  | "correspondence"
  | "documents"
  | "history";

export function targetForAction(tab: AdminTab | "documents" | "history", label = ""): PortalTarget {
  if (label === "Record deposit request") return "deposit-request";
  if (tab === "authority") return "electronic-signing";
  if (tab === "eligibility") return "gate1-evidence";
  if (tab === "assessment") return "ready-check";
  if (tab === "quotes") return "quotes";
  if (tab === "piesa") return "piesa";
  if (tab === "installation") return "installation";
  if (tab === "evidence") return "ap-evidence";
  if (tab === "veec") return "veec";
  if (tab === "messages") return "correspondence";
  if (tab === "documents") return "documents";
  if (tab === "history") return "history";
  return "people";
}

type IntakeAnswers = {
  state?: string | null;
  declared?: { property_type?: string | null; over_five_years?: string | null; previous_upgrade?: string | null } | null;
  declaredExtras?: { existing_insulation?: string | null; top_floor?: string | null } | null;
};

const answer = (value: string | null | undefined, labels?: Record<string, string>) => {
  if (!value || value === "unknown") return "Not answered / unknown";
  return labels?.[value] ?? value.replace(/_/g, " ");
};

export function ownerAnswerForGate1(key: string, intake: IntakeAnswers | null | undefined): string {
  if (!intake) return "Not answered / unknown";
  if (key === "location") return "No owner answer stored here";
  if (key === "residential") return answer(intake.declared?.property_type);
  if (key === "relevant_ceiling") {
    const propertyType = answer(intake.declared?.property_type);
    const topFloor = answer(intake.declaredExtras?.top_floor, { yes: "top floor", no: "not top floor" });
    return propertyType === "Not answered / unknown" && topFloor === "Not answered / unknown" ? propertyType : `${propertyType}; ${topFloor}`;
  }
  if (key === "ceiling_age") return answer(intake.declared?.over_five_years, { yes: "Owner says over five years", no: "Owner says not over five years" });
  if (key === "previous_activity") return answer(intake.declared?.previous_upgrade, { yes: "Previous VEU upgrade: Yes", no: "Previous VEU upgrade: No" });
  if (key === "existing_insulation") return answer(intake.declaredExtras?.existing_insulation, { none: "Owner says none", present: "Owner says insulation is present" });
  return "Not answered / unknown";
}

export function evidenceSourceLabel(source: string | null | undefined): string {
  if (!source || source === "—") return "No source recorded";
  const value = source.toLowerCase();
  if (value.includes("verified onsite") || value.includes("assessment")) return "Onsite assessment";
  if (value.includes("base44.property_research") || value.includes("base44.property research")) return "Website property research";
  if (value.includes("property intelligence") || value.includes("property_research")) return "Property research";
  if (value.includes("base44") || value.includes("owner declaration") || value.includes("answers.")) return "Homeowner enquiry";
  if (value.startsWith("properties")) return value.includes("enrichment") ? "Property research" : "Property record";
  if (value.startsWith("jobs")) return "Job record";
  if (value.includes("rollout")) return "Program calendar";
  return "Other recorded evidence";
}

export function supplementalEligibilityLabel(input: {
  eligibility_review_required?: boolean | null;
  eligibility_outcome?: string | null;
}, authoritativeLabel: string): "Review required" | "Ineligible" | "Needs onsite confirmation" | "Likely eligible" | null {
  if (input.eligibility_review_required && authoritativeLabel !== "Review required") return "Review required";
  const label = input.eligibility_outcome === "does_not_appear_eligible" ? "Ineligible"
    : input.eligibility_outcome === "needs_onsite_confirmation" ? "Needs onsite confirmation"
      : input.eligibility_outcome === "likely_eligible" ? "Likely eligible" : null;
  return label === authoritativeLabel ? null : label;
}

export function filterVisibleJobs<T extends { stage?: S | null }, S extends string>(jobs: T[], phase: string, phaseFor: (stage: S | null | undefined) => string): T[] {
  return phase === "all" ? jobs : jobs.filter((job) => phaseFor(job.stage) === phase);
}