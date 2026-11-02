import { describe, expect, test } from "bun:test";
import { DISPLAY_NAME_KEEP_UPPER, displayName } from "../src/lib/display-name.core";

describe("displayName", () => {
  test("all-caps business and owner names show in normal case", () => {
    expect(displayName("RAPID INSULATION")).toBe("Rapid Insulation");
    expect(displayName("WAYNE WILSON")).toBe("Wayne Wilson");
    expect(displayName("O'BRIEN MCDONALD")).toBe("O'Brien McDonald");
  });
  test("collapses extra spaces", () => {
    expect(displayName("  WAYNE   WILSON ")).toBe("Wayne Wilson");
    expect(displayName("Wayne   wilson")).toBe("Wayne wilson");
  });
  test("mixed case is left alone", () => {
    expect(displayName("INSolation")).toBe("INSolation");
    expect(displayName("Wayne wilson")).toBe("Wayne wilson");
  });
  test("keeps known capitals", () => {
    expect(displayName("RAPID INSULATION PTY LTD")).toBe("Rapid Insulation PTY LTD");
    expect(displayName("ABN HVAC AC SERVICES VIC")).toBe("ABN HVAC AC Services VIC");
    expect([...DISPLAY_NAME_KEEP_UPPER].sort()).toEqual(
      ["ABN", "AC", "ACT", "EEC", "HVAC", "LTD", "NSW", "PTY", "QLD", "REC", "VIC"].sort(),
    );
  });
  test("empty values", () => {
    expect(displayName(null)).toBe("");
    expect(displayName(undefined)).toBe("");
    expect(displayName("")).toBe("");
  });
  test("symbols and digits", () => {
    expect(displayName("J & K INSULATION")).toBe("J & K Insulation");
    expect(displayName("3D INSULATION")).toBe("3D Insulation");
  });
});
