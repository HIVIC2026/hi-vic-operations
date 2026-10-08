import { expect, test } from "bun:test";
import { parseProposedR, removalPayload, removalProblems } from "../src/lib/intake-quote-details.core";
import { intakeQuotePayload, insulationQualifies } from "../src/lib/installer-intake.core";
test("R5/R6/R7 and custom R prefixes normalize without eligibility proof", () => {
  expect(["R5.0", "R6.0", "R7.0", "R5.5"].map(parseProposedR)).toEqual([5, 6, 7, 5.5]);
  expect(Number.isNaN(parseProposedR("Rbrand5"))).toBe(true);
  expect(insulationQualifies("unknown")).toBe(false);
});
test("explicit zero removal charge is valid and blank is not zero", () => {
  expect(removalProblems(removalPayload({ answer: "yes", area: "120", charge: "0" }, true), "below_r2", 120, 3450)).toEqual([]);
  expect(removalProblems(removalPayload({ answer: "yes", area: "120", charge: "" }, true), "below_r2", 120, 3450)).toHaveLength(1);
});
test("No or unquoted clears active removal values", () => {
  expect(removalPayload({ answer: "no", area: "120", charge: "500" }, true)).toEqual({ answer: "no", areaM2: null, chargeIncGst: null });
  expect(removalPayload({ answer: "yes", area: "120", charge: "500" }, false)).toEqual({ answer: "unknown", areaM2: null, chargeIncGst: null });
});
test("None conflicts with removal Yes; oversized area and charges are refused", () => {
  expect(removalProblems({ answer: "yes", areaM2: 120, chargeIncGst: 0 }, "none", 120, 3450)).toHaveLength(1);
  expect(removalProblems({ answer: "yes", areaM2: 121, chargeIncGst: 3451 }, "below_r2", 120, 3450)).toHaveLength(2);
});
test("file-only Yes leaves amount unknown; included removal never increases quote total", () => {
  expect(intakeQuotePayload({ quoteStatus: "have_quote", amount: "3450", includes: "Removal and R5", proposedR: "R5" }).quoted_price_inc_gst).toBe(3450);
  expect(removalPayload({ answer: "yes", area: "120", charge: "500" }, true).chargeIncGst).toBe(500);
  expect(intakeQuotePayload({ quoteStatus: "have_quote", amount: "", includes: "", proposedR: "R5" }).quoted_price_inc_gst).toBeNull();
});