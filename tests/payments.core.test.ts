// Owner payments rules (decisions 139/140/141). Pure – no database, no Xero. Run: bun test tests/payments.core.test.ts
import { describe, expect, test } from "bun:test";
import {
  BANK_DETAILS_TO_CONFIRM, FINAL_INVOICE_PAY_LINE, PAY_LINE_SAFETY_CHECK, PROVISIONAL_HOLD_HOURS, SAFETY_CHECK_CENTS,
  bankDetailLines, cardAllowedFor, cumulativePaidCents, howYouPayLines, isStepCleared, newXeroPayments, payNowBlock, payableNow, paymentLine, paymentMethodsFor,
  paymentPlan, paymentSteps, planQuoteTotalCents, provisionalBookingDecision, provisionalHoldExpiresAt, stepState, xeroDateIso,
  effectiveLedger, ledgerRecordFromEvent, reconciledPaidCents, xeroPaymentFacts, xeroReversals,
  ledgerXeroPayments, reconcilePayments, stripeReceiptKey, stripeRefundReceiptKey, stripeRefundedSoFarCents, xeroReceiptKey, xeroReversalReceiptKey,
  INSTALL_DEPOSIT_NOT_PAID, depositDeadlineBeforeStart, depositSweepAction, installDepositPrestartBlocker,
} from "../src/lib/payments.core";
import { paymentPatch } from "../src/lib/invoice.lifecycle";

const T0 = "2026-10-24T03:00:00.000Z";
const plus = (iso: string, h: number) => new Date(Date.parse(iso) + h * 3_600_000).toISOString();

describe("amount maths (cents)", () => {
  test("$349 safety check, 10% of the remainder to book, balance = the rest; pay in full = quote total", () => {
    const p = paymentPlan({ quoteTotalCents: 412_350 }); // $4,123.50 after rebate
    expect(p.safetyCheckCents).toBe(34_900);
    expect(p.installDepositCents).toBe(37_745); // 10% of 3,774.50 = 377.45
    expect(p.balanceCents).toBe(339_705);
    expect(p.safetyCheckCents + p.installDepositCents + p.balanceCents).toBe(412_350);
    expect(p.grandTotalCents).toBe(412_350);
    expect(p.thresholds).toEqual({ safety_check: 34_900, fixes: 34_900, install_deposit: 72_645, balance: 412_350 });
  });
  test("deposit rounds half up to the cent and never breaks the total", () => {
    const p = paymentPlan({ quoteTotalCents: 34_900 + 1_005 }); // remainder $10.05 → 10% = 1.005 → $1.01
    expect(p.installDepositCents).toBe(101);
    expect(p.balanceCents).toBe(904);
  });
  test("fixes are paid in full at approval and sit between the safety check and the deposit", () => {
    const p = paymentPlan({ quoteTotalCents: 300_000, fixesCents: 45_000 });
    expect(p.fixesCents).toBe(45_000);
    expect(p.grandTotalCents).toBe(345_000);
    expect(p.thresholds.fixes).toBe(34_900 + 45_000);
    expect(p.thresholds.install_deposit).toBe(34_900 + 45_000 + 26_510);
    expect(p.thresholds.balance).toBe(345_000);
  });
  test("a quote below $349 caps the safety check at the total; configured fee is honoured", () => {
    expect(paymentPlan({ quoteTotalCents: 20_000 }).safetyCheckCents).toBe(20_000);
    expect(paymentPlan({ quoteTotalCents: 100_000, safetyCheckCents: 39_900 }).safetyCheckCents).toBe(39_900);
    expect(SAFETY_CHECK_CENTS).toBe(34_900);
  });
});

