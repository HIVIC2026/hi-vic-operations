// Batch 1 task 4: a card payment and its same-amount Xero copy without a Stripe id count once (and still ask the office).
import { describe, expect, test } from "bun:test";
import { ledgerRecordFromEvent, paymentPairKey, reconcilePayments, reconciledPaidCents, withSeparateMarks, xeroPaymentFacts } from "../src/lib/payments.core";

const T0 = "2026-10-24T03:00:00.000Z";
const plus = (iso: string, h: number) => new Date(Date.parse(iso) + h * 3_600_000).toISOString();
const card = (pi: string, at = T0) => ledgerRecordFromEvent("owner_payment_recorded", at, null, { amount_cents: 34_900, source: "card", paid_at: at, note: `stripe:${pi}`, stripe_payment_intent: pi });

describe("card + same-amount Xero payment without a Stripe id", () => {
  test("Xero payment 2 days later, no id in the Reference → counted once, still raised as unclear", () => {
    const xero = xeroPaymentFacts([{ PaymentID: "x1", Amount: 349, Date: plus(T0, 48), Reference: "INV-0042" }]);
    const r = reconcilePayments([card("pi_3Abc123456")], xero);
    expect(r.paidCents).toBe(34_900);
    expect(r.unclear.map((u) => u.xero.paymentId)).toEqual(["x1"]);
    expect(r.unmatched).toEqual([]);
  });
  test("two real card payments + one Xero payment → 2 x $349", () => {
    const xero = xeroPaymentFacts([{ PaymentID: "x1", Amount: 349, Date: plus(T0, 24) }]);
    const r = reconcilePayments([card("pi_3Abc123456"), card("pi_3Other99999", plus(T0, 1))], xero);
    expect(r.paidCents).toBe(69_800);
    expect(r.unclear.length).toBe(1);
  });
  test("Xero payment 11 days after the card → not paired", () => {
    const xero = xeroPaymentFacts([{ PaymentID: "x1", Amount: 349, Date: plus(T0, 24 * 11) }]);
    const r = reconcilePayments([card("pi_3Abc123456")], xero);
    expect(r.paidCents).toBe(69_800);
    expect(r.unclear).toEqual([]);
  });
  test("a Xero payment already claimed by a Stripe id is not paired again", () => {
    const xero = xeroPaymentFacts([{ PaymentID: "x1", Amount: 349, Date: plus(T0, 24), Reference: "pi_3Abc123456" }]);
    const r = reconcilePayments([card("pi_3Abc123456"), card("pi_3Other99999", plus(T0, 1))], xero);
    expect(r.paidCents).toBe(69_800);
    expect(r.unclear).toEqual([]);
  });
  test("Stripe id in the Reference still matches as before", () => {
    const xero = xeroPaymentFacts([{ PaymentID: "x1", Amount: 349, Date: plus(T0, 72), Reference: "Stripe pi_3Abc123456" }]);
    const r = reconcilePayments([card("pi_3Abc123456")], xero);
    expect(reconciledPaidCents([card("pi_3Abc123456")], xero)).toBe(34_900);
    expect(r.unclear).toEqual([]);
  });
  test("two cards + two Xero payments pair by closest time, no crossing", () => {
    const c1 = card("pi_3Abc123456", T0), c2 = card("pi_3Other99999", plus(T0, 24 * 5));
    const xero = xeroPaymentFacts([{ PaymentID: "xB", Amount: 349, Date: plus(T0, 24 * 5 + 2) }, { PaymentID: "xA", Amount: 349, Date: plus(T0, 2) }]);
    const r = reconcilePayments([c1, c2], xero);
    expect(r.paidCents).toBe(69_800);
    expect(r.unclear.map((u) => [u.record.stripeIds?.[0], u.xero.paymentId])).toEqual([["pi_3Abc123456", "xA"], ["pi_3Other99999", "xB"]]);
  });
});

describe("office marks a pair 'Two separate payments'", () => {
  const c = card("pi_3Abc123456");
  const xero = xeroPaymentFacts([{ PaymentID: "x1", Amount: 349, Date: plus(T0, 48), Reference: "INV-0042" }]);
  test("unmarked counts once and is unclear; marked counts 2 x and the row clears", () => {
    expect(reconcilePayments([c], xero).paidCents).toBe(34_900);
    const marked = withSeparateMarks([c], [paymentPairKey(c, "x1")]);
    const r = reconcilePayments(marked, xero);
    expect(r.paidCents).toBe(69_800);
    expect(r.unclear).toEqual([]);
    expect(reconciledPaidCents(marked, xero)).toBe(69_800);
  });
  test("a mark for another Xero payment does not unpair this one", () => {
    expect(reconcilePayments(withSeparateMarks([c], [paymentPairKey(c, "other")]), xero).paidCents).toBe(34_900);
  });
});
