import { describe, expect, test } from "bun:test";
import { evaluateGate1, geocodedVicMatch, resolveGate1Facts, type IntelFact, type StoredProperty } from "../src/lib/eligibility.core";

const prop = (o: { fa?: string; pc?: string; ins?: string; type?: string; research?: Record<string, unknown> } = {}): StoredProperty => ({
  state: "VIC", postcode: o.pc ?? "3336", occupancy: "owner_occupied", is_residential: null, year_built: null,
  enrichment: { base44: {
    declared: { property_type: o.type ?? "house", over_five_years: "yes", previous_upgrade: "no" },
    research: { status: "partial", premises_classification: "unknown", formatted_address: o.fa ?? "30 Dash St, Fraser Rise VIC 3336", ...(o.research ?? {}) },
    raw: { answers: { insulation: o.ins ?? "none" } },
  } },
});
const job = { lifeSupportStatus: "no" as const, preliminaryOutcome: null, referenceDate: "2026-10-05" };
const run = (p: StoredProperty, intel?: IntelFact[]) => evaluateGate1(resolveGate1Facts(p, job, 5, 2026, intel));
const res = (x: ReturnType<typeof run>) => x.rules.find((r) => r.key === "residential")!;

describe("Gate 1 residential: geocoded VIC address + owner-declared house", () => {
  test("house + VIC 3336 + formatted VIC 3336 + premises unknown -> residential PASS (declared), likely eligible", () => {
    const x = run(prop());
    expect(res(x).result).toBe("pass");
    expect(res(x).basis).toBe("declared");
    expect(x.outcome).toBe("likely_eligible");
    expect(x.reviewRequired).toBe(false);
  });
  test("formatted address postcode differs -> review required", () => {
    const x = run(prop({ fa: "12 Smith St, Collingwood VIC 3066", pc: "3065" }));
    expect(res(x).result).toBe("review");
    expect(x.outcome).toBeNull();
    expect(x.reviewRequired).toBe(true);
  });
  test("research non-residential contradiction still reviews", () => {
    const x = run(prop({ research: { status: "complete", premises_classification: "Commercial warehouse" } }));
    expect(res(x).result).toBe("review");
    expect(x.reviewRequired).toBe(true);
  });
  test("verified non-residential (recorded) still fails", () => {
    const p = prop(); p.is_residential = false;
    expect(run(p).outcome).toBe("does_not_appear_eligible");
  });
  test("insulation present on clean matching address -> needs onsite", () => {
    expect(run(prop({ ins: "present" })).outcome).toBe("needs_onsite_confirmation");
  });
  test("non-residential owner declaration stays review", () => {
    const x = run(prop({ type: "non_residential" }));
    expect(x.reviewRequired).toBe(true); expect(x.outcome).toBeNull();
  });
  test("apartment logic unchanged", () => {
    expect(run(prop({ type: "apartment" })).reviewRequired).toBe(true);
  });
  test("geocodedVicMatch parsing", () => {
    expect(geocodedVicMatch("30 Dash St, Fraser Rise VIC 3336, Australia", "3336")).toMatchObject({ match: true, conflict: false });
    expect(geocodedVicMatch("1 George St, Sydney NSW 2000", "3336")).toMatchObject({ match: false, conflict: false });
    expect(geocodedVicMatch(null, "3336").match).toBe(false);
  });
});