describe("payment methods (decisions 140/141: never a card fee; card only for $349 and fixes)", () => {
  test("card for the safety check and the fixes only", () => {
    expect(paymentMethodsFor("safety_check")).toEqual(["card", "bank"]);
    expect(paymentMethodsFor("fixes")).toEqual(["card", "bank"]);
    expect(paymentMethodsFor("install_deposit")).toEqual(["bank"]);
    expect(paymentMethodsFor("balance")).toEqual(["bank"]);
    expect(cardAllowedFor("balance")).toBe(false);
  });
  test("plain-English lines never mention a fee or surcharge", () => {
    const lines = [paymentLine("safety_check", "INV-0042"), paymentLine("fixes", "INV-0042"), paymentLine("install_deposit", "INV-0042"), paymentLine("balance", "INV-0042"), ...howYouPayLines(paymentPlan({ quoteTotalCents: 400_000 })), FINAL_INVOICE_PAY_LINE];
    for (const l of lines) expect(l).not.toMatch(/fee shown|surcharge|card fee/i);
    expect(paymentLine("safety_check", null)).toBe(PAY_LINE_SAFETY_CHECK);
    expect(paymentLine("install_deposit", "INV-0042")).toBe("Bank transfer or PayID, reference INV-0042");
    expect(paymentLine("balance", null)).toBe("Bank transfer or PayID");
    expect(howYouPayLines(paymentPlan({ quoteTotalCents: 400_000 }))[1]).toContain("$365.10 deposit (10% of the install price)");
    expect(howYouPayLines(paymentPlan({ quoteTotalCents: 400_000 }))[1]).not.toContain("48 hours") // Jo 26 Oct: deposit before booking, no hold;
  });
  test("bank details are never invented: unconfigured → 'to be confirmed'; configured → BSB/account/PayID + reference", () => {
    expect(bankDetailLines(BANK_DETAILS_TO_CONFIRM, "INV-1")).toEqual(["Bank details: we'll send these with your invoice (to be confirmed)."]);
    const lines = bankDetailLines({ accountName: "HIV", bsb: "063000", accountNumber: "12345678", payId: "pay@example.com", configured: true }, "INV-1");
    expect(lines).toEqual(["Account name: HIV", "BSB 063-000 · Account 12345678", "PayID: pay@example.com", "Reference: INV-1"]);
  });
});

describe("step states are idempotent and driven by cumulative payments", () => {
  const plan = paymentPlan({ quoteTotalCents: 400_000, fixesCents: 50_000 });
  const facts = { safety_check: { requestedAt: T0 }, fixes: { requestedAt: plus(T0, 24) }, install_deposit: { requestedAt: plus(T0, 72), dueAt: plus(T0, 120) }, balance: { requestedAt: null } };
  test("nothing paid: safety check requested, later steps requested/not yet", () => {
    const s = paymentSteps(plan, 0, facts, plus(T0, 80));
    expect(s.map((x) => [x.key, x.state])).toEqual([["safety_check", "requested"], ["fixes", "requested"], ["install_deposit", "requested"], ["balance", "not_yet"]]);
    expect(payableNow(plan, s, 0)).toMatchObject({ dueNowCents: 34_900, remainingCents: 450_000, cardAvailable: true });
  });
  test("cumulative ≥ threshold marks a step paid; partial amounts leave the outstanding", () => {
    const s = paymentSteps(plan, 34_900 + 20_000, facts, plus(T0, 80));
    expect(s[0]!.state).toBe("paid");
    expect(s[1]!.state).toBe("requested");
    expect(s[1]!.outstandingCents).toBe(30_000);
    expect(payableNow(plan, s, 54_900).step?.key).toBe("fixes");
  });
  test("deposit falls overdue 48h after booking when unpaid; card is not offered for it", () => {
    const s = paymentSteps(plan, 84_900, facts, plus(T0, 121));
    const dep = s.find((x) => x.key === "install_deposit")!;
    expect(dep.state).toBe("overdue");
    expect(payableNow(plan, s, 84_900)).toMatchObject({ dueNowCents: dep.amountCents, cardAvailable: false });
  });
  test("pay in full clears everything, including the balance that was never requested", () => {
    const s = paymentSteps(plan, 450_000, facts, plus(T0, 1));
    expect(s.every((x) => x.state === "paid")).toBe(true);
    expect(payableNow(plan, s, 450_000)).toMatchObject({ step: null, dueNowCents: 0, remainingCents: 0 });
  });
  test("an audited override waives the safety check without pretending money arrived", () => {
    const s = paymentSteps(plan, 0, { ...facts, safety_check: { requestedAt: T0, waived: true } }, T0);
    expect(s[0]!.state).toBe("waived");
    expect(isStepCleared(s, "safety_check")).toBe(true);
    expect(s[0]!.outstandingCents).toBe(0);
  });
  test("no fixes → no fixes step; a zero-amount step never blocks", () => {
    const s = paymentSteps(paymentPlan({ quoteTotalCents: 400_000 }), 0, facts, T0);
    expect(s.map((x) => x.key)).toEqual(["safety_check", "install_deposit", "balance"]);
    expect(stepState({ thresholdCents: 10, amountCents: 0, paidCents: 0, facts: { requestedAt: T0 }, nowIso: T0 })).toBe("paid");
  });
  test("recomputing with the same facts gives the same answer (idempotent)", () => {
    const a = paymentSteps(plan, 60_000, facts, plus(T0, 50));
    const b = paymentSteps(plan, 60_000, facts, plus(T0, 50));
    expect(a).toEqual(b);
  });
});

