// Jo 4 Nov 2026: A1/A2 Ready Check ceiling layout, top-ups, approved products and quotes.
import { describe, expect, it } from "vitest";
import {
  LAYOUT_Q, LAYOUT_A, APPROVED_48A_PRODUCTS, approvedProduct, readLayoutArea, readLayoutOutcome, isLayoutForm,
  evaluateArea, priceA2Options, a1AreaChoices, validateA1Price, a1PriceLinkView, rLabel,
} from "@/lib/ceiling-layout.core";

const kids = (pairs: [string, string | null][]) => pairs.map(([label, value]) => ({ label, value }));
const retail = { r5: 30, topup: 22, r6: 33, r7: 35, removal: 15 };
const rates = { R5_BATTS: 18, TOPUP_R5: 14, R6_BATTS: 20, R7_BATTS: 22, REMOVAL: 9 };
const base = { brand: "Bradford Gold" as const, topupCountsExisting: true, gstRate: 0.1 };

describe("approved products (ESC register 26 Oct 2026, 48A)", () => {
  it("stores model numbers and resolves R4.0/R4.1 by brand", () => {
    expect(APPROVED_48A_PRODUCTS.find((p) => p.model === "467911")).toMatchObject({ brand: "Bradford Gold", r: 5 });
    expect(approvedProduct("Earthwool", 4.1)?.r).toBe(4);
    expect(approvedProduct("Pink Batts", 4.0)?.r).toBe(4.1);
    expect(approvedProduct("Earthwool", 6)).toBeNull();
    expect(approvedProduct("Ecowool", 3.5)).toBeNull();
    expect(approvedProduct("Ecowool", 5)?.models).toEqual(["602009", "602010"]);
  });
});

describe("reading the new answers", () => {
  it("reads a top-up area and ignores the old questions", () => {
    const a = readLayoutArea(kids([
      [LAYOUT_Q.areaName, "Main house"], [LAYOUT_Q.areaM2, "120"], [LAYOUT_Q.old, LAYOUT_A.topup],
      [LAYOUT_Q.oldR, "R1.5"], [LAYOUT_Q.batts, "R3.5 (makes R5.0)"],
    ]));
    expect(a).toMatchObject({ name: "Main house", m2: 120, old: "topup", oldR: 1.5, oldFailed: false, battsR: 3.5 });
    expect(isLayoutForm(kids([["Is there existing insulation in this ceiling area?", "Yes"]]))).toBe(false);
    expect(isLayoutForm(kids([[LAYOUT_Q.old, LAYOUT_A.none]]))).toBe(true);
  });
  it("reads the outcome page (thicker too, go ahead) and brand", () => {
    expect(readLayoutOutcome(kids([[LAYOUT_Q.goAhead, "Yes"], [LAYOUT_Q.thicker, "R7.0 total"], [LAYOUT_Q.brand, "Earthwool"]])))
      .toEqual({ goAhead: true, thicker: 7, brand: "Earthwool" });
  });
});

describe("rules", () => {
  const area = (o: Partial<ReturnType<typeof readLayoutArea>>) => ({ name: "Main", m2: 100, old: "none" as const, oldR: null, oldFailed: false, removeM2: null, battsR: 5, ...o });
  it("1: old R2.0 or more fails the area", () => {
    expect(evaluateArea(area({ old: "out", oldFailed: true }), base).reasons[0]).toMatch(/Main: old insulation is R2\.0 or more/);
  });
  it("2: total under R5.0 is not quoted", () => {
    expect(evaluateArea(area({ old: "topup", oldR: 0.5, battsR: 3.5 }), base).reasons[0]).toBe("Main: R3.5 over existing R0.5 = R4.0 total, under R5.0 – not quoted.");
  });
  it("3: brand + batt must be approved (Ecowool R3.5)", () => {
    expect(evaluateArea(area({ old: "topup", oldR: 1.5, battsR: 3.5 }), { ...base, brand: "Ecowool" }).reasons[0]).toMatch(/not an approved product/);
  });
  it("5: switch OFF sends a top-up batt under R5.0 to the office", () => {
    expect(evaluateArea(area({ old: "topup", oldR: 1.5, battsR: 3.5 }), { ...base, topupCountsExisting: false }).ok).toBe(false);
    expect(evaluateArea(area({ old: "topup", oldR: 1.5, battsR: 3.5 }), base)).toMatchObject({ ok: true, totalR: 5 });
  });
});

