import { describe, expect, test } from "bun:test";
import { evaluateGate1, resolveGate1Facts, type IntelFact, type StoredProperty } from "../src/lib/eligibility.core";

const prop = (declared: Record<string, unknown>, answers: Record<string, unknown> = { insulation: "none" }): StoredProperty => ({
  state: "VIC", postcode: "3058", occupancy: "owner_occupied", is_residential: null, year_built: null,
  enrichment: { base44: { declared: { basis: "owner_declaration", property_type: "house", over_five_years: "yes", previous_upgrade: "no", ...declared }, research: null, raw: { answers } } },
});
const job = { lifeSupportStatus: "no", preliminaryOutcome: null, referenceDate: "2026-10-05" };
const fact = (fact_key: string, value: unknown, trusted = true): IntelFact => ({ fact_key, value, evidence_kind: trusted ? "direct" : "inferred", confidence: trusted ? "high" : "low", source_type: trusted ? "public_gis" : "derived", source_name: "Vicmap", source_url: null, is_current: true, is_stale: false } as IntelFact);
const addr = [fact("address_verified", true), fact("in_victoria", true)];
const run = (p: StoredProperty, intel: IntelFact[] = addr) => evaluateGate1(resolveGate1Facts(p, job as never, 5, 2026, intel));
const r = (x: ReturnType<typeof run>, k: string) => x.rules.find((y) => y.key === k)!;

describe("Step 2 refinement: preliminary declared thresholds", () => {
  test("1. verified VIC address + owner house + no contrary class -> residential pass (declared)", () => {
    expect(r(run(prop({})), "residential")).toMatchObject({ result: "pass", basis: "declared" });
    expect(r(run(prop({ property_type: "townhouse" })), "residential").result).toBe("pass");
  });
  test.skip("RETIRED (simple Gate 1, 4 Oct 2026) – 2. owner house without verified address -> review", () => expect(r(run(prop({}), []), "residential").result).toBe("review"));
  test.skip("RETIRED (simple Gate 1, 4 Oct 2026) – 3. trusted contradictory class evidence -> review", () => {
    const x = run(prop({}), [...addr, fact("ncc_class_evidence", "not_eligible")]);
    expect(r(x, "residential").result).toBe("review"); expect(x.reviewRequired).toBe(true);
  });
  test.skip("RETIRED (simple Gate 1, 4 Oct 2026) – apartment still needs top-floor handling", () => expect(run(prop({ property_type: "apartment" })).reviewRequired).toBe(true));
  test("4. owner >5y yes + no contrary evidence -> age pass (declared)", () => expect(r(run(prop({})), "ceiling_age")).toMatchObject({ result: "pass", basis: "declared" }));
  test.skip("RETIRED (simple Gate 1, 4 Oct 2026) – 5. owner >5y yes + recent extension risk -> review", () => {
    const x = run(prop({}), [...addr, fact("recent_extension_or_added_storey_risk", "yes", false)]);
    expect(r(x, "ceiling_age").result).toBe("review"); expect(x.reviewRequired).toBe(true);
  });
  test.skip("RETIRED (simple Gate 1, 4 Oct 2026) – 6. owner >5y no/unknown -> review", () => {
    expect(r(run(prop({ over_five_years: "no" })), "ceiling_age").result).toBe("review");
    expect(r(run(prop({ over_five_years: "unknown" })), "ceiling_age").result).toBe("review");
  });
  test("7. insulation present + all remote rules pass -> needs onsite confirmation", () => {
    const x = run(prop({}, { insulation: "present" }));
    expect(x.outcome).toBe("needs_onsite_confirmation"); expect(x.reviewRequired).toBe(false);
    expect(r(x, "existing_insulation").result).toBe("onsite");
    expect(run(prop({})).outcome).toBe("likely_eligible");
  });
});

describe("confirmed previous Activity 48 provenance", () => {
  test("a confirmed record no longer fails or flags (previous upgrade is always no)", () => {
    const p = prop({});
    (p.enrichment as Record<string, unknown>)["previous_activity_48_confirmed"] = true;
    const x = run(p);
    expect(x.outcome).not.toBe("does_not_appear_eligible");
    expect(r(x, "previous_activity").result).toBe("pass");
  });
});

import { declaredExtras } from "../src/lib/enquiry.core";
import { resolveGate1Facts as _rf } from "../src/lib/eligibility.core";
const it = test;
describe("Step 1 → Step 2 mapping uses the same answer keys as the intake summary", () => {
  const prop = (answers: Record<string, unknown>) => ({ state: "VIC", postcode: "3058", occupancy: "owner_occupied", is_residential: null, year_built: null,
    enrichment: { base44: { declared: { property_type: "unit" }, raw: { answers } } } });
  const job = { lifeSupportStatus: "no", preliminaryOutcome: null, referenceDate: "2026-10-02", areaUnknown: false };
  for (const [k, v] of [["insulation", "present"], ["has_existing_insulation", "present"], ["current_insulation", "none"], ["declared_existing_insulation", false]] as const) {
    it(`insulation via ${k}`, () => {
      const f = _rf(prop({ [k]: v }) as never, job as never, 5, 2026);
      expect(f.declaredInsulation).toBe(v === false || v === "none" ? "none" : "present");
      expect(declaredExtras({ [k]: v }).existing_insulation).not.toBeNull();
    });
  }
  for (const k of ["top_floor", "declared_top_floor", "is_top_floor", "top_floor_unit", "top_storey"]) {
    it(`top floor via ${k}`, () => expect(_rf(prop({ [k]: "yes" }) as never, job as never, 5, 2026).declaredTopFloor).toBe("yes"));
  }
  it("empty Base44 top_floor stays unknown-null, not 'no'", () => expect(_rf(prop({ top_floor: "" }) as never, job as never, 5, 2026).declaredTopFloor).toBeNull());
});
