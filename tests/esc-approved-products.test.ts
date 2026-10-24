import { describe, expect, test } from "bun:test";
import { ESC_APPROVED_PRODUCTS, activity48ProductProblems, modelsForMittiOption, productByCode, productLabel } from "../src/lib/esc-approved-products.core";
import { APPROVED_PRODUCTS } from "../src/lib/insulation-product.core";

describe("ESC Activity 48 register, 19 Oct 2026 (decision 149)", () => {
  test("33 unique models: 10 Bradford, 3 Earthwool, 2 ECOWOOL, 18 Pink Batts", () => {
    expect(ESC_APPROVED_PRODUCTS.length).toBe(33);
    expect(new Set(ESC_APPROVED_PRODUCTS.map((p) => p.code)).size).toBe(33);
    const count = (b: string) => ESC_APPROVED_PRODUCTS.filter((p) => p.brand === b).length;
    expect([count("Bradford"), count("Earthwool"), count("ECOWOOL"), count("Pink Batts")]).toEqual([10, 3, 2, 18]);
    expect(productLabel(productByCode("467911")!)).toBe("CSR Bradford Gold Ceiling Batt — R5.0 — 1160 × 430 mm — 467911");
  });
  test("R5.0 minimum, combinations, register and dates", () => {
    expect(activity48ProductProblems(["467911"], "2026-11-01")).toEqual([]);
    expect(activity48ProductProblems(["4006102"], "2026-11-01")[0]).toContain("below the Activity 48 minimum of R5.0");
    expect(activity48ProductProblems(["4006098", "4006098"], "2026-11-01")).toEqual([]); // R2.5 + R2.5
    expect(activity48ProductProblems(["999"], "2026-11-01")[0]).toContain("not on the ESC approved list");
    expect(activity48ProductProblems(["2437543"], "2027-03-01")[0]).toContain("not approved on 2027-03-01");
    expect(activity48ProductProblems([], "2026-11-01")).toEqual(["No installed product recorded."]);
  });
  test("every Mitti tap option matches at least one register model at that R-value", () => {
    for (const o of APPROVED_PRODUCTS) {
      const m = modelsForMittiOption(o.option);
      expect(m.length).toBeGreaterThan(0);
      expect(m.every((p) => `R${p.rValue.toFixed(1)}` === o.rValue)).toBe(true);
    }
    expect(modelsForMittiOption("Fletchers Pink Batts R5").map((p) => p.code)).toEqual(["4006041", "4020598", "4006042", "4020599"]);
  });
});
