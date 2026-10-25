// Decision 355 (Jo 25 Oct 2026): electricians are paid for the safety check (A3) and the fixes (A4) 7 days after their
// Mitti form is 100% complete AND the owner has paid that step. Installer pay is unchanged.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ELECTRICIAN_PAY_RULE_LINE, ELECTRICIAN_PAY_WAITING, electricianPayDueAt, electricianPayState, payPill, payState } from "../src/lib/trade-view.core";
import { paymentPlan, stepPaidAt } from "../src/lib/payments.core";
import { electricianFormCompleteAt, PAYOUT_FORM_NOT_COMPLETE, type TradePayoutFacts } from "../src/lib/trade-payout-gate.core";
import { electricianPayTiming } from "../src/lib/electrician-pay.core";

const A4_DONE = "2026-10-01T02:00:00Z";
const facts = (o: Partial<TradePayoutFacts> = {}): TradePayoutFacts => ({
  piesa: { mittiForm: true, completed: true, evidence: [], completedAt: A4_DONE },
  fixes: { sameVisitOnPiesa: false, outcome: "done", detail: null, completedAt: "2026-10-06T03:00:00Z" },
  install: null, ...o,
});

describe("electricianPayState: 7 days after the later of form complete and owner paid", () => {
  test("both in → coming 7 days after the LATER one", () => {
    expect(electricianPayState({ paidAt: null, formCompleteAt: A4_DONE, ownerPaidAt: "2026-10-03T00:00:00Z" })).toEqual({ kind: "coming", on: "2026-10-10T00:00:00.000Z" });
    expect(electricianPayState({ paidAt: null, formCompleteAt: "2026-10-05T00:00:00Z", ownerPaidAt: "2026-10-01T00:00:00Z" })).toEqual({ kind: "coming", on: "2026-10-12T00:00:00.000Z" });
    expect(payPill(electricianPayState({ paidAt: null, formCompleteAt: "2026-10-01T00:00:00Z", ownerPaidAt: "2026-10-01T00:00:00Z" })).label).toBe("Coming Thu 8 Oct");
  });
  test("form not complete, or owner not paid → being checked; paid wins", () => {
    expect(electricianPayState({ paidAt: null, formCompleteAt: null, ownerPaidAt: "2026-10-03T00:00:00Z" })).toEqual({ kind: "checking" });
    expect(electricianPayState({ paidAt: null, formCompleteAt: A4_DONE, ownerPaidAt: null })).toEqual({ kind: "checking" });
    expect(electricianPayState({ paidAt: "2026-10-09T00:00:00Z", formCompleteAt: null, ownerPaidAt: null })).toEqual({ kind: "paid", on: "2026-10-09T00:00:00Z" });
    expect(electricianPayDueAt({ formCompleteAt: A4_DONE, ownerPaidAt: null })).toBeNull();
  });
  test("installer pay unchanged (AP approval; installer's own customers also wait for payment in full)", () => {
    expect(payState({ paidAt: null, apApprovedAt: "2026-10-01T00:00:00Z", installerSupplied: false })).toEqual({ kind: "coming", on: "2026-10-08T00:00:00.000Z" });
    expect(payState({ paidAt: null, apApprovedAt: "2026-10-01T00:00:00Z", installerSupplied: true, ownerPaidInFullAt: null })).toEqual({ kind: "checking" });
  });
  test("the electrician Money page says the rule", () => {
    expect(ELECTRICIAN_PAY_RULE_LINE).toBe("Paid 7 days after your Mitti form is complete and the owner has paid for that visit");
    expect(readFileSync("src/routes/_authenticated/field.money.tsx", "utf8")).toContain("{ELECTRICIAN_PAY_RULE_LINE}");
  });
});