describe("provisional install booking (48h)", () => {
  const booked = T0;
  test("expiry is booking + 48h", () => {
    expect(PROVISIONAL_HOLD_HOURS).toBe(48);
    expect(provisionalHoldExpiresAt(booked)).toBe(plus(booked, 48));
  });
  test("unpaid inside 48h = provisional; unpaid at/after 48h = release; deposit paid = confirmed", () => {
    expect(provisionalBookingDecision({ bookedAt: booked, now: plus(booked, 47.9), depositCleared: false, gateEnabled: true, hasInvoice: true })).toBe("provisional");
    expect(provisionalBookingDecision({ bookedAt: booked, now: plus(booked, 48), depositCleared: false, gateEnabled: true, hasInvoice: true })).toBe("release");
    expect(provisionalBookingDecision({ bookedAt: booked, now: plus(booked, 100), depositCleared: true, gateEnabled: true, hasInvoice: true })).toBe("confirmed");
  });
  test("jobs outside the payment rule or without an invoice are never touched", () => {
    expect(provisionalBookingDecision({ bookedAt: booked, now: plus(booked, 100), depositCleared: false, gateEnabled: false, hasInvoice: true })).toBe("not_applicable");
    expect(provisionalBookingDecision({ bookedAt: booked, now: plus(booked, 100), depositCleared: false, gateEnabled: true, hasInvoice: false })).toBe("not_applicable");
    expect(provisionalBookingDecision({ bookedAt: null, now: T0, depositCleared: false, gateEnabled: true, hasInvoice: true })).toBe("not_applicable");
  });
});

describe("Xero payment ledger", () => {
  const xero = [
    { PaymentID: "p1", Amount: 349, Date: "/Date(1761300000000+0000)/" },
    { PaymentID: "p2", Amount: 377.45, Date: "2026-10-26T00:00:00" },
    { PaymentID: "p3", Amount: 10, Status: "DELETED" },
    { Amount: 5 },
  ];
  test("only new, live, positive payments with an id are recorded; re-running records nothing", () => {
    const first = newXeroPayments([], xero);
    expect(first.map((p) => [p.xeroPaymentId, p.amountCents])).toEqual([["p1", 34_900], ["p2", 37_745]]);
    expect(newXeroPayments(first.map((p) => p.xeroPaymentId), xero)).toEqual([]);
    expect(cumulativePaidCents(first)).toBe(72_645);
  });
  test("Xero /Date()/ and ISO dates both parse", () => {
    expect(xeroDateIso("/Date(1761300000000+0000)/")).toBe(new Date(1761300000000).toISOString());
    expect(xeroDateIso("2026-10-26T00:00:00Z")).toBe("2026-10-26T00:00:00.000Z");
  });
});

