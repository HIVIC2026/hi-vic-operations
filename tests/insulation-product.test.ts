import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { contactAnswersFromEntries } from "../src/lib/mitti.core";
import { resolveMittiProduct, productQuoteDescription, PRODUCT_INCOMPLETE } from "../src/lib/insulation-product.core";
import { applyMittiProduct } from "../src/lib/mitti-installer-quote.core";
import { priceHivQuote } from "../src/lib/hiv-quote.core";

const read = (e: { label: string; value: string | null }[]) => { const a = contactAnswersFromEntries(e); return resolveMittiProduct({ brand: a.productBrand, productName: a.productName, rValue: a.productRValue }); };
const draft = () => ({ ready: true, blockers: [] as string[], lines: [{ code: "INSTALLER_PRICE", description: "Installer price", explanation: null }] });

describe("insulation product asked on every Mitti form (Jo 22 Oct 23:32)", () => {
  test("older form without the questions: nothing changes", () => {
    const r = read([{ label: "Homeowner name", value: "X" }]);
    expect(r.asked).toBe(false);
    expect(applyMittiProduct(draft(), r, 150).lines[0]!.description).toBe("Installer price");
  });
  test("named brand: line uses the brand and R-value", () => {
    const r = read([{ label: "Brand", value: "Earthwool" }, { label: "R-value", value: "R6.0" }]);
    expect(applyMittiProduct(draft(), r, 137.61).lines[0]!.description).toBe("Supply and install of Earthwool R6.0 ceiling insulation – 137.61 m²");
  });
  test("Brand = Other: line uses the product name", () => {
    const r = read([{ label: "Brand", value: "Other" }, { label: "Product name", value: "Knauf Earthwool Ultra" }, { label: "R-value", value: "R7" }]);
    expect(r.product).toEqual({ brand: "Other", productName: "Knauf Earthwool Ultra", rValue: "R7.0" });
    expect(productQuoteDescription(r.product!, 150)).toBe("Supply and install of Knauf Earthwool Ultra R7.0 ceiling insulation – 150 m²");
  });
  test("Other without product name, or missing R-value, holds the quote", () => {
    for (const e of [[{ label: "Brand", value: "Other" }, { label: "R-value", value: "R5.0" }], [{ label: "Brand", value: "Bradford" }]]) {
      const d = applyMittiProduct(draft(), read(e), 150);
      expect(d.ready).toBe(false); expect(d.blockers).toContain(PRODUCT_INCOMPLETE);
    }
  });
  test("product name is ignored unless Brand = Other", () => {
    expect(read([{ label: "Brand", value: "Bradford" }, { label: "Product name", value: "Gold" }, { label: "R-value", value: "R5.0" }]).product).toEqual({ brand: "Bradford", productName: null, rValue: "R5.0" });
  });
  test("our-lead quote uses $32 for R6.0 from the form, line shows brand and R-value", () => {
    const q = priceHivQuote({ areaM2: 100, removalM2: 0, accessMultiplier: 1, ownerR5IncPerM2: 30, ownerRemovalIncPerM2: 15, piesaIncGst: 349, apFeeIncGst: 349, gstRate: 0.1, installerR5ExPerM2: 11.5, installerRemovalExPerM2: 4, installerTravelEx: null, rValue: "R6.0", installerRExPerM2: 20, product: { brand: "Pink Batts", productName: null, rValue: "R6.0" } });
    expect(q.lines[0]).toMatchObject({ code: "R6_BATTS", unit_price_inc_gst: 32, description: "Supply and install of Pink Batts R6.0 ceiling insulation" });
  });
  test("no installer-profile product anywhere", () => {
    expect(existsSync("src/components/trade/usual-product.tsx")).toBe(false);
    expect(readFileSync("src/routes/_authenticated/field.business_.details.tsx", "utf8")).not.toContain("UsualProduct");
    expect(readFileSync("src/lib/trade-view.server.ts", "utf8")).not.toContain("UsualProduct");
  });
});
