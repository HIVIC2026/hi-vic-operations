import { describe, expect, test } from "bun:test";
import { evidenceSourceLabel, filterVisibleJobs, ownerAnswerForGate1, supplementalEligibilityLabel, targetForAction } from "../src/lib/portal-presentation.core";
import { readFileSync } from "fs";

describe("staff portal presentation helpers", () => {
  test("phase filtering has one authoritative visible collection", () => {
    const jobs = [{ id: "a", stage: "new" }, { id: "b", stage: "install" }];
    const phaseFor = (stage: string | null | undefined) => stage === "install" ? "delivery" : "intake";
    expect(filterVisibleJobs(jobs, "delivery", phaseFor).map((job) => job.id)).toEqual(["b"]);
    expect(filterVisibleJobs(jobs, "all", phaseFor)).toEqual(jobs);
  });

  test("shows real owner answers without deriving them from assessment results", () => {
    const intake = { declared: { property_type: "townhouse", over_five_years: "yes", previous_upgrade: "no" }, declaredExtras: { top_floor: "unknown", existing_insulation: "present" } };
    expect(ownerAnswerForGate1("residential", intake)).toBe("townhouse");
    expect(ownerAnswerForGate1("ceiling_age", intake)).toBe("Owner says over five years");
    expect(ownerAnswerForGate1("previous_activity", intake)).toBe("Not asked (question retired)");
    expect(ownerAnswerForGate1("existing_insulation", intake)).toBe("Owner says insulation is present");
    expect(ownerAnswerForGate1("residential", null)).toBe("Not answered / unknown");
    expect(ownerAnswerForGate1("location", intake)).toBe("No owner answer stored here");
  });

  test("maps evidence sources to meaningful labels without hiding the raw audit", () => {
    expect(evidenceSourceLabel("properties.is_residential")).toBe("Property record");
    expect(evidenceSourceLabel("base44 answers.insulation")).toBe("Owner enquiry");
    expect(evidenceSourceLabel("base44.property_research.year_built")).toBe("Website property research");
    expect(evidenceSourceLabel("verified onsite finding")).toBe("Onsite assessment");
    expect(evidenceSourceLabel("unmapped.provider.fact")).toBe("Other recorded evidence");
  });

  test("targets precise controls and preserves installer evidence nudges", () => {
    expect(targetForAction("quotes", "Record deposit request")).toBe("deposit-request");
    expect(targetForAction("authority", "Open")).toBe("electronic-signing");
    expect(targetForAction("messages", "Draft a nudge")).toBe("correspondence");
    expect(targetForAction("evidence", "Open evidence")).toBe("ap-evidence");
  });

  test("status precedence keeps terminal review flags and suppresses duplicate outcomes", () => {
    expect(supplementalEligibilityLabel({ eligibility_review_required: true, eligibility_outcome: "likely_eligible" }, "Review required")).toBeNull();
    expect(supplementalEligibilityLabel({ eligibility_review_required: true, eligibility_outcome: "likely_eligible" }, "On hold")).toBe("Review required");
    expect(supplementalEligibilityLabel({ eligibility_outcome: "does_not_appear_eligible" }, "Ineligible")).toBeNull();
  });

  test("exact targets stay on real controls (the old job fold-outs and list row were replaced by the O2/O3 screens)", () => {
    const panels = readFileSync("src/components/portal/panels.tsx", "utf8");
    const intake = readFileSync("src/components/portal/intake.tsx", "utf8");
    expect(panels).toContain('id="target-deposit-request" data-portal-focus="target"');
    expect(intake).toContain('id="target-intake-consent" data-portal-focus="target"');
  });
});