describe("decision 367: deposit hold = min(booked + 48h, noon Melbourne the day before the install)", () => {
  // AEDT (UTC+11) in late Oct 2026: noon Melbourne = 01:00Z.
  test("install far away → 48h after booking", () => {
    const booked = "2026-10-26T00:00:00.000Z", start = "2026-11-10T21:00:00.000Z";
    expect(provisionalHoldExpiresAt(booked, start)).toBe(plus(booked, 48));
  });
  test("install soon → noon the day before wins", () => {
    const booked = "2026-10-26T00:00:00.000Z"; // 11am Mon Melbourne
    const start = "2026-10-27T21:00:00.000Z"; // 8am Wed 28 Oct Melbourne
    expect(depositDeadlineBeforeStart(start)).toBe("2026-10-27T01:00:00.000Z"); // noon Tue 27 Oct Melbourne
    expect(provisionalHoldExpiresAt(booked, start)).toBe("2026-10-27T01:00:00.000Z");
    expect(provisionalBookingDecision({ bookedAt: booked, now: "2026-10-27T00:59:00.000Z", depositCleared: false, gateEnabled: true, hasInvoice: true, installStart: start })).toBe("provisional");
    expect(provisionalBookingDecision({ bookedAt: booked, now: "2026-10-27T01:00:00.000Z", depositCleared: false, gateEnabled: true, hasInvoice: true, installStart: start })).toBe("release");
    expect(provisionalBookingDecision({ bookedAt: booked, now: "2026-10-27T01:00:00.000Z", depositCleared: true, gateEnabled: true, hasInvoice: true, installStart: start })).toBe("confirmed");
  });
  test("sweep: unpaid before the start → release; unpaid after the start → one office alert, never a silent skip", () => {
    expect(depositSweepAction({ decision: "release", installStart: plus(T0, 5), now: T0 })).toBe("release");
    expect(depositSweepAction({ decision: "release", installStart: plus(T0, -1), now: T0 })).toBe("office_alert");
    expect(depositSweepAction({ decision: "provisional", installStart: plus(T0, 5), now: T0 })).toBe("none");
    expect(depositSweepAction({ decision: "confirmed", installStart: plus(T0, -1), now: T0 })).toBe("none");
    expect(depositSweepAction({ decision: "not_applicable", installStart: plus(T0, -1), now: T0 })).toBe("none");
  });
  test("pre-start fact: unpaid (provisional or past the hold) blocks with 'Install deposit not paid'", () => {
    expect(installDepositPrestartBlocker("provisional")).toBe(INSTALL_DEPOSIT_NOT_PAID);
    expect(installDepositPrestartBlocker("release")).toBe("Install deposit not paid");
    expect(installDepositPrestartBlocker("confirmed")).toBeNull();
    expect(installDepositPrestartBlocker("not_applicable")).toBeNull();
    expect(installDepositPrestartBlocker(undefined)).toBeNull();
  });
});

