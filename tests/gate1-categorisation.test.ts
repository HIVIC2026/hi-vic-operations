import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { eligibilityConfirmedFor, evaluateGate1, resolveGate1Facts, type Gate1Facts, type IntelFact, type StoredProperty } from "../src/lib/eligibility.core";
import { gate1InputFromFacts, recommendGate1, type Fact } from "../src/lib/intelligence.core";

// Strong remote baseline (all remotely checkable rules satisfied, insulation declared none).
const base: Gate1Facts = {
  state: "VIC", postcode: "3056", occupancy: "owner_occupied", isResidential: true, yearBuilt: null, yearBuiltVerified: false, verifiedMinAgeYears: 25,
  minBuildingAgeYears: 5, lifeSupportStatus: "no", previousCeilingUpgrade: false, flatRoofOrAccessConcern: false, preliminaryOutcome: null,
  currentYear: 2026, declaredInsulation: "none", referenceDate: "2026-10-05", areaKnown: true,
};
const d = (o: Partial<Gate1Facts> = {}) => evaluateGate1({ ...base, ...o });
const rule = (x: ReturnType<typeof d>, k: string) => x.rules.find((r) => r.key === k)!;

describe("Step 2 Gate 1 categorisation", () => {
  test("baseline: likely eligible", () => { const x = d(); expect(x.outcome).toBe("likely_eligible"); expect(x.internalStatus).toBe("auto_decided"); });
  test("1. verified outside VIC -> fail", () => expect(d({ state: "NSW" }).outcome).toBe("does_not_appear_eligible"));
  test("2. verified non-residential -> fail", () => expect(d({ isResidential: false }).outcome).toBe("does_not_appear_eligible"));
  test("3. no relevant ceiling (direct) -> fail", () => expect(d({ noRelevantCeilingDirect: true }).outcome).toBe("does_not_appear_eligible"));
  test("4. relevant ceiling direct <5y -> fail", () => expect(d({ verifiedMinAgeYears: null, yearBuilt: 2023, yearBuiltVerified: true }).outcome).toBe("does_not_appear_eligible"));
  test("5. owner >5y=no alone -> review, not fail", () => {
    const x = d({ verifiedMinAgeYears: null, declaredOverMinAge: "no" });
    expect(x.outcome).toBeNull(); expect(x.reviewRequired).toBe(true); expect(x.failed).toHaveLength(0);
  });
  test("6. owner previous upgrade yes -> fail", () => { const x = d({ previousCeilingUpgrade: true }); expect(x.outcome).toBe("does_not_appear_eligible"); expect(x.failed.length).toBeGreaterThan(0); });
  test("7. confirmed prior Activity 48 -> fail", () => expect(d({ previousActivity48Confirmed: true }).outcome).toBe("does_not_appear_eligible"));
  test("8. insulation none + strong remote rules -> likely eligible", () => expect(d({ declaredInsulation: "none" }).outcome).toBe("likely_eligible"));
  test("9. insulation present -> needs onsite", () => expect(d({ declaredInsulation: "present" }).outcome).toBe("needs_onsite_confirmation"));
  test("10. insulation unknown -> needs onsite", () => { expect(d({ declaredInsulation: "unknown" }).outcome).toBe("needs_onsite_confirmation"); expect(d({ declaredInsulation: null }).outcome).toBe("needs_onsite_confirmation"); });
  test("11. verified insulation R>=2 -> fail; verified qualifying overrides declaration", () => {
    expect(d({ verifiedInsulation: "disqualifying" }).outcome).toBe("does_not_appear_eligible");
    expect(d({ declaredInsulation: "present", verifiedInsulation: "qualifying" }).outcome).toBe("likely_eligible");
  });
  test("12. life support yes: same outcome, safety flag", () => {
    const x = d({ lifeSupportStatus: "yes" });
    expect(x.outcome).toBe("likely_eligible");
    expect(x.flags.find((f) => f.key === "life_support")).toMatchObject({ type: "safety", severity: "high" });
    expect(d({ lifeSupportStatus: "unknown" }).outcome).toBe("likely_eligible");
  });
  test("13. flat roof -> onsite + operational flag, not fail", () => {
    const x = d({ flatRoofOrAccessConcern: true });
    expect(x.outcome).toBe("needs_onsite_confirmation"); expect(x.flags.map((f) => f.key)).toContain("roof_access_review");
  });
  test("14. ambiguous address -> review", () => expect(d({ addressAmbiguous: true }).internalStatus).toBe("review_required"));
  test("15. conflicting property type -> review", () => {
    const p: StoredProperty = { state: "VIC", postcode: "3056", occupancy: "owner_occupied", is_residential: null, year_built: null,
      enrichment: { base44: { declared: { property_type: "office", over_five_years: "yes", previous_upgrade: "no" }, research: { status: "complete", premises_classification: "Residential dwelling", first_appearance_year: 2001, age_verified: true }, raw: { answers: { insulation: "none" } } } } };
    expect(evaluateGate1(resolveGate1Facts(p, { lifeSupportStatus: "no", preliminaryOutcome: null }, 5, 2026)).reviewRequired).toBe(true);
    expect(d({ declaredPropertyType: "apartment", declaredTopFloor: "unknown" }).reviewRequired).toBe(true);
  });
  test("16. recent extension risk -> review, whole property not failed", () => {
    const x = d({ recentExtensionRisk: "yes" }); expect(x.reviewRequired).toBe(true); expect(x.failed).toHaveLength(0);
    expect(rule(x, "ceiling_age").label).toBe("Relevant ceiling / structure age");
  });
  test("17. area unknown never fails", () => { const x = d({ areaKnown: false }); expect(x.outcome).toBe("likely_eligible"); expect(x.flags.map((f) => f.key)).toContain("measure_required"); });
  test("18. private job 29 Sep 2026: normal category, rollout hold blocks progression", () => {
    const x = d({ referenceDate: "2026-09-29" });
    expect(x.outcome).toBe("likely_eligible"); expect(x.rolloutHold).toBe(true);
    const job = { eligibility_outcome: x.outcome, eligibility_decision_source: "system", eligibility_review_required: false, eligibility_flags: x.flags };
    expect(eligibilityConfirmedFor(job, "2026-09-29")).toBe(false);
    expect(eligibilityConfirmedFor(job, "2026-10-01")).toBe(true); // stale flag self-clears on 1 Oct
    expect(d({ referenceDate: "2026-09-29", publicHousingVerified: true }).rolloutHold).toBe(false);
  });
  test("19. same job 1 Oct 2026: no hold", () => { const x = d({ referenceDate: "2026-10-01" }); expect(x.rolloutHold).toBe(false); expect(x.flags.map((f) => f.key)).not.toContain("rollout_hold"); });
  test("20. admin decision never overwritten", () => {
    const src = readFileSync("src/lib/eligibility.server.ts", "utf8");
    expect(src).toMatch(/eligibility_decision_source === "admin"\) \{ await refreshGate1Flags\(jobId\); return null; \}/);
    expect(eligibilityConfirmedFor({ eligibility_outcome: "needs_onsite_confirmation", eligibility_decision_source: "admin", eligibility_review_required: false, eligibility_flags: [] }, "2026-10-02")).toBe(true);
  });
  test("21. preliminary Base44 outcome alone never finalises", () => {
    const x = evaluateGate1(resolveGate1Facts({ state: null, postcode: null, occupancy: null, is_residential: null, year_built: null, enrichment: null }, { lifeSupportStatus: "no", preliminaryOutcome: "likely_eligible" }, 5, 2026));
    expect(x.outcome).toBeNull(); expect(rule(x, "preliminary").result).toBe("info");
  });
  test("review / fail never confirm eligibility", () => {
    expect(eligibilityConfirmedFor({ eligibility_outcome: null, eligibility_decision_source: "system", eligibility_review_required: true, eligibility_flags: [] }, "2026-10-02")).toBe(false);
    expect(eligibilityConfirmedFor({ eligibility_outcome: "does_not_appear_eligible", eligibility_decision_source: "system", eligibility_review_required: false, eligibility_flags: [] }, "2026-10-02")).toBe(false);
  });
  test("22. intelligence path and eligibility path return the SAME categorisation", () => {
    const facts: Fact[] = [
      { key: "address_verified", value: true, status: "ok", sourceType: "public_gis", sourceName: "Vicmap", confidence: "high", evidence: "direct" },
      { key: "in_victoria", value: true, status: "ok", sourceType: "public_gis", sourceName: "Vicmap", confidence: "high", evidence: "direct" },
      { key: "ncc_class_evidence", value: "class1", status: "ok", sourceType: "provider", sourceName: "X", confidence: "high", evidence: "direct" },
      { key: "roof_form", value: "low_slope_flat", status: "ok", sourceType: "provider", sourceName: "Solar", confidence: "low", evidence: "inferred" },
    ] as Fact[];
    const intel: IntelFact[] = facts.map((f) => ({ fact_key: f.key, value: f.value, evidence_kind: f.evidence, confidence: f.confidence, source_type: f.sourceType, source_name: f.sourceName, is_current: true, is_stale: false }));
    const a = recommendGate1(gate1InputFromFacts(facts, "2026-10-05"));
    const b = evaluateGate1(resolveGate1Facts(null, { lifeSupportStatus: null, preliminaryOutcome: null, referenceDate: "2026-10-05" }, 5, 2026, intel));
    expect(a.outcome).toBe(b.outcome); expect(a.reviewRequired).toBe(b.reviewRequired);
    expect(readFileSync("src/lib/intelligence.server.ts", "utf8")).not.toMatch(/recommendGate1\(/);
  });
});
