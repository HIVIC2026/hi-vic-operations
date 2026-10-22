import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { contactAnswersFromEntries } from "../src/lib/mitti.core";
import { resolveMittiProduct, PRODUCT_NOT_APPROVED, APPROVED_PRODUCTS } from "../src/lib/insulation-product.core";
import { applyMittiProduct } from "../src/lib/mitti-installer-quote.core";
import { priceHivQuote } from "../src/lib/hiv-quote.core";

const read = (e: { label: string; value: string | null }[]) => resolveMittiProduct(contactAnswersFromEntries(e).productOption);
const draft = () => ({ ready: true, blockers: [] as string[], lines: [{ code: "INSTALLER_PRICE", description: "Installer price", explanation: null }] });
const base = { areaM2: 100, removalM2: 0, accessMultiplier: 1, ownerR5IncPerM2: 30, ownerRemovalIncPerM2: 15, piesaIncGst: 349, apFeeIncGst: 349, gstRate: 0.1, installerR5ExPerM2: 11.5, installerRemovalExPerM2: 4, installerTravelEx: null };

describe("approved insulation product on the Mitti forms (Jo 22 Oct 23:42)", () => {
  test("exactly the two approved options, both R5.0", () => {
    expect(APPROVED_PRODUCTS.map((p) => [p.option, p.rValue])).toEqual([["Bradford Gold R5", "R5.0"], ["Fletchers Pink Batts R5", "R5.0"]]);
  });
  test("older form without the question: nothing changes", () => {
    const r = read([{ label: "Homeowner name", value: "X" }]);
    expect(r.asked).toBe(false);
    expect(applyMittiProduct(draft(), r, 150).lines[0]!.description).toBe("Installer price");
  });
  test("Bradford Gold R5 on the installer quote line", () => {
    const r = read([{ label: "Insulation product", value: "Bradford Gold R5" }]);
    expect(applyMittiProduct(draft(), r, 137.61).lines[0]!.description).toBe("Supply and install of Bradford Gold R5.0 ceiling insulation – 137.61 m²");
  });
  test("an answer that isn't an approved option holds the quote", () => {
    const d = applyMittiProduct(draft(), read([{ label: "Insulation product", value: "Earthwool R6" }]), 150);
    expect(d.ready).toBe(false); expect(d.blockers).toContain(PRODUCT_NOT_APPROVED);
  });
  test("our-lead quote: Fletchers Pink Batts R5 → $30/m² R5 line with the product", () => {
    const p = read([{ label: "Insulation product", value: "Fletchers Pink Batts R5" }]).product!;
    const q = priceHivQuote({ ...base, rValue: p.rValue, product: p });
    expect(q.lines[0]).toMatchObject({ code: "R5_BATTS", unit_price_inc_gst: 30, description: "Supply and install of Fletchers Pink Batts R5.0 ceiling insulation" });
  });
  test("old Brand / Product name / R-value questions are no longer read", () => {
    expect(read([{ label: "Brand", value: "Bradford" }, { label: "R-value", value: "R6.0" }]).asked).toBe(false);
  });
  test("no installer-profile product anywhere", () => {
    expect(existsSync("src/components/trade/usual-product.tsx")).toBe(false);
    expect(readFileSync("src/lib/trade-view.server.ts", "utf8")).not.toContain("UsualProduct");
  });
});