describe("audit F01: the same money is counted once; deleted Xero payments are reversed", () => {
  const card = ledgerRecordFromEvent("owner_payment_recorded", T0, null, { amount_cents: 34_900, source: "card", paid_at: T0, note: "stripe:pi_3Abc123456", stripe_payment_intent: "pi_3Abc123456" });
  test("Stripe $349, then the same $349 reconciled into Xero (Reference holds the PaymentIntent) → $349", () => {
    const xero = xeroPaymentFacts([{ PaymentID: "x1", Amount: 349, Date: plus(T0, 72), Reference: "Stripe pi_3Abc123456" }]);
    expect(reconciledPaidCents([card], xero)).toBe(34_900);
  });
  test("audit R02: no Stripe id in the Reference → a same-amount card + Xero pair is TWO payments ($698), reported as unclear", () => {
    const bank = xeroPaymentFacts([{ PaymentID: "x1", Amount: 349, Date: plus(T0, 24 * 2), Reference: "INV-0042" }]);
    expect(reconciledPaidCents([card], bank)).toBe(69_800);
    const r = reconcilePayments([card], bank);
    expect(r.unclear.map((u) => u.xero.paymentId)).toEqual(["x1"]);
    expect(cumulativePaidCents(effectiveLedger([card, ledgerRecordFromEvent("owner_payment_recorded", T0, null, { amount_cents: 34_900, source: "xero", paid_at: plus(T0, 48), xero_payment_id: "x1" })]))).toBe(69_800);
    // outside 10 days or a different amount: still two payments, nothing unclear to report
    expect(reconcilePayments([card], xeroPaymentFacts([{ PaymentID: "x1", Amount: 349, Date: plus(T0, 24 * 11) }])).unclear).toEqual([]);
    expect(reconciledPaidCents([card], xeroPaymentFacts([{ PaymentID: "x1", Amount: 300, Date: plus(T0, 24) }]))).toBe(64_900);
  });
  test("audit R02: the charge id in the Reference identifies the card receipt too", () => {
    const withCharge = ledgerRecordFromEvent("owner_payment_recorded", T0, null, { amount_cents: 34_900, source: "card", paid_at: T0, note: "stripe:pi_3Abc123456", stripe_payment_intent: "pi_3Abc123456", stripe_charge: "ch_3Abc999999" });
    const xero = xeroPaymentFacts([{ PaymentID: "x1", Amount: 349, Date: plus(T0, 72), Reference: "ch_3Abc999999" }]);
    expect(reconciledPaidCents([withCharge], xero)).toBe(34_900);
    expect(reconcilePayments([withCharge], xero).unclear).toEqual([]);
  });
  test("each Xero payment claims at most one card record; a Reference naming one receipt never matches another", () => {
    const card2 = ledgerRecordFromEvent("owner_payment_recorded", T0, null, { amount_cents: 34_900, source: "card", paid_at: plus(T0, 1), note: "stripe:pi_other99999" });
    const xero = xeroPaymentFacts([{ PaymentID: "x1", Amount: 349, Date: plus(T0, 24), Reference: "pi_3Abc123456" }]);
    expect(reconciledPaidCents([card, card2], xero)).toBe(69_800);
    expect(reconcilePayments([card, card2], xero).unclear).toEqual([]); // x1 belongs to `card`; card2 is simply unmatched
  });
  test("legacy office rows (no receipt identity ever existed) keep the amount/date match", () => {
    const office = ledgerRecordFromEvent("owner_payment_recorded", T0, "u1", { amount_cents: 34_900, source: "manual", paid_at: T0 });
    expect(reconciledPaidCents([office], xeroPaymentFacts([{ PaymentID: "x1", Amount: 349, Date: plus(T0, 24 * 9) }]))).toBe(34_900);
    expect(reconciledPaidCents([office], xeroPaymentFacts([{ PaymentID: "x1", Amount: 349, Date: plus(T0, 24 * 11) }]))).toBe(69_800);
    // …but never against a Xero payment that names a Stripe receipt
    expect(reconciledPaidCents([office, card], xeroPaymentFacts([{ PaymentID: "x1", Amount: 349, Date: plus(T0, 24), Reference: "pi_3Abc123456" }]))).toBe(69_800);
  });
  test("audit R02: a Stripe refund (owner_payment_reversed, source card) lowers the unmatched card row; Xero rules once matched", () => {
    const part = ledgerRecordFromEvent("owner_payment_reversed", plus(T0, 24), null, { amount_cents: 10_000, source: "card", stripe_payment_intent: "pi_3Abc123456", note: "stripe-refund:pi_3Abc123456" });
    expect(part.kind).toBe("reversal");
    expect(reconciledPaidCents([card, part], [])).toBe(24_900);
    expect(cumulativePaidCents(effectiveLedger([card, part]))).toBe(24_900);
    expect(stripeRefundedSoFarCents([card, part], "pi_3Abc123456")).toBe(10_000);
    const rest = ledgerRecordFromEvent("owner_payment_reversed", plus(T0, 48), null, { amount_cents: 24_900, source: "card", stripe_payment_intent: "pi_3Abc123456" });
    expect(reconciledPaidCents([card, part, rest], [])).toBe(0);
    expect(effectiveLedger([card, part, rest])).toEqual([]);
    // a refund of another receipt does not touch this one
    const other = ledgerRecordFromEvent("owner_payment_reversed", plus(T0, 48), null, { amount_cents: 34_900, source: "card", stripe_payment_intent: "pi_someone_else" });
    expect(reconciledPaidCents([card, other], [])).toBe(34_900);
    // once Xero holds the card money, Xero is the record (its own deletion reverses it)
    expect(reconciledPaidCents([card, part], xeroPaymentFacts([{ PaymentID: "x1", Amount: 349, Date: plus(T0, 72), Reference: "pi_3Abc123456" }]))).toBe(34_900);
  });
  test("receipt keys (audit R06): both Stripe events of one PaymentIntent share one key; Xero keys are per invoice", () => {
    expect(stripeReceiptKey("pi_1")).toBe("stripe:pi_1");
    expect(stripeRefundReceiptKey("pi_1", 10_000)).toBe("stripe-refund:pi_1:10000");
    expect(xeroReceiptKey("inv", "x1")).toBe("xero:inv:x1");
    expect(xeroReversalReceiptKey("inv", "x1")).toBe("xero-reversal:inv:x1");
  });
  test("a Xero payment recorded twice by an old race counts once in the ledger's own view", () => {
    const rec = ledgerRecordFromEvent("owner_payment_recorded", T0, null, { amount_cents: 34_900, source: "xero", paid_at: T0, xero_payment_id: "x1" });
    expect(ledgerXeroPayments([rec, { ...rec }])).toHaveLength(1);
    expect(cumulativePaidCents(effectiveLedger([rec, { ...rec }]))).toBe(34_900);
  });
  test("a deleted/voided Xero payment does not count and is reversed once", () => {
    const rec = ledgerRecordFromEvent("owner_payment_recorded", T0, null, { amount_cents: 34_900, source: "xero", paid_at: T0, xero_payment_id: "x1" });
    expect(xeroReversals([rec], [{ PaymentID: "x1", Amount: 349, Status: "DELETED" }]).map((r) => r.xeroPaymentId)).toEqual(["x1"]);
    expect(xeroReversals([rec], [])).toHaveLength(1); // gone from the invoice
    const rev = ledgerRecordFromEvent("owner_payment_reversed", plus(T0, 5), null, { amount_cents: 34_900, source: "xero", paid_at: T0, xero_payment_id: "x1" });
    expect(rev.kind).toBe("reversal");
    expect(cumulativePaidCents([rec, rev])).toBe(0);
    expect(xeroReversals([rec, rev], [])).toEqual([]); // idempotent
    expect(effectiveLedger([rec, rev])).toEqual([]);
    expect(reconciledPaidCents([rec, rev], xeroPaymentFacts([{ PaymentID: "x1", Amount: 349, Status: "VOIDED" }]))).toBe(0);
  });
  test("idempotent re-sync: same Xero list → nothing new, nothing reversed, same amount", () => {
    const list = [{ PaymentID: "x1", Amount: 349, Date: plus(T0, 24), Reference: "pi_3Abc123456" }];
    const rec = ledgerRecordFromEvent("owner_payment_recorded", T0, null, { amount_cents: 34_900, source: "xero", paid_at: plus(T0, 24), xero_payment_id: "x1", xero_reference: "pi_3Abc123456" });
    expect(newXeroPayments(["x1"], list)).toEqual([]);
    expect(xeroReversals([card, rec], list)).toEqual([]);
    expect(reconciledPaidCents([card, rec], xeroPaymentFacts(list))).toBe(34_900);
    // the ledger's own view agrees (what jobPaymentView / stepPaidAt read)
    expect(cumulativePaidCents(effectiveLedger([card, rec]))).toBe(34_900);
    expect(effectiveLedger([card, rec])).toEqual([rec]);
  });
  test("applyPaidAmount's patch lets total_paid go DOWN and un-marks a no-longer-fully-paid invoice", () => {
    const row = { id: "i", job_id: "j", quote_id: "q", kind: "installation", status: "fully_paid", total_inc_gst: 1000, deposit_pct: 0.1, deposit_amount: 349, balance_amount: 651, deposit_due_date: null, balance_due_date: null, total_paid: 1349, deposit_paid_at: T0, balance_paid_at: T0, xero_invoice_id: "x", xero_update_pending: false, deposit_request_raised_at: null, deposit_request_raised_by: null, deposit_request_amount: null, deposit_request_pct: null };
    const { patch, events } = paymentPatch(row, 349, null, T0);
    expect(patch.total_paid).toBe(349);
    expect(patch.balance_paid_at).toBeNull();
    expect(patch.status).toBe("deposit_paid");
    expect(events).toContain("paid_reduced");
    expect(paymentPatch({ ...row, total_paid: 349, balance_paid_at: null, status: "deposit_paid" }, 349, null, T0).events).toEqual([]);
  });
  test("a card payment not yet in Xero still counts", () => {
    expect(reconciledPaidCents([card], [])).toBe(34_900);
    expect(effectiveLedger([card])).toEqual([card]);
  });
});

