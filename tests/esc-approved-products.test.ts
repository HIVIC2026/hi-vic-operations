import { describe, expect, test } from "bun:test";
import { HISTORIC_APPROVED_PRODUCTS, modelsForStoredOption, ESC_APPROVED_PRODUCTS, activity48ProductProblems, modelsForMittiOption, productByCode, productLabel } from "../src/lib/esc-approved-products.core";
import { declaredProductProblems } from "../src/lib/install-evidence.core";
import { APPROVED_PRODUCTS } from "../src/lib/insulation-product.core";

describe("ESC Activity 48 register, 19 Oct 2026 (decision 149)", () => {
  test("31 unique models: 10 Bradford, 3 Earthwool, 18 Pink Batts (ECOWOOL excluded, Jo 2 Nov 2026)", () => {
    expect(ESC_APPROVED_PRODUCTS.length).toBe(31);
    expect(new Set(ESC_APPROVED_PRODUCTS.map((p) => p.code)).size).toBe(31);
    const count = (b: string) => ESC_APPROVED_PRODUCTS.filter((p) => p.brand === b).length;
    expect([count("Bradford"), count("Earthwool"), count("Pink Batts")]).toEqual([10, 3, 18]);
    expect(modelsForMittiOption("ECOWOOL R5")).toEqual([]);
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

describe("ECOWOOL: excluded for new jobs, still valid for existing jobs (Jo 2 Nov 2026)", () => {
  test("historic models validate by code and stored option; new-job paths never offer them", () => {
    expect(HISTORIC_APPROVED_PRODUCTS.map((p) => p.code)).toEqual(["602009", "602010"]);
    expect(productByCode("602009")?.brand).toBe("ECOWOOL");
    expect(activity48ProductProblems(["602009"], "2026-10-30")).toEqual([]);
    expect(modelsForStoredOption("ECOWOOL R5").length).toBe(2);
    expect(declaredProductProblems("ECOWOOL R5", { installDate: "2026-10-30", veecCreationDate: "2026-11-05" })).toEqual([]);
    expect(declaredProductProblems("ECOWOOL R5", { installDate: "2026-10-30", veecCreationDate: "2026-11-05" }, ["602009"])).toEqual([]);
    expect(modelsForMittiOption("ECOWOOL R5")).toEqual([]);
    expect(ESC_APPROVED_PRODUCTS.some((p) => p.brand === "ECOWOOL")).toBe(false);
    expect(APPROVED_PRODUCTS.some((p) => /ecowool/i.test(p.option))).toBe(false);
  });
});
