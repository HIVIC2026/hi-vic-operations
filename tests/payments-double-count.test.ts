// Launch blocker Task 3 (QA 7 Nov): a card payment is never counted twice with Xero. On the same invoice an unmatched
// Xero payment (no shared Stripe id) that arrives any time after a card payment, for between the card amount less 5%
// (Stripe's fee taken off) and the card amount, is the same money: it counts once, at the card amount, and is raised
// for the office to confirm. No 10-day limit. Cases from the QA reproduction (pay-scratch/money-pure.test.ts).
import { expect, test } from "bun:test";
import { paymentPlan, paymentSteps, reconcilePayments, reconciledPaidCents, type PaymentRecord } from "../src/lib/payments.core";

const card = (amt: number, at: string, id = "pi_ABCDEFG"): PaymentRecord => ({ amountCents: amt, source: "card", paidAt: at, kind: "payment", stripeIds: [id, `ch_${id.slice(3)}`] });
const xero = (amt: number, at: string, paymentId = "xp-1", reference: string | null = null) => ({ paymentId, amountCents: amt, paidAt: at, reference, status: "AUTHORISED" });

test("card then same xero 15 days later counts once", () => {
  const r = reconcilePayments([card(34_900, "2026-11-10T03:00:00Z")], [xero(34_900, "2026-11-25T00:00:00Z")]);
  expect(r.paidCents).toBe(34_900);
  expect(r.unclear.map((u) => u.xero.paymentId)).toEqual(["xp-1"]); // still raised for the office to confirm
});

test("card 34900 then xero 34240 (fee net) counts once", () => {
  const r = reconcilePayments([card(34_900, "2026-11-10T03:00:00Z")], [xero(34_240, "2026-11-12T00:00:00Z")]);
  expect(r.paidCents).toBe(34_900); // at the card amount, not the net Xero amount
  expect(r.unclear.map((u) => u.xero.paymentId)).toEqual(["xp-1"]);
});

test("3000 job with deposit card + xero copy shows 1325.50 still owed", () => {
  const plan = paymentPlan({ quoteTotalCents: 300_000, safetyCheckCents: 34_900 });
  const ledger = [card(34_900, "2026-11-10T00:00:00Z"), card(plan.installDepositCents, "2026-11-11T00:00:00Z", "pi_DEPOSIT1")];
  const paid = reconciledPaidCents(ledger, [xero(plan.installDepositCents, "2026-11-25T00:00:00Z", "xp-2")]);
  expect(paid).toBe(34_900 + plan.installDepositCents);
  const steps = paymentSteps(plan, { install: paid, fixes: 0, repeat: 0 }, { balance: { requestedAt: "2026-11-26T00:00:00Z" } }, "2026-11-26T00:00:00Z");
  const balance = steps.find((s) => s.key === "balance")!;
  expect(balance.state).not.toBe("paid");
  expect(balance.outstandingCents).toBe(132_550); // $1,325.50 still owed
});

test("two genuinely different payments (xero > card) both count", () => {
  const r = reconcilePayments([card(34_900, "2026-11-10T03:00:00Z")], [xero(132_550, "2026-11-20T00:00:00Z")]);
  expect(r.paidCents).toBe(34_900 + 132_550);
  expect(r.unclear).toEqual([]);
});

test("more than 5% short, or paid in Xero before the card, is a different payment", () => {
  expect(reconciledPaidCents([card(34_900, "2026-11-10T03:00:00Z")], [xero(33_000, "2026-11-12T00:00:00Z")])).toBe(67_900);
  expect(reconciledPaidCents([card(34_900, "2026-11-20T03:00:00Z")], [xero(34_240, "2026-11-01T00:00:00Z")])).toBe(69_140);
});
