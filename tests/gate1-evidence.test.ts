import { describe, expect, test } from "bun:test";
import { evaluateGate1, resolveGate1Facts, type StoredProperty } from "../src/lib/eligibility.core";
import { buildBase44Evidence } from "../src/lib/enquiry.core";

const Y = 2026;
const prop = (enrichment: Record<string, unknown> | null, over: Partial<StoredProperty> = {}): StoredProperty =>
  ({ state: null, postcode: "3056", occupancy: "owner_occupied", is_residential: null, year_built: null, enrichment, ...over });
const job = { lifeSupportStatus: "no", preliminaryOutcome: null };
const research = { status: "complete", state: "vic", postcode: "3056", formatted_address: "1 Test St, Brunswick VIC 3056", premises_classification: "Residential dwelling", first_appearance_year: 2001, age_evidence_source: "historical imagery" };
const decide = (b: ReturnType<typeof buildBase44Evidence>, over: Partial<StoredProperty> = {}) => evaluateGate1(resolveGate1Facts(prop({ base44: b }, over), job, 5, Y));

describe("Base44 Gate 1 evidence", () => {
  test("declarations are stored as declared, never verified", () => {
    const b = buildBase44Evidence({ declared_property_type: "house", declared_over_five_years: "yes", declared_previous_upgrade: "no" });
    expect(b.declared.basis).toBe("owner_declaration");
    expect(b.research).toBeNull();
    const d = decide(b);
    expect(d.outcome).toBeNull();
    expect(d.rules.find((r) => r.key === "building_age")).toMatchObject({ basis: "declared", result: "review" });
    expect(d.rules.find((r) => r.key === "residential")).toMatchObject({ basis: "declared", result: "review" });
  });
  test("complete research + consistent declarations auto-pass with per-rule provenance", () => {
    const d = decide(buildBase44Evidence({ declared_property_type: "house", declared_over_five_years: "yes", declared_previous_upgrade: "no", property_research: research }));
    expect(d.outcome).toBe("likely_eligible");
    expect(d.rules.find((r) => r.key === "building_age")).toMatchObject({ basis: "verified", result: "pass" });
    expect(d.rules.find((r) => r.key === "location")).toMatchObject({ basis: "verified", result: "pass" });
    expect(d.rules.find((r) => r.key === "previous_upgrade")).toMatchObject({ basis: "declared", result: "pass" });
  });
  test("incomplete research never verifies age", () => {
    const b = buildBase44Evidence({ declared_property_type: "house", declared_previous_upgrade: "no", property_research: { ...research, status: "pending" } });
    expect(b.research?.age_verified).toBe(false);
    expect(decide(b).outcome).toBeNull();
  });
  test("recent first appearance is review, not fail", () => {
    const d = decide(buildBase44Evidence({ declared_property_type: "house", declared_previous_upgrade: "no", property_research: { ...research, first_appearance_year: 2024 } }));
    expect(d.outcome).toBeNull();
  });
  test("type conflict or non-residential research -> review, not auto-fail", () => {
    expect(decide(buildBase44Evidence({ declared_property_type: "office", declared_previous_upgrade: "no", property_research: research })).outcome).toBeNull();
    expect(decide(buildBase44Evidence({ declared_property_type: "house", declared_previous_upgrade: "no", property_research: { ...research, premises_classification: "Commercial" } })).outcome).toBeNull();
  });
  test("explicit flat roof detection -> review; mapped non-VIC address -> fail", () => {
    expect(decide(buildBase44Evidence({ declared_property_type: "house", declared_previous_upgrade: "no", property_research: { ...research, flat_roof_detected: true } })).outcome).toBeNull();
    expect(decide(buildBase44Evidence({ declared_property_type: "house", declared_previous_upgrade: "no", property_research: { ...research, state: "NSW" } }), { postcode: null }).outcome).toBe("does_not_appear_eligible");
  });
  test("owner yes to previous upgrade -> review; unknown -> review", () => {
    expect(decide(buildBase44Evidence({ declared_property_type: "house", declared_previous_upgrade: "yes", property_research: research })).outcome).toBeNull();
    expect(decide(buildBase44Evidence({ declared_property_type: "house", declared_previous_upgrade: "unknown", property_research: research })).outcome).toBeNull();
  });
  test("recorded portal facts take precedence over Base44", () => {
    const d = decide(buildBase44Evidence({ declared_property_type: "house", declared_previous_upgrade: "no", property_research: research }), { is_residential: false });
    expect(d.outcome).toBe("does_not_appear_eligible");
    expect(d.rules.find((r) => r.key === "residential")?.source).toBe("properties.is_residential");
  });
});

describe("approved Gate 1 business rules", () => {
  test("owner NO to previous upgrade passes on its own, stays declared", () => {
    const r = decide(buildBase44Evidence({ declared_property_type: "house", declared_previous_upgrade: "no", property_research: research })).rules.find((x) => x.key === "previous_upgrade")!;
    expect(r).toMatchObject({ result: "pass", basis: "declared" });
    expect(r.basis).not.toBe("verified");
  });
  test("minimum building age is 5 years", () => {
    expect(decide(buildBase44Evidence({ declared_property_type: "house", declared_previous_upgrade: "no", property_research: { ...research, first_appearance_year: Y - 3 } })).outcome).toBeNull();
    expect(decide(buildBase44Evidence({ declared_property_type: "house", declared_previous_upgrade: "no", property_research: { ...research, first_appearance_year: Y - 6 } })).rules.find((x) => x.key === "building_age")!.result).toBe("pass");
  });
});
