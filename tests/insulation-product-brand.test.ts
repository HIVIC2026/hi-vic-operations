import { describe, expect, test } from "bun:test";
import { APPROVED_PRODUCTS, productBrandModel } from "../src/lib/insulation-product.core";

describe("VEEC brand/model from approved products (decision 148)", () => {
  test("every approved option maps to a brand and model", () => {
    expect(APPROVED_PRODUCTS.map((p) => [p.option, productBrandModel(p)])).toEqual([
      ["Bradford Gold R5", { brand: "CSR Bradford", model: "Gold Ceiling Batt" }], ["Bradford Gold R6", { brand: "CSR Bradford", model: "Gold Ceiling Batt" }], ["Bradford Gold R7", { brand: "CSR Bradford", model: "Gold Ceiling Batt" }],
      ["Fletchers Pink Batts R5", { brand: "PINK® Batts", model: "Ceiling Insulation" }], ["Fletchers Pink Batts R6", { brand: "PINK® Batts", model: "Ceiling Insulation" }], ["Fletchers Pink Batts R7", { brand: "PINK® Batts", model: "Ceiling Insulation" }],
      ["Earthwool R5", { brand: "Earthwool", model: "Ceiling batt" }],
    ]);
  });
});
