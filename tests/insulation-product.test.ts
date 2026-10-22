// Jo 23 Oct: insulation product on the Ready Check / owner quote.
import { describe, expect, test } from "bun:test";
import { contactAnswersFromEntries } from "../src/lib/mitti.core";
import { resolveMittiProduct, productQuoteDescription, usualProductForProfile, MISSING_USUAL_PRODUCT, DIFFERENT_PRODUCT_INCOMPLETE } from "../src/lib/usual-product.core";
import { applyMittiProduct } from "../src/lib/mitti-installer-quote.core";

const profile = { brand: "Earthwool" as const, brandOther: null, productName: "Ceiling Batts", rValue: "R6.0" as const };
const draft = () => ({ ready: true, blockers: [] as string[], lines: [{ code: "INSTALLER_PRICE", description: "Insulation works by your installer — includes: x", explanation: "x" }, { code: "AP_FEE", description: "fee" }] });

describe("reading the Mitti product answers", () => {
  test("absent on older forms → nothing", () => {
    const a = contactAnswersFromEntries([{ label: "Homeowner name", value: "Test" }]);
    expect([a.productChoice, a.productBrand, a.productName, a.productRValue]).toEqual([null, null, null, null]);
  });
  test("a different product by exact labels", () => {
    const a = contactAnswersFromEntries([{ label: "Insulation product", value: "A different product" }, { label: "Brand", value: "Bradford" }, { label: "Product name", value: "Gold Batts" }, { label: "R-value", value: "R7.0" }]);
    expect(a).toMatchObject({ productChoice: "different", productBrand: "Bradford", productName: "Gold Batts", productRValue: "R7.0" });
    expect(contactAnswersFromEntries([{ label: "Insulation product", value: "My usual product" }]).productChoice).toBe("usual");
  });
});

describe("quote line and holds", () => {
  test("usual product from the profile → exact quote wording", () => {
    const r = resolveMittiProduct({ choice: "usual", usual: profile, different: { brand: null, productName: null, rValue: null } });
    const d = applyMittiProduct(draft(), r, 137.61);
    expect(d.ready).toBe(true);
    expect(d.lines[0]!.description).toBe("Supply and install of Earthwool Ceiling Batts R6.0 ceiling insulation – 137.61 m²");
    expect(r.source).toBe("installer_profile");
  });
  test("different product from the form", () => {
    const r = resolveMittiProduct({ choice: "different", usual: null, different: { brand: "Pink Batts", productName: "Ultra", rValue: "R5.0" } });
    expect(applyMittiProduct(draft(), r, 150).lines[0]!.description).toBe("Supply and install of Pink Batts Ultra R5.0 ceiling insulation – 150 m²");
    expect(r.source).toBe("mitti_form");
  });
  test("usual chosen but no saved product → quote held, office item needed", () => {
    const r = resolveMittiProduct({ choice: "usual", usual: null, different: { brand: null, productName: null, rValue: null } });
    const d = applyMittiProduct(draft(), r, 150);
    expect(d.ready).toBe(false);
    expect(d.blockers).toContain(MISSING_USUAL_PRODUCT);
    expect(r.needsProfile).toBe(true);
  });
  test("different product with a gap → held", () => {
    const r = resolveMittiProduct({ choice: "different", usual: null, different: { brand: "Bradford", productName: null, rValue: "R6.0" } });
    expect(applyMittiProduct(draft(), r, 150).blockers).toContain(DIFFERENT_PRODUCT_INCOMPLETE);
    expect(r.needsProfile).toBe(false);
  });
  test("older form (no question) leaves the quote unchanged", () => {
    const r = resolveMittiProduct({ choice: null, usual: null, different: { brand: null, productName: null, rValue: null } });
    const d = applyMittiProduct(draft(), r, 150);
    expect(d.ready).toBe(true);
    expect(d.lines[0]!.description).toBe("Insulation works by your installer — includes: x");
  });
  test("Other brand uses the typed brand; profile requires it", () => {
    expect(usualProductForProfile({ brand: "Other", brandOther: null, productName: "X", rValue: "R5.0" })).toBeNull();
    const p = usualProductForProfile({ brand: "Other", brandOther: "Knauf", productName: "X", rValue: "R5" })!;
    expect(productQuoteDescription(p, 100)).toBe("Supply and install of Knauf X R5.0 ceiling insulation – 100 m²");
  });
  test("R-value outside R5.0/R6.0/R7.0 is refused", () => {
    expect(usualProductForProfile({ brand: "Bradford", brandOther: null, productName: "X", rValue: "R4.0" })).toBeNull();
  });
});
