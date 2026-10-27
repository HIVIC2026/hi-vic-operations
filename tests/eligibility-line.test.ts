import { describe, expect, test } from "bun:test";
import { eligibilityLine } from "../src/lib/portal-presentation.core";

describe("eligibility line (Jo 27 Oct 2026, HV-3385)", () => {
  test("no 'Not answered' filler under a pass", () => {
    expect(eligibilityLine("pass", "Not answered / unknown", null)).toEqual({ mark: "pass", detail: null });
  });
  test("an office check not done is not shown as Pass", () => {
    expect(eligibilityLine("pass", "Not asked (question retired)", { mark: "confirm", text: "Office check not done" })).toEqual({ mark: "confirm", detail: "Office check not done" });
  });
  test("what was measured onsite wins", () => {
    expect(eligibilityLine(null, "Not answered / unknown", { mark: "pass", text: "Measured 75 m²" })).toEqual({ mark: "pass", detail: "Measured 75 m²" });
  });
  test("the owner's real answer is kept", () => {
    expect(eligibilityLine("pass", "VIC 3039", null)).toEqual({ mark: "pass", detail: "VIC 3039" });
  });
});
