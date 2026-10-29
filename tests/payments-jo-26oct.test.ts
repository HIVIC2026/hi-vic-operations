import { describe, expect, test } from "bun:test";
import { INSTALL_DEPOSIT_BLOCKER, fixesPaymentBlocker, howYouPayLines, installDepositBlocker, paymentPlan, paymentSteps } from "../src/lib/payments.core";
import * as gate from "../src/lib/payment-gate.core";

const now = "2026-10-26T01:00:00Z";
// $5,349 quote after rebate: $349 PIESA fee + $5,000 install price.
const plan = paymentPlan({ quoteTotalCents: 534_900, safetyCheckCents: 34_900 });
// Batch 3b: install money and fixes money sit on separate invoices.
const steps = (paid: number, p = plan, fixesPaid = 0) => paymentSteps(p, { install: paid, fixes: fixesPaid, repeat: 0 }, { safety_check: { requestedAt: now }, fixes: { requestedAt: now }, install_deposit: { requestedAt: now } }, now);

describe("Payments — Jo 26 Oct 2026", () => {
  test("PIESA fee is $349", () => expect(plan.safetyCheckCents).toBe(34_900));
  test("deposit is 10% of the install price only (not the PIESA fee)", () => expect(plan.installDepositCents).toBe(50_000));
  test("deposit excludes the fixes", () => expect(paymentPlan({ quoteTotalCents: 534_900, safetyCheckCents: 34_900, fixesCents: 80_000 }).installDepositCents).toBe(50_000));
  test("PIESA fee alone never unlocks the install", () => expect(installDepositBlocker(plan, steps(34_900))).toBe(INSTALL_DEPOSIT_BLOCKER));
  test("install unlocks once the 10% deposit is paid", () => expect(installDepositBlocker(plan, steps(84_900))).toBeNull());
  test("fixes must be paid in full before the fixes booking", () => {
    const p = paymentPlan({ quoteTotalCents: 534_900, safetyCheckCents: 34_900, fixesCents: 80_000 });
    expect(fixesPaymentBlocker(p, steps(34_900, p, 79_999))).not.toBeNull();
    expect(fixesPaymentBlocker(p, steps(534_900, p, 0))).not.toBeNull(); // install money never pays the fixes
    expect(fixesPaymentBlocker(p, steps(34_900, p, 80_000))).toBeNull();
  });
  test("no 48-hour hold wording; deposit before booking", () => {
    const l = howYouPayLines(plan).join(" ");
    expect(l).not.toMatch(/48 hours|held/);
    expect(l).toMatch(/before your install day can be booked/);
  });
  test("half-and-half balance helper is gone", () => {
    expect("balanceSplit" in gate).toBe(false);
    expect(gate.splitForOption(5349, 349)).toEqual({ depositPct: 0.0652, deposit: 349, balance: 5000 });
  });
});