describe("form complete time (decision 318 gate first)", () => {
  test("safety check = the A3 completion; fixes = the A4 completion; same-visit fixes follow the A3", () => {
    expect(electricianFormCompleteAt("assessment", facts())).toBe(A4_DONE);
    expect(electricianFormCompleteAt("rectification", facts())).toBe("2026-10-06T03:00:00Z");
    expect(electricianFormCompleteAt("rectification", facts({ fixes: { sameVisitOnPiesa: true, outcome: null, detail: null } }))).toBe(A4_DONE);
  });
  test("a held form (not Complete / evidence missing) has no completion time", () => {
    expect(electricianFormCompleteAt("assessment", facts({ piesa: { mittiForm: true, completed: false, evidence: [], completedAt: null } }))).toBeNull();
    expect(electricianFormCompleteAt("assessment", facts({ piesa: { mittiForm: true, completed: true, evidence: ["photo missing"], completedAt: A4_DONE } }))).toBeNull();
    expect(electricianFormCompleteAt("rectification", facts({ fixes: { sameVisitOnPiesa: false, outcome: "open", detail: null } }))).toBeNull();
    expect(PAYOUT_FORM_NOT_COMPLETE.assessment).toContain("A3");
  });
});

describe("owner paid that step (one invoice, cumulative ledger)", () => {
  const plan = paymentPlan({ quoteTotalCents: 500_000, safetyCheckCents: 34_900, fixesCents: 120_000 });
  test("safety check paid when the cumulative total reaches $349; fixes when it reaches $349 + fixes", () => {
    const recs = [{ amountCents: 20_000, paidAt: "2026-10-02T00:00:00Z" }, { amountCents: 14_900, paidAt: "2026-10-03T00:00:00Z" }, { amountCents: 120_000, paidAt: "2026-10-07T00:00:00Z" }];
    expect(stepPaidAt(plan, "safety_check", recs)).toBe("2026-10-03T00:00:00Z");
    expect(stepPaidAt(plan, "fixes", recs)).toBe("2026-10-07T00:00:00Z");
    expect(stepPaidAt(plan, "fixes", recs.slice(0, 2))).toBeNull();
    // records out of order are taken in paid-at order
    expect(stepPaidAt(plan, "safety_check", [...recs].reverse())).toBe("2026-10-03T00:00:00Z");
  });
  test("Xero mirror fallback; no fixes on the plan → null", () => {
    expect(stepPaidAt(plan, "safety_check", [], { paidCents: 34_900, at: "2026-10-04T00:00:00Z" })).toBe("2026-10-04T00:00:00Z");
    expect(stepPaidAt(plan, "safety_check", [], { paidCents: 34_899, at: "2026-10-04T00:00:00Z" })).toBeNull();
    expect(stepPaidAt(paymentPlan({ quoteTotalCents: 500_000 }), "fixes", [{ amountCents: 500_000, paidAt: "2026-10-04T00:00:00Z" }])).toBeNull();
  });
  test("timing: due 7 days after the later fact, with the owner-not-paid reason while waiting", () => {
    expect(electricianPayTiming("assessment", facts(), { safetyPaidAt: "2026-10-03T00:00:00Z", fixesPaidAt: null })).toEqual({ formCompleteAt: A4_DONE, ownerPaidAt: "2026-10-03T00:00:00Z", dueAt: "2026-10-10T00:00:00.000Z", waiting: [] });
    expect(electricianPayTiming("rectification", facts(), { safetyPaidAt: "2026-10-03T00:00:00Z", fixesPaidAt: null })).toEqual({ formCompleteAt: "2026-10-06T03:00:00Z", ownerPaidAt: null, dueAt: null, waiting: [ELECTRICIAN_PAY_WAITING.rectification] });
    expect(electricianPayTiming("assessment", undefined, undefined).waiting).toEqual(["Owner hasn't paid the safety check yet"]);
  });
});

describe("wiring", () => {
  test("trade Money, office Payouts, the trade status line and Mark paid all use the decision-355 rule", () => {
    expect(readFileSync("src/lib/trade-view.server.ts", "utf8")).toContain("electricianPayState({ paidAt: pe?.created_at ?? null, formCompleteAt: et.formCompleteAt, ownerPaidAt: et.ownerPaidAt })");
    const om = readFileSync("src/lib/office-money.server.ts", "utf8");
    expect(om).toContain("electricianPayTiming(l.kind, facts.get(l.jobId), ownerPaid.get(l.jobId))");
    expect(readFileSync("src/lib/job-status.server.ts", "utf8")).toContain("electricianPayState({ paidAt: paidOut, formCompleteAt: t.formCompleteAt, ownerPaidAt: t.ownerPaidAt })");
    expect(readFileSync("src/lib/office.functions.ts", "utf8")).toContain("electricianPayTiming(data.kind, undefined,");
  });
});
