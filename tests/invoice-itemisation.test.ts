// Decision 209 (Jo 24 Oct 2026): tax-invoice itemisation to Activity Guide v1.2 Table 4. Pure tests, no database.
import { describe, expect, test } from "bun:test";
import { insulationLine, insulationLineWithCodes, itemiseInvoiceLines, knownEscModelCodes, missingProductFacts, INVOICE_PRODUCT_NEEDS_OFFICE } from "../src/lib/invoice-itemisation.core";
import { APPROVED_PRODUCTS } from "../src/lib/insulation-product.core";
import { modelsForMittiOption } from "../src/lib/esc-approved-products.core";

describe("insulation line wording", () => {
  test("brand, model (register name), R-value and m² from the declared option and the Ready Check area", () => {
    expect(insulationLine({ product: { option: "Bradford Gold R5", rValue: "R5.0" }, areaM2: 137.6 })?.description).toBe("Ceiling insulation — CSR Bradford Gold Ceiling Batt R5.0 — 137.6 m²");
    expect(insulationLine({ product: { option: "Fletchers Pink Batts R6", rValue: "R6.0" }, areaM2: 120 })?.description).toBe("Ceiling insulation — PINK® Batts Ceiling Insulation R6.0 — 120 m²");
    expect(insulationLine({ product: { option: "Earthwool R5", rValue: "R5.0" }, areaM2: 99.456 })?.description).toBe("Ceiling insulation — Earthwool Ceiling batt R5.0 — 99.46 m²");
    expect(insulationLine({ product: { option: "ECOWOOL R5", rValue: "R5.0" }, areaM2: 80 })?.description).toBe("Ceiling insulation — ECOWOOL ® Insulation R5.0 — 80 m²");
  });
  test("every approved tap option renders without a placeholder", () => {
    for (const p of APPROVED_PRODUCTS) {
      const l = insulationLine({ product: p, areaM2: 100 })!;
      expect(l.description).toMatch(/^Ceiling insulation — .+ R[567]\.0 — 100 m²$/);
      expect(l.description).not.toMatch(/undefined|null/);
    }
  });
  test("unknown product or area is never invented", () => {
    expect(insulationLine({ product: null, areaM2: 100 })).toBeNull();
    expect(insulationLine({ product: { option: "Bradford Gold R5", rValue: "R5.0" }, areaM2: null })).toBeNull();
    expect(insulationLine({ product: { option: "Bradford Gold R5", rValue: "R5.0" }, areaM2: 0 })).toBeNull();
    expect(missingProductFacts({ product: null, areaM2: null })).toEqual(["insulation product not recorded on the job", "ceiling area not measured"]);
  });
});

describe("exact ESC model codes", () => {
  test("supplied codes (install evidence / VEEC form) win; otherwise only a one-model option yields a code", () => {
    expect(knownEscModelCodes("Bradford Gold R5", ["467912", "467912"])).toEqual(["467912"]);
    expect(modelsForMittiOption("Earthwool R5").length).toBe(1);
    expect(knownEscModelCodes("Earthwool R5", [])).toEqual(["2437543"]);
    expect(modelsForMittiOption("Bradford Gold R5").length).toBe(2); // 430 and 580 mm widths: not known from the option alone
    expect(knownEscModelCodes("Bradford Gold R5", null)).toEqual([]);
    expect(knownEscModelCodes(null, undefined)).toEqual([]);
  });
  test("owner wording appends the codes only when known", () => {
    const l = insulationLine({ product: { option: "Earthwool R5", rValue: "R5.0" }, areaM2: 120 })!;
    expect(insulationLineWithCodes(l)).toBe("Ceiling insulation — Earthwool Ceiling batt R5.0 — 120 m² (ESC model 2437543)");
    const b = insulationLine({ product: { option: "Bradford Gold R7", rValue: "R7.0" }, areaM2: 120 })!;
    expect(insulationLineWithCodes(b)).toBe("Ceiling insulation — CSR Bradford Gold Ceiling Batt R7.0 — 120 m²");
    expect(insulationLineWithCodes({ ...b, escModelCodes: ["467961", "467962"] })).toBe("Ceiling insulation — CSR Bradford Gold Ceiling Batt R7.0 — 120 m² (ESC model 467961, 467962)");
  });
});

