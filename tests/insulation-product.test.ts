import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { contactAnswersFromEntries } from "../src/lib/mitti.core";
import { resolveMittiProduct, PRODUCT_NEEDS_OFFICE } from "../src/lib/insulation-product.core";
import { applyMittiProduct } from "../src/lib/mitti-installer-quote.core";
import { priceHivQuote } from "../src/lib/hiv-quote.core";

const read = (e: { label: string; value: string | null }[]) => resolveMittiProduct(contactAnswersFromEntries(e).productOption);
const draft = () => ({ ready: true, blockers: [] as string[], lines: [{ code: "INSTALLER_PRICE", description: "Installer price", explanation: null }] });
const base = { areaM2: 100, removalM2: 0, ownerR5IncPerM2: 30, ownerRemovalIncPerM2: 15, piesaIncGst: 349, apFeeIncGst: 349, gstRate: 0.1, installerR5ExPerM2: 11.5, installerRemovalExPerM2: 4, installerTravelEx: null, installerRExPerM2: 20 };

const SIX = [
  ["Bradford Gold R5", "R5.0", 30, "R5_BATTS"], ["Bradford Gold R6", "R6.0", 33, "R6_BATTS"], ["Bradford Gold R7", "R7.0", 35, "R7_BATTS"],
  ["Fletchers Pink Batts R5", "R5.0", 30, "R5_BATTS"], ["Fletchers Pink Batts R6", "R6.0", 33, "R6_BATTS"], ["Fletchers Pink Batts R7", "R7.0", 35, "R7_BATTS"],
] as const;

describe("Insulation product — 6 approved options (Jo 22 Oct 23:45)", () => {
  for (const [label, rValue, owner, code] of SIX) {
    test(`${label}: ${rValue}, $${owner}/m², full label on the quote line`, () => {
      const r = read([{ label: "insulation PRODUCT", value: label }]); // label match is case-insensitive
      expect(r.ready).toBe(true); expect(r.product).toEqual({ option: label, rValue });
      expect(applyMittiProduct(draft(), r, 120).lines[0]!.description).toBe(`Supply and install of ${label} ceiling insulation – 120 m²`);
      const q = priceHivQuote({ ...base, rValue: r.product!.rValue, product: r.product });
      expect(q.lines[0]).toMatchObject({ code, unit_price_inc_gst: owner, description: `Supply and install of ${label} ceiling insulation` });
    });
  }
  test("missing answer holds the quote with the office item", () => {
    const d = applyMittiProduct(draft(), read([{ label: "Insulation product", value: null }]), 150);
    expect(d.ready).toBe(false); expect(d.blockers).toEqual([PRODUCT_NEEDS_OFFICE]);
    expect(PRODUCT_NEEDS_OFFICE).toBe("Office needs to: confirm insulation product");
  });
  test("answer not one of the 6 labels holds the quote", () => {
    const d = applyMittiProduct(draft(), read([{ label: "Insulation product", value: "Earthwool R6" }]), 150);
    expect(d.ready).toBe(false); expect(d.blockers).toEqual([PRODUCT_NEEDS_OFFICE]);
  });
  test("old Brand / Product name / R-value questions are not read", () => {
    expect(read([{ label: "Brand", value: "Bradford" }, { label: "R-value", value: "R6.0" }]).ready).toBe(false);
    const core = readFileSync("src/lib/mitti.core.ts", "utf8");
    for (const l of ['"Brand"', '"Product name"', '"R-value"']) expect(core).not.toContain(l);
  });
  test("installer rate above the owner R6 rate still holds", () => {
    expect(priceHivQuote({ ...base, rValue: "R6.0", installerRExPerM2: 35 / 1.1 }).holdReasons.length).toBe(1);
  });
  test("no installer-profile product anywhere", () => {
    expect(existsSync("src/components/trade/usual-product.tsx")).toBe(false);
  });
});
