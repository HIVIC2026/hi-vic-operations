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
  if (key === "previous_activity") return "Not asked (question retired)";
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
  if (input.eligibility_review_required) return authoritativeLabel === "Review required" ? null : "Review required";
  const label = input.eligibility_outcome === "does_not_appear_eligible" ? "Ineligible"
    : input.eligibility_outcome === "needs_onsite_confirmation" ? "Needs onsite confirmation"
      : input.eligibility_outcome === "likely_eligible" ? "Likely eligible" : null;
  return label === authoritativeLabel ? null : label;
}

export function filterVisibleJobs<T extends { stage?: S | null }, S extends string>(jobs: T[], phase: string, phaseFor: (stage: S | null | undefined) => string): T[] {
  return phase === "all" ? jobs : jobs.filter((job) => phaseFor(job.stage) === phase);
}
/** Trade job page (Jo, 7 Oct): office blocker wording → one plain line per kind of wait. Labels only; never decides anything. */
export function tradeBlockerLines(blockers: string[]): string[] {
  const line = (b: string): string => {
    if (/measure-?up|measured|ceiling area|Ready Check/i.test(b)) return "Waiting for the office to check your measure-up";
    if (/eligib/i.test(b)) return "Waiting for the office to confirm the owner is eligible";
    if (/payment|deposit|invoice|paid/i.test(b)) return "Waiting for the owner's payment";
    if (/PIESA|safety check|electric/i.test(b)) return "Waiting for the electrical safety check";
    if (/quote/i.test(b)) return "Waiting for the quote to be approved";
    if (/sign|accept|consent|paperwork|agreement|assignment/i.test(b)) return "Waiting for the owner's paperwork";
    if (/evidence|photo|video|document/i.test(b)) return "Photos or documents still needed";
    return "Waiting for the office";
  };
  return [...new Set(blockers.map(line))];
}

// ---- Compact eligibility card (Jo, 7 Oct): one row per check. Labels only — never decides eligibility. ----
export type CheckMark = "pass" | "fail" | "confirm";
export const CHECK_MARK_LABEL: Record<CheckMark, string> = { pass: "Pass", fail: "Fail", confirm: "Confirm onsite" };
export const markOf = (result: string | null | undefined): CheckMark => result === "pass" ? "pass" : result === "fail" ? "fail" : "confirm";

type OnsiteFacts = {
  measure?: { areaM2: number | null } | null;
  insulation?: { existing: string | null; rValue: number | null } | null;
  priorActivity?: string | null;
};
/** What the Ready Check showed for each check. null = this check isn't recorded onsite. */
export function onsiteMarkFor(key: string, e: OnsiteFacts | null | undefined, rLimit = 2): { mark: CheckMark; text: string } | null {
  if (!e) return null;
  if (key === "relevant_ceiling") return e.measure?.areaM2 ? { mark: "pass", text: `Measured ${e.measure.areaM2} m²` } : { mark: "confirm", text: "Not measured yet" };
  if (key === "existing_insulation") {
    const i = e.insulation;
    if (!i?.existing || i.existing === "unknown") return { mark: "confirm", text: "Not recorded" };
    if (i.existing === "none") return { mark: "pass", text: "None found" };
    if (i.rValue == null) return { mark: "confirm", text: "Present, R-value not recorded" };
    return i.rValue < rLimit ? { mark: "pass", text: `R${i.rValue}` } : { mark: "fail", text: `R${i.rValue} (R${rLimit} or more)` };
  }
  if (key === "previous_activity") {
    if (!e.priorActivity) return { mark: "confirm", text: "Office check not done" };
    return e.priorActivity === "same_area" ? { mark: "fail", text: "Previous Activity 48, same area" } : { mark: "pass", text: "None for this area" };
  }
  return null;
}
