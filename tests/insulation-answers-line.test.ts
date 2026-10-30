import { describe, expect, test } from "bun:test";
import { declaredInsulationDetail, insulationAnswersLine } from "../src/lib/enquiry.core";

const line = (a: Record<string, unknown> | null) => insulationAnswersLine(declaredInsulationDetail(a));

describe("Jo 28 Oct: website insulation answers shown on the job", () => {
  test("short form, in question order", () => {
    expect(line({ insulation_type: "loose_fill", insulation_thickness: "thin", insulation_coverage: "whole" })).toBe("Loose fill · Thin · Whole ceiling");
    expect(line({ insulation_type: "batts", insulation_thickness: "hand", insulation_coverage: "partial" })).toBe("Batts · About a hand's width · Only some areas");
    expect(line({ insulation_type: "foil", insulation_thickness: "thicker", insulation_coverage: "whole" })).toBe("Foil · Thicker than a hand · Whole ceiling");
  });
  test("Not sure answers show as Not sure", () => {
    expect(line({ insulation_type: "unknown", insulation_thickness: "unknown", insulation_coverage: "unknown" })).toBe("Not sure · Not sure · Not sure");
  });
  test("nothing answered → no line", () => {
    expect(line(null)).toBeNull();
    expect(line({ insulation: "none" })).toBeNull();
  });
  test("a missing answer is left out rather than shown as blank", () => {
    expect(line({ insulation_type: "batts", insulation_coverage: "whole" })).toBe("Batts · Whole ceiling");
  });
});
