import { describe, expect, test } from "bun:test";
import { evaluateOwnerAnswers, validateOwnerAnswers, OWNER_QUESTIONS } from "../src/lib/owner-eligibility.core";
import { mittiAutoAssignDecision } from "../src/lib/mitti-autoassign.core";
const vic = { state: "VIC", postcode: "3550" };
const base = { property_type: "house", top_floor: "", over_five_years: "yes", insulation: "none", life_support: "no" };
const ev = (o: Record<string, string>) => evaluateOwnerAnswers({ ...base, ...o } as never, vic, 2026, "2026-10-05").result;

describe("owner eligibility link", () => {
  test("three results only", () => {
    expect(ev({})).toBe("likely_eligible");
    expect(ev({ insulation: "present" })).toBe("needs_onsite_confirmation");
    expect(ev({ insulation: "unknown" })).toBe("needs_onsite_confirmation");
    expect(ev({ over_five_years: "no" })).toBe("does_not_appear_eligible");
    expect(ev({ property_type: "other" })).toBe("does_not_appear_eligible");
    expect(ev({ property_type: "unit", top_floor: "unknown" })).toBe("needs_onsite_confirmation");
  });
  test("questions only — nothing to sign or consent to", () => {
    const text = JSON.stringify(OWNER_QUESTIONS).toLowerCase();
    for (const w of ["sign", "consent", "assign", "veec", "agree"]) expect(text).not.toContain(w);
  });
  test("every answer required; unit question only for units", () => {
    expect(typeof validateOwnerAnswers({ ...base, insulation: "" })).toBe("string");
    expect(validateOwnerAnswers(base)).toEqual(base as never);
    expect(typeof validateOwnerAnswers({ ...base, property_type: "unit" })).toBe("string");
  });
});

describe("automatic Mitti Ready Check form", () => {
  const d = (o: Partial<Parameters<typeof mittiAutoAssignDecision>[0]>) => mittiAutoAssignDecision({ channel: "installer_sourced", stage: "new_enquiry", tradeRole: "installer", measurementComplete: false, hasProfile: true, access: "member", email: "a@test.au", ...o });
  test("assigns for confirmed installer on installer-supplied job needing Ready Check", () => expect(d({}).action).toBe("assign"));
  test("flags when no Mitti access", () => {
    expect(d({ access: "not_found" }).action).toBe("flag");
    expect(d({ access: "unchecked" }).action).toBe("flag");
    expect(d({ hasProfile: false, access: null }).action).toBe("flag");
  });
  test("skips our own leads, electricians, finished Ready Checks", () => {
    expect(d({ channel: "hivic_sourced" }).action).toBe("skip");
    expect(d({ tradeRole: "electrician" }).action).toBe("skip");
    expect(d({ measurementComplete: true }).action).toBe("skip");
    expect(d({ stage: "cancelled" }).action).toBe("skip");
  });
});