describe("owner Pay now block", () => {
  const bank = { accountName: "HIV", bsb: "063000", accountNumber: "12345678", payId: null, configured: true };
  const plan = paymentPlan({ quoteTotalCents: 400_000 });
  test("$349 due: card (Stripe) offered when available, with bank details", () => {
    const steps = paymentSteps(plan, 0, { safety_check: { requestedAt: T0 } }, T0);
    const b = payNowBlock({ step: steps[0]!, cardAvailable: true, bank, reference: "INV-7", remainingCents: 400_000 });
    expect(b.card).toBe(true);
    expect(b.amountCents).toBe(34_900);
    expect(b.lines[0]).toBe(PAY_LINE_SAFETY_CHECK);
    expect(b.lines).toContain("Reference: INV-7");
    expect(payNowBlock({ step: steps[0]!, cardAvailable: false, bank, reference: "INV-7", remainingCents: 400_000 }).card).toBe(false);
  });
  test("deposit due: no card even when Stripe is available", () => {
    const steps = paymentSteps(plan, 34_900, { safety_check: { requestedAt: T0 }, install_deposit: { requestedAt: T0 } }, T0);
    const b = payNowBlock({ step: steps.find((s) => s.key === "install_deposit")!, cardAvailable: true, bank, reference: "INV-7", remainingCents: 365_100 });
    expect(b.card).toBe(false);
    expect(b.title).toContain("$365.10 due now");
    expect(b.lines[0]).toBe("Bank transfer or PayID, reference INV-7");
  });
  test("nothing due: remaining can still be paid in full by bank; all paid says thanks", () => {
    expect(payNowBlock({ step: null, cardAvailable: true, bank, reference: null, remainingCents: 1000 }).lines[0]).toContain("pay the remaining $10.00 any time by bank transfer or PayID");
    expect(payNowBlock({ step: null, cardAvailable: true, bank, reference: null, remainingCents: 0 }).title).toBe("All paid — thank you");
  });
});

