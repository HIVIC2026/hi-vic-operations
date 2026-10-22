import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { priceHivQuote } from "../src/lib/hiv-quote.core";

// TEST Alpha agreed rates (ex GST): R5 $11.50/m², batts removal $4.00/m²; no travel item.
const base = { areaM2: 150, removalM2: 0, accessMultiplier: 1, ownerR5IncPerM2: 30, ownerRemovalIncPerM2: 15, piesaIncGst: 349, apFeeIncGst: 349, gstRate: 0.1, installerR5ExPerM2: 11.5, installerRemovalExPerM2: 4, installerTravelEx: null };

describe("HIV fixed owner price quotes", () => {
  test("150 m² TEST Alpha: owner $30/m², PIESA and AP fee separate, markup = ($30 − $12.65) × 150", () => {
    const q = priceHivQuote(base);
    expect(q.lines.map((l) => [l.code, l.line_total_inc_gst])).toEqual([["R5_BATTS", 4500], ["PIESA", 349], ["AP_FEE", 349]]);
    expect(q.installerMarkup.installerR5IncPerM2).toBe(12.65);
    expect(q.installerMarkup.markupInc).toBe(2602.5);
  });
  test("same owner price whichever installer", () => {
    const a = priceHivQuote(base), c = priceHivQuote({ ...base, installerR5ExPerM2: 10.75 });
    expect(a.lines[0]!.unit_price_inc_gst).toBe(30); expect(c.lines[0]!.unit_price_inc_gst).toBe(30);
    expect(c.installerMarkup.markupInc).toBeGreaterThan(a.installerMarkup.markupInc);
  });
  test("removal at $15/m² owner price, markup = $15 − installer rate inc GST", () => {
    const q = priceHivQuote({ ...base, removalM2: 40 });
    expect(q.lines.find((l) => l.code === "REMOVAL")!.line_total_inc_gst).toBe(600);
    expect(q.installerMarkup.removalMarkupInc).toBe(r(40 * (15 - 4.4)));
  });
  test("access loading uses the estimate's owner multiplier", () => {
    expect(priceHivQuote({ ...base, accessMultiplier: 1.25 }).lines[0]!.unit_price_inc_gst).toBe(37.5);
  });
  test("missing or too-high agreed rates stop quoting", () => {
    expect(() => priceHivQuote({ ...base, installerR5ExPerM2: null })).toThrow("no agreed R5.0 rate");
    expect(priceHivQuote({ ...base, installerR5ExPerM2: 28 }).holdReasons).toEqual(["This installer's agreed R5.0 rate is above the owner price – office review needed."]);
    expect(() => priceHivQuote({ ...base, removalM2: 10, installerRemovalExPerM2: null })).toThrow("removal rate");
  });
  test("builder refuses installer-supplied jobs; 12% margin no longer used for new quotes; no lead fee note", () => {
    const src = readFileSync("src/lib/quotes.server.ts", "utf8");
    const gen = src.slice(src.indexOf("export async function generateInstallerQuotes"), src.indexOf("/** Derive rectification"));
    expect(gen).toContain('channel === "installer_sourced" || jobRow.installer_led');
    expect(gen).not.toContain("ap_margin_pct");
    expect(gen).not.toContain("priceInstallerOption(");
    expect(readFileSync("src/config/workflow-decisions.ts", "utf8")).not.toContain("only_if_in_current_signed_installer_agreement");
  });
});
const r = (n: number) => Math.round(n * 100) / 100;

describe("owner price by R-value (Jo 22 Oct 2026)", () => {
  const p = { brand: "Earthwool" as const, productName: null };
  test("R5.0 stays $30/m²", () => { expect(priceHivQuote({ ...base, rValue: "R5.0" }).lines[0]!.unit_price_inc_gst).toBe(30); });
  test("R6.0 uses $32/m² and the installer's R6 rate", () => {
    const q = priceHivQuote({ ...base, rValue: "R6.0", installerRExPerM2: 20, product: { ...p, rValue: "R6.0" } });
    expect(q.lines[0]).toMatchObject({ code: "R6_BATTS", unit_price_inc_gst: 32, line_total_inc_gst: 4800, description: "Supply and install of Earthwool R6.0 ceiling insulation" });
    expect(q.holdReasons).toEqual([]);
    expect(q.installerMarkup.markupInc).toBe(r(150 * (32 - 22)));
  });
  test("R7.0 uses $33/m²", () => { expect(priceHivQuote({ ...base, rValue: "R7.0", installerRExPerM2: 20 }).lines[0]!.unit_price_inc_gst).toBe(33); });
  test("removal, access loading and fees unchanged at R7.0", () => {
    const q = priceHivQuote({ ...base, rValue: "R7.0", installerRExPerM2: 20, removalM2: 40, accessMultiplier: 1.25 });
    expect(q.lines.map((l) => [l.code, l.unit_price_inc_gst])).toEqual([["R7_BATTS", 41.25], ["REMOVAL", 15], ["PIESA", 349], ["AP_FEE", 349]]);
  });
  test("Hic-style R6 $35 / R7 $40 inc GST above owner $32 / $33 → held for office review", () => {
    expect(priceHivQuote({ ...base, rValue: "R6.0", installerRExPerM2: 35 / 1.1 }).holdReasons).toEqual(["This installer's agreed R6.0 rate is above the owner price – office review needed."]);
    expect(priceHivQuote({ ...base, rValue: "R7.0", installerRExPerM2: 40 / 1.1 }).holdReasons).toEqual(["This installer's agreed R7.0 rate is above the owner price – office review needed."]);
  });
  test("no agreed R6 rate stops quoting", () => { expect(() => priceHivQuote({ ...base, rValue: "R6.0", installerRExPerM2: null })).toThrow("no agreed R6.0 rate"); });
});
