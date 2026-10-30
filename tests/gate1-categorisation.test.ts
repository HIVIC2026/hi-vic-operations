import { describe, expect, test } from "bun:test";
import { eligibilityConfirmedFor, evaluateGate1, resolveGate1Facts, type Gate1Facts, type IntelFact, type StoredProperty } from "../src/lib/eligibility.core";

// Simple Gate 1 (4 Oct 2026): homeowner answers only; no remote property research; never internal review.
const base: Gate1Facts = {
  state: "VIC", postcode: "3056", occupancy: null, isResidential: null, yearBuilt: null, yearBuiltVerified: false,
  minBuildingAgeYears: 5, lifeSupportStatus: "no", previousCeilingUpgrade: null, flatRoofOrAccessConcern: false, preliminaryOutcome: null,
  currentYear: 2026, declaredInsulation: "none", declaredOverMinAge: "yes", declaredPropertyType: "House", referenceDate: "2026-10-05", areaKnown: true,
};
const d = (o: Partial<Gate1Facts> = {}) => evaluateGate1({ ...base, ...o });

describe("Simple Gate 1", () => {
  test("declared house, over 5 years, no insulation -> likely eligible", () => { const x = d(); expect(x.outcome).toBe("likely_eligible"); expect(x.reviewRequired).toBe(false); });
  test("outside Victoria -> does not appear eligible", () => { expect(d({ state: "NSW" }).outcome).toBe("does_not_appear_eligible"); expect(d({ state: null, postcode: "2000" }).outcome).toBe("does_not_appear_eligible"); });
  test("owner says under 5 years -> does not appear eligible", () => expect(d({ declaredOverMinAge: "no" }).outcome).toBe("does_not_appear_eligible"));
  test("age unknown -> needs onsite, not review", () => { const x = d({ declaredOverMinAge: "unknown" }); expect(x.outcome).toBe("needs_onsite_confirmation"); expect(x.reviewRequired).toBe(false); });
  test("not a home -> does not appear eligible", () => { expect(d({ declaredPropertyType: "Commercial office" }).outcome).toBe("does_not_appear_eligible"); expect(d({ isResidential: false }).outcome).toBe("does_not_appear_eligible"); });
  test("unit not top floor -> needs onsite", () => expect(d({ declaredPropertyType: "Unit", declaredTopFloor: "no" }).outcome).toBe("needs_onsite_confirmation"));
  test("insulation present or unknown -> needs onsite", () => { expect(d({ declaredInsulation: "present" }).outcome).toBe("needs_onsite_confirmation"); expect(d({ declaredInsulation: null }).outcome).toBe("needs_onsite_confirmation"); });
  test("previous Activity 48 never fails (always no, Jo 29 Oct)", () => expect(d({ previousActivity48Confirmed: true }).failed).not.toContain("Previous Activity 48 for the same ceiling area confirmed"));
  test("life support / area unknown are flags only", () => {
    const x = d({ lifeSupportStatus: "yes", areaKnown: false });
    expect(x.outcome).toBe("likely_eligible");
    expect(x.flags.map((f) => f.key)).toEqual(expect.arrayContaining(["life_support", "measure_required"]));
  });
  test("verified onsite insulation decides", () => {
    expect(d({ verifiedInsulation: "disqualifying" }).outcome).toBe("does_not_appear_eligible");
    expect(d({ declaredInsulation: "present", verifiedInsulation: "qualifying" }).outcome).toBe("likely_eligible");
  });
  test("rollout hold before 1 Oct 2026 still blocks progression", () => {
    const x = d({ referenceDate: "2026-09-29" });
    expect(x.rolloutHold).toBe(true);
    expect(eligibilityConfirmedFor({ eligibility_outcome: x.outcome, eligibility_decision_source: "system", eligibility_flags: x.flags }, "2026-09-29")).toBe(false);
  });
  test("property research and intelligence facts are ignored", () => {
    const p: StoredProperty = { state: "VIC", postcode: "3056", occupancy: null, is_residential: null, year_built: null,
      enrichment: { base44: { declared: { property_type: "House", over_five_years: "yes" }, research: { status: "complete", premises_classification: "commercial", address_ambiguous: true, recent_extension_detected: true }, raw: { answers: { insulation: "none" } } } } };
    const intel: IntelFact[] = [{ fact_key: "address_verified", value: false, evidence_kind: "direct", confidence: "high", source_type: "public_gis", source_name: "x", is_current: true, is_stale: false }];
    const x = evaluateGate1(resolveGate1Facts(p, { lifeSupportStatus: "no", preliminaryOutcome: null, referenceDate: "2026-10-05", areaUnknown: false }, 5, 2026, intel));
    expect(x.outcome).toBe("likely_eligible");
    expect(x.review).toHaveLength(0);
  });
});