describe("A2 pricing", () => {
  const areas = [
    { name: "Main", m2: 120, old: "topup" as const, oldR: 1.5, oldFailed: false, removeM2: null, battsR: 3.5 },
    { name: "Extension", m2: 30, old: "out" as const, oldR: null, oldFailed: false, removeM2: 30, battsR: 5 },
  ];
  it("top-up uses the top-up retail price, pays TOPUP_R5, exact wording, separate removal line", () => {
    const r = priceA2Options({ ...base, areas, thicker: null, retail, installerRatesEx: rates });
    expect(r.reasons).toEqual([]);
    const main = r.options[0]!;
    expect(main.lines.map((l) => l.description)).toEqual([
      "R3.5 Bradford Gold batts over your existing R1.5 = R5.0 total – 120 m²",
      "R5.0 Bradford Gold ceiling batts – 30 m²",
      "Remove old insulation – 30 m²",
    ]);
    expect(main.lines[0]).toMatchObject({ code: "TOPUP_R5", unit_price_inc_gst: 22, line_total_inc_gst: 2640 });
    expect(main.installerCostEx).toBe(120 * 14 + 30 * 18 + 30 * 9);
    expect(main.lines.some((l) => /about|approx|around|~/i.test(l.description))).toBe(false);
  });
  it("blank retail price holds for office, never guessed", () => {
    const r = priceA2Options({ ...base, areas, thicker: null, retail: { ...retail, topup: null }, installerRatesEx: rates });
    expect(r.options).toEqual([]);
    expect(r.reasons[0]).toMatch(/top-up retail price is not set/i);
  });
  it("thicker too builds a second R6.0 option at R6 retail with the same brand", () => {
    const r = priceA2Options({ ...base, areas, thicker: 6, retail, installerRatesEx: rates });
    expect(r.options).toHaveLength(2);
    expect(r.options[1]!.lines[0]!.description).toBe("R5.0 Bradford Gold batts over your existing R1.5 = R6.5 total – 120 m²");
    expect(r.options[1]!.lines[0]).toMatchObject({ code: "R6_BATTS", unit_price_inc_gst: 33 });
  });
  it("4: Earthwool can't reach R6.0 → no thicker option, office told why", () => {
    const r = priceA2Options({ ...base, brand: "Earthwool", areas: [{ ...areas[1]!, battsR: 5 }], thicker: 6, retail, installerRatesEx: rates });
    expect(r.options).toHaveLength(1);
    expect(r.reasons[0]).toMatch(/Earthwool can't reach R6\.0/);
  });
});

describe("A1 business-owner price link", () => {
  const area = { name: "Main", m2: 120, old: "topup" as const, oldR: 1.5, oldFailed: false, removeM2: null, battsR: null };
  it("offers only approved choices that reach the total, labelled with the total", () => {
    const c = a1AreaChoices(area, 5).map((x) => x.label);
    expect(c).toContain("Bradford Gold R3.5 over existing R1.5 = R5.0 total");
    expect(c).not.toContain("Pink Batts R3.0 over existing R1.5 = R4.5 total");
    expect(a1AreaChoices(area, 7).every((x) => x.brand !== "Earthwool")).toBe(true);
  });
  it("needs one main total, and a thicker total only when asked", () => {
    const pick = { brand: "Bradford Gold" as const, r: 3.5 };
    expect(validateA1Price({ areas: [area], thicker: null, mainPicks: [pick], mainTotal: 3000 })).toEqual([]);
    expect(validateA1Price({ areas: [area], thicker: 6, mainPicks: [pick], mainTotal: 3000 })[0]).toMatch(/thicker/i);
    expect(validateA1Price({ areas: [area], thicker: null, mainPicks: [{ brand: "Pink Batts", r: 3.0 }], mainTotal: 3000 })[0]).toMatch(/R4\.5/);
  });
  it("view lists every area's facts and the thicker request", () => {
    const v = a1PriceLinkView([{ ...area, old: "out", oldR: null, removeM2: 120 }], 6);
    expect(v.areas[0]).toMatchObject({ facts: "120 m² · old insulation: taking it out (under R2.0) · 120 m² removed" });
    expect(v.thicker).toBe("The owner also wants a price for R6.0 total.");
    expect(rLabel(5)).toBe("R5.0");
  });
});

import { parseAudit } from "@/lib/mitti.core";
describe("Mitti reader on the 4 Nov wording", () => {
  const audit = (area: [string, string][], top: [string, string][] = []) => ({
    audit_id: "a1", items: [
      ...top.map(([label, response], k) => ({ item_id: `t${k}`, label, type: "text", responses: { text: response } })),
      { item_id: "g1", label: "Add a ceiling area", type: "section", items: area.map(([label, response], k) => ({ item_id: `g1-${k}`, label, type: "text", responses: { text: response } })) },
    ],
  });
  it("taking out → removal with that m², and old R2.0 or more is flagged", () => {
    const r = parseAudit(audit([[LAYOUT_Q.areaM2, "80"], [LAYOUT_Q.old, LAYOUT_A.out], [LAYOUT_Q.oldR, "R2.0 or more"], [LAYOUT_Q.removeM2, "80"], ["What type of existing insulation is installed? Select all that apply", "Batts"]]));
    expect(r.patch.removal_required).toBe(true);
    expect(r.patch.removal_m2).toBe(80);
    expect(r.issues.join(" ")).toMatch(/R2\.0 or more – fails/);
    expect(r.areas[0]?.layout?.old).toBe("out");
  });
  it("Can the job go ahead? No is a failed Ready Check", () => {
    const r = parseAudit(audit([[LAYOUT_Q.areaM2, "80"], [LAYOUT_Q.old, LAYOUT_A.none]], [[LAYOUT_Q.goAhead, "No"]]));
    expect(r.issues.join(" ")).toMatch(/marked the Ready Check as failed/);
    expect(r.patch.removal_required).toBe(false);
  });
});

import { assembleLayoutQuote } from "@/lib/ceiling-layout.core";
describe("assembling each option", () => {
  const lines = [{ code: "TOPUP_R5", description: "x", quantity: 100, unit: "m2" as const, unit_price_inc_gst: 22, line_total_inc_gst: 2200, is_other: false as const, explanation: null }];
  const base = { label: "R5.0 total ceiling insulation", insulationLines: lines, piesaIncGst: 349, apFeeIncGst: 349, apFeeDescription: "AP", minimumCopayIncGst: 200, tolerancePct: 15 };
  it("VEU discount worked out per option, $200 minimum kept", () => {
    const a = assembleLayoutQuote({ ...base, veuRawDiscount: 1000, estimateTotal: null });
    expect(a).toMatchObject({ subtotalIncGst: 2898, veuDiscountIncGst: 1000, customerTotalIncGst: 1898 });
    expect(assembleLayoutQuote({ ...base, veuRawDiscount: 5000, estimateTotal: null }).customerTotalIncGst).toBe(200);
  });
  it("more than 15% off the owner's estimate is held", () => {
    expect(assembleLayoutQuote({ ...base, veuRawDiscount: 1000, estimateTotal: 1898 / 1.16 }).holds[0]).toMatch(/more than 15%/);
    expect(assembleLayoutQuote({ ...base, veuRawDiscount: 1000, estimateTotal: 1898 / 1.14 }).holds).toEqual([]);
  });
});
