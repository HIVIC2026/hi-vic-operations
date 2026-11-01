import { expect, test } from "bun:test";
import { quoteSittingBlockers, quoteSittingDocuments } from "../src/lib/owner-quote-sign.core";
import { OWNER_DECLARATIONS } from "../src/lib/consent.core";
const ticks = Object.fromEntries(OWNER_DECLARATIONS.map(d => [d.key, true]));
test("one owner tick and all four ESC declarations are required", () => {
  expect(quoteSittingBlockers({ ownerTick: false, declarations: ticks })).toHaveLength(1);
  expect(quoteSittingBlockers({ ownerTick: true, declarations: ticks })).toEqual([]);
});
for (const d of OWNER_DECLARATIONS) test(`missing ${d.key} refuses the whole signing sitting`, () => {
  expect(quoteSittingBlockers({ ownerTick: true, declarations: { ...ticks, [d.key]: false } })).toHaveLength(1);
});
test("one sitting records exactly quote acceptance, agreement, payment terms and ESC consent", () => {
  expect(quoteSittingDocuments()).toEqual(["quote_acceptance", "customer_agreement", "payment_terms", "esc_consent"]);
});