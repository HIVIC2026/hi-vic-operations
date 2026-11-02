import { expect, test } from "bun:test";
import { safetyCheckReceiptKey, pickSafetyCheckReceiptKey, type ReceiptEvent } from "../src/lib/safety-check-receipt.core";

const PAID = "2026-11-08T01:00:00.000Z";
const ev = (o: Partial<ReceiptEvent> = {}): ReceiptEvent => ({ receipt_key: "xero:inv1:p1", paid_at: PAID, amount_cents: 34900, xero_payment_id: "p1", ...o });
const pick = (recorded: ReceiptEvent[], reversed: ReceiptEvent[] = [], paidAt = PAID, cents = 34900) => pickSafetyCheckReceiptKey({ recorded, reversed, paidAt, safetyCheckCents: cents });

test("exact match returns the key (same instant in a different format still matches)", () => {
  expect(pick([ev()])).toBe("xero:inv1:p1");
  expect(pick([ev({ paid_at: "2026-11-08T12:00:00+11:00" })])).toBe("xero:inv1:p1");
});
test("paid_at mismatch or unparseable returns null", () => {
  expect(pick([ev({ paid_at: "2026-11-09T01:00:00.000Z" })])).toBeNull();
  expect(pick([ev({ paid_at: "nonsense" })])).toBeNull();
  expect(pick([ev()], [], "nonsense")).toBeNull();
  expect(pick([ev({ paid_at: undefined })])).toBeNull();
});
test("amount mismatch (deposit or partial) returns null", () => {
  expect(pick([ev({ amount_cents: 18390 })])).toBeNull();
  expect(pick([ev({ amount_cents: undefined })])).toBeNull();
});
test("a reversed payment returns null", () => {
  expect(pick([ev()], [ev({ receipt_key: "xero-reversal:inv1:p1" })])).toBeNull();
  const card = ev({ receipt_key: "stripe:pi_1", xero_payment_id: undefined, stripe_payment_intent: "pi_1" });
  expect(pick([card], [{ receipt_key: "stripe-refund:pi_1:34900", stripe_payment_intent: "pi_1" }])).toBeNull();
  expect(pick([ev()], [{ receipt_key: "xero-reversal:inv1:other", xero_payment_id: "other" }])).toBe("xero:inv1:p1");
});
test("two matches returns null (no guessing)", () => {
  expect(pick([ev(), ev({ receipt_key: "stripe:pi_2", xero_payment_id: undefined, stripe_payment_intent: "pi_2" })])).toBeNull();
});
test("receipts flag off: returns null and reads nothing", async () => {
  let called = 0;
  const loadEvents = async () => { called++; return { recorded: [ev()], reversed: [] }; };
  expect(await safetyCheckReceiptKey({ receiptsApproved: false, loadEvents }, { paidAt: PAID, safetyCheckCents: 34900 })).toBeNull();
  expect(called).toBe(0);
  expect(await safetyCheckReceiptKey({ receiptsApproved: true, loadEvents }, { paidAt: PAID, safetyCheckCents: 34900 })).toBe("xero:inv1:p1");
  expect(called).toBe(1);
});
