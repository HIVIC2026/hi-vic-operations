// Photo-quote installers Part 2 (Task 10): the live quote on Add a job matches the issued quote, always.
import { expect, test } from "bun:test";
import { ownPhotoDraftInput, ownPhotoQuotePreview, ownPhotoQuoteProblems } from "../src/lib/own-photo-quote.core";
import { buildOwnCustomerQuoteDraft } from "../src/lib/mitti-installer-quote.core";
import { wholeVeecDiscount } from "../src/lib/estimate.core";

const loc = { metropolitan_or_regional: "Metropolitan", climate_region: "Mild" } as never;
const veec = (m2: number) => wholeVeecDiscount(m2, loc, 40);

test("preview for price 2400, 80 m², PIESA 349: the four lines and owner pays = the builder's total", () => {
  const p = ownPhotoQuotePreview({ priceIncGst: 2400, installM2: 80, product: "Bradford Gold R5", piesaIncGst: 349, wholeVeec: veec(80), metropolitan: true, minCopay: 200 });
  if ("held" in p) throw new Error("held");
  expect(p.lines.map((l) => l.label)).toEqual(["Your price", "PIESA fee", "Home Insulation Victoria AP management fee", "Rebate"]);
  expect(p.lines.slice(0, 3).map((l) => l.amount)).toEqual([2400, 349, 349]);
  expect(p.lines[3]!.amount).toBeLessThanOrEqual(0);
  const d = buildOwnCustomerQuoteDraft(ownPhotoDraftInput({ priceIncGst: 2400, installM2: 80, product: "Bradford Gold R5", removeM2: 0, wholeVeec: veec(80), metropolitan: true, minCopay: 200 }), 349);
  expect(p.ownerPays).toBe(Math.round((d.subtotal - d.discount) * 100) / 100);
  expect(p.feesLine).toBe("We add our $349 AP management fee and the $349 PIESA fee to your price.");
});
test("match: 20 random valid inputs — preview owner pays = issued draft subtotal − rebate", () => {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let n = 0; n < 20; n++) {
    const price = Math.round(500 + rnd() * 6000), m2 = Math.round((20 + rnd() * 200) * 10) / 10, piesa = [275, 300, 349][n % 3]!, remove = Math.round(rnd() * m2 * 10) / 10;
    const p = ownPhotoQuotePreview({ priceIncGst: price, installM2: m2, product: "Earthwool R5", removeM2: remove, piesaIncGst: piesa, wholeVeec: veec(m2), metropolitan: n % 2 === 0, minCopay: 200 });
    if ("held" in p) throw new Error("held");
    const d = buildOwnCustomerQuoteDraft(ownPhotoDraftInput({ priceIncGst: price, installM2: m2, product: "Earthwool R5", removeM2: remove, wholeVeec: veec(m2), metropolitan: n % 2 === 0, minCopay: 200 }), piesa);
    expect(p.ownerPays).toBe(Math.round((d.subtotal - d.discount) * 100) / 100);
    expect(p.lines.find((l) => l.label === "PIESA fee")!.amount).toBe(piesa);
  }
});
test("no PIESA price on file → held", () => {
  expect(ownPhotoQuotePreview({ priceIncGst: 2400, installM2: 80, product: "Bradford Gold R5", piesaIncGst: null, wholeVeec: veec(80), metropolitan: true, minCopay: 200 })).toEqual({ held: "Set this installer's PIESA price first" });
});
test("problems: under R2 No refused; price needed", () => {
  expect(ownPhotoQuoteProblems({ underR2: false, removeM2: 0, installM2: 80, product: "Bradford Gold R5", priceIncGst: 2400 })).toContain("Over R2 isn't eligible for the rebate.");
  expect(ownPhotoQuoteProblems({ underR2: true, removeM2: 0, installM2: 80, product: "Bradford Gold R5", priceIncGst: null })).toEqual(["Enter your price"]);
  expect(ownPhotoQuoteProblems({ underR2: true, removeM2: 0, installM2: 80, product: "Bradford Gold R5", priceIncGst: 2400 })).toEqual([]);
});