describe("repeat safety check on the owner's plan (decision 233, Jo 28 Oct)", () => {
  const plain = paymentPlan({ quoteTotalCents: 400_000 });
  const withRepeat = paymentPlan({ quoteTotalCents: 400_000, repeatCents: 34_900 });
  test("the repeat price is added to the plan total and every existing threshold is unchanged", () => {
    expect(withRepeat.repeatCents).toBe(34_900);
    expect(withRepeat.grandTotalCents).toBe(434_900);
    expect(withRepeat.thresholds).toMatchObject(plain.thresholds); // safety/fixes/deposit thresholds identical
    expect(plain.repeatCents).toBe(0);
  });
  test("a plan with no repeat shows no repeat step; a repeat plan shows it owing until the full total is paid", () => {
    expect(paymentSteps(plain, 0, {}, T0).map((s) => s.key)).not.toContain("repeat_safety_check");
    const steps = paymentSteps(withRepeat, 400_000, { repeat_safety_check: { requestedAt: T0 } }, T0);
    const repeat = steps.find((s) => s.key === "repeat_safety_check")!;
    expect(repeat.label).toBe("Repeat safety check (PIESA)");
    expect(repeat.amountCents).toBe(34_900);
    expect(repeat.state).toBe("requested");
    expect(repeat.outstandingCents).toBe(34_900);
    expect(repeat.methods).toContain("card"); // same card-or-bank rule as the original safety check
    expect(paymentSteps(withRepeat, 434_900, { repeat_safety_check: { requestedAt: T0 } }, T0).find((s) => s.key === "repeat_safety_check")!.state).toBe("paid");
  });
  test("How you can pay and the pay-now line include the repeat price", () => {
    expect(howYouPayLines(withRepeat)).toContain("$349.00 for the repeat safety check (PIESA) (card or bank transfer, no fee)");
    expect(howYouPayLines(plain).some((l) => l.includes("repeat safety check"))).toBe(false);
    expect(paymentLine("repeat_safety_check", "INV-7")).toBe("Pay by card or bank transfer — no fee");
  });
  test("the repeat line already on the ONE invoice is never counted twice", () => {
    // invoice total = quote + repeat → the plan's quote part stays the quote; grand total equals the invoice total
    const q = planQuoteTotalCents({ invoiceTotalCents: 434_900, quoteTotalCents: 400_000, fixesCents: 0, repeatCents: 34_900 });
    expect(q).toBe(400_000);
    expect(paymentPlan({ quoteTotalCents: q, repeatCents: 34_900 }).grandTotalCents).toBe(434_900);
    // unchanged for jobs without a repeat
    expect(planQuoteTotalCents({ invoiceTotalCents: 400_000, quoteTotalCents: 400_000, fixesCents: 0 })).toBe(400_000);
  });
});
