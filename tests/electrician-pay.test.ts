// Decision 355 (Jo 25 Oct 2026, corrected 27 Oct 2026): electricians are paid for the safety check (A3) and the fixes
// (A4) within 7 days of their Mitti form being complete and approved. It never waits for the owner to pay.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ELECTRICIAN_PAY_RULE_LINE, electricianPayDueAt, electricianPayState, payPill, payState } from "../src/lib/trade-view.core";
import { electricianFormCompleteAt, PAYOUT_FORM_NOT_COMPLETE, type TradePayoutFacts } from "../src/lib/trade-payout-gate.core";
import { electricianPayTiming } from "../src/lib/electrician-pay.core";

const A4_DONE = "2026-10-01T02:00:00Z";
const facts = (o: Partial<TradePayoutFacts> = {}): TradePayoutFacts => ({
  piesa: { mittiForm: true, completed: true, evidence: [], completedAt: A4_DONE },
  fixes: { sameVisitOnPiesa: false, outcome: "done", detail: null, completedAt: "2026-10-06T03:00:00Z" },
  install: null, ...o,
});

describe("electricianPayState: 7 days after the complete, approved Mitti form", () => {
  test("form complete → coming 7 days later", () => {
    expect(electricianPayState({ paidAt: null, formCompleteAt: A4_DONE })).toEqual({ kind: "coming", on: "2026-10-08T02:00:00.000Z" });
    expect(payPill(electricianPayState({ paidAt: null, formCompleteAt: "2026-10-01T00:00:00Z" })).label).toBe("Coming Thu 8 Oct");
    expect(electricianPayDueAt({ formCompleteAt: "2026-10-05T00:00:00Z" })).toBe("2026-10-12T00:00:00.000Z");
  });
  test("form not complete → being checked; paid wins", () => {
    expect(electricianPayState({ paidAt: null, formCompleteAt: null })).toEqual({ kind: "checking" });
    expect(electricianPayState({ paidAt: "2026-10-09T00:00:00Z", formCompleteAt: null })).toEqual({ kind: "paid", on: "2026-10-09T00:00:00Z" });
    expect(electricianPayDueAt({ formCompleteAt: null })).toBeNull();
  });
  test("installer pay unchanged (AP approval; installer's own customers also wait for payment in full)", () => {
    expect(payState({ paidAt: null, apApprovedAt: "2026-10-01T00:00:00Z", installerSupplied: false })).toEqual({ kind: "coming", on: "2026-10-08T00:00:00.000Z" });
    expect(payState({ paidAt: null, apApprovedAt: "2026-10-01T00:00:00Z", installerSupplied: true, ownerPaidInFullAt: null })).toEqual({ kind: "checking" });
  });
  test("the electrician Money page says the rule, and never that pay waits for the owner", () => {
    expect(ELECTRICIAN_PAY_RULE_LINE).toBe("Paid within 7 days of your Mitti form being complete and approved");
    expect(ELECTRICIAN_PAY_RULE_LINE).not.toMatch(/owner/i);
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

describe("timing never reads the owner's payment", () => {
  test("due 7 days after the form completion; no form facts → not due", () => {
    expect(electricianPayTiming("assessment", facts())).toEqual({ formCompleteAt: A4_DONE, dueAt: "2026-10-08T02:00:00.000Z" });
    expect(electricianPayTiming("rectification", facts())).toEqual({ formCompleteAt: "2026-10-06T03:00:00Z", dueAt: "2026-10-13T03:00:00.000Z" });
    expect(electricianPayTiming("assessment", undefined)).toEqual({ formCompleteAt: null, dueAt: null });
  });
});

describe("wiring", () => {
  test("trade Money, office Payouts, the trade status line and Mark paid all use the decision-355 rule", () => {
    expect(readFileSync("src/lib/trade-view.server.ts", "utf8")).toContain("electricianPayState({ paidAt: pe?.created_at ?? null, formCompleteAt: et.formCompleteAt })");
    expect(readFileSync("src/lib/office-money.server.ts", "utf8")).toContain("electricianPayTiming(l.kind, facts.get(l.jobId))");
    expect(readFileSync("src/lib/job-status.server.ts", "utf8")).toContain("electricianPayState({ paidAt: paidOut, formCompleteAt: t.formCompleteAt })");
    for (const f of ["src/lib/trade-view.server.ts", "src/lib/office-money.server.ts", "src/lib/job-status.server.ts", "src/lib/office.functions.ts"])
      expect(readFileSync(f, "utf8")).not.toContain("ownerElectricalStepsPaidAt");
  });
});