describe("itemising the accepted quote lines", () => {
  const facts = { product: { option: "Bradford Gold R6", rValue: "R6.0" as const }, areaM2: 137.6 };
  test("our rate-card line (R*_BATTS) is re-worded; amounts and every other line untouched", () => {
    const items = [
      { code: "R6_BATTS", description: "Supply and install of Bradford Gold R6 ceiling insulation", quantity: 137.6, unit_price_inc_gst: 22.5, line_total_inc_gst: 3096, sort: 0 },
      { code: "REMOVAL", description: "Removal & disposal of existing insulation", quantity: 40, unit_price_inc_gst: 15, line_total_inc_gst: 600, sort: 1 },
      { code: "PIESA", description: "Mandatory Pre Insulation Electrical Safety Assessment (PIESA)", quantity: 1, unit_price_inc_gst: 349, line_total_inc_gst: 349, sort: 2 },
    ];
    const r = itemiseInvoiceLines(items, facts);
    expect(r.officeFlag).toBeNull();
    expect(r.items[0]).toEqual({ ...items[0]!, description: "Ceiling insulation — CSR Bradford Gold Ceiling Batt R6.0 — 137.6 m²" });
    expect(r.items.slice(1)).toEqual(items.slice(1));
    expect(r.items.reduce((s, i) => s + i.line_total_inc_gst, 0)).toBe(items.reduce((s, i) => s + i.line_total_inc_gst, 0));
  });
  test("installer A1 line keeps its removal / difficult-access suffix", () => {
    const items = [{ code: "INSTALLER_PRICE", description: "Supply and install of Bradford Gold R6 ceiling insulation – 137.6 m² · Removal of existing insulation – 40 m² · Includes difficult access", quantity: 1, unit_price_inc_gst: 3600, line_total_inc_gst: 3600 }];
    expect(itemiseInvoiceLines(items, facts).items[0]!.description).toBe("Ceiling insulation — CSR Bradford Gold Ceiling Batt R6.0 — 137.6 m² · Removal of existing insulation – 40 m² · Includes difficult access");
  });
  test("legacy lines without a code are matched by wording only", () => {
    const items = [{ code: null, description: "R5.0 ceiling insulation supply & install", quantity: 100, unit_price_inc_gst: 20, line_total_inc_gst: 2000 }, { code: null, description: "Accredited Provider fee", quantity: 1, unit_price_inc_gst: 349, line_total_inc_gst: 349 }];
    const r = itemiseInvoiceLines(items, { product: { option: "ECOWOOL R5", rValue: "R5.0" }, areaM2: 100 });
    expect(r.items.map((i) => i.description)).toEqual(["Ceiling insulation — ECOWOOL ® Insulation R5.0 — 100 m²", "Accredited Provider fee"]);
  });
  test("unknown facts: rate-card wording kept and the office item raised; no insulation line: nothing to flag", () => {
    const items = [{ code: "R5_BATTS", description: "R5.0 ceiling insulation supply & install", quantity: 100, unit_price_inc_gst: 20, line_total_inc_gst: 2000 }];
    const r = itemiseInvoiceLines(items, { product: null, areaM2: 100 });
    expect(r.items).toEqual(items);
    expect(r.officeFlag).toBe(INVOICE_PRODUCT_NEEDS_OFFICE);
    expect(itemiseInvoiceLines([{ code: "AP_FEE", description: "Accredited Provider fee", quantity: 1, unit_price_inc_gst: 349, line_total_inc_gst: 349 }], { product: null, areaM2: null }).officeFlag).toBeNull();
  });
});
