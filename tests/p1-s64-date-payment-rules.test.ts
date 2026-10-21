// Behavioural (not source-text) tests for the two Phase 1 rules fixed alongside the S64 wiring.
// Pure functions only: no network, no database, no providers, no mocks of the app itself.
//
// Covers the acceptance list from the fix brief:
//   PIESA date  — yesterday / today / tomorrow / far future / invalid / Melbourne boundary /
//                 existing valid historical date preserved / no regression for the Mitti path.
//   Payment     — actual paid / actual unpaid / administrative override / TEST simulated /
//                 missing payment information, and that an override is never "paid".
import { describe, expect, test } from "bun:test";

import {
  isValidYmd, piesaDateBlockers, piesaDateInFuture, refuseFuturePiesaDate,
  PIESA_DATE_IN_FUTURE, PIESA_DATE_INVALID,
} from "@/lib/piesa-date.core";
import { melbourneToday } from "@/lib/melbourne-time.core";
import { evaluatePaymentGate, safetyCheckPayLabel, safetyCheckPayNote, safetyCheckPayState } from "@/lib/payment-gate.core";
import { jobTimeline, type StatusFacts } from "@/lib/job-status.core";

const TODAY = "2026-10-19"; // Australia/Melbourne

// ---------------- PIESA assessment date ----------------

describe("PIESA assessment date rule", () => {
  test("yesterday is accepted", () => {
    expect(piesaDateBlockers("2026-10-18", TODAY)).toEqual([]);
  });

  test("today is accepted", () => {
    expect(piesaDateBlockers(TODAY, TODAY)).toEqual([]);
  });

  test("tomorrow is rejected with the rule's own wording", () => {
    expect(piesaDateBlockers("2026-10-20", TODAY)).toEqual([PIESA_DATE_IN_FUTURE]);
  });

  test("a far-future date is rejected", () => {
    expect(piesaDateBlockers("2099-01-01", TODAY)).toEqual([PIESA_DATE_IN_FUTURE]);
  });

  test("a shape-valid but non-existent date is rejected as invalid", () => {
    expect(piesaDateBlockers("2026-02-30", TODAY)).toEqual([PIESA_DATE_INVALID]);
    expect(piesaDateBlockers("2026-13-01", TODAY)).toEqual([PIESA_DATE_INVALID]);
    expect(piesaDateBlockers("2026-11-31", TODAY)).toEqual([PIESA_DATE_INVALID]);
  });

  test("garbage and empty values are rejected as invalid, not silently ignored", () => {
    expect(piesaDateBlockers("not-a-date", TODAY)).toEqual([PIESA_DATE_INVALID]);
    expect(piesaDateBlockers("", TODAY)).toEqual([PIESA_DATE_INVALID]);
    expect(piesaDateBlockers(null, TODAY)).toEqual([PIESA_DATE_INVALID]);
    expect(piesaDateBlockers(undefined, TODAY)).toEqual([PIESA_DATE_INVALID]);
    expect(isValidYmd("19/10/2026")).toBe(false);
  });

  test("a historical TEST date is never silently rewritten — it is refused at the write point, not edited", () => {
    // HV-2594's historical TEST value, documented exactly as the fixture inconsistency.
    expect(refuseFuturePiesaDate({ assessed_on: "2026-10-22" }, TODAY)).toEqual({
      patch: {},
      issues: ['Mitti assessment date "2026-10-22" was refused: PIESA date cannot be in the future. Enter the date in the portal instead.'],
    });
    expect(refuseFuturePiesaDate({ assessed_on: "2026-09-01", piesa_outcome: "pass" }, TODAY)).toEqual({
      patch: { assessed_on: "2026-09-01", piesa_outcome: "pass" },
      issues: [],
    });
    expect(refuseFuturePiesaDate({ piesa_outcome: "pass" }, TODAY)).toEqual({ patch: { piesa_outcome: "pass" }, issues: [] });
  });

  test("the import path keeps every other field when it refuses a date", () => {
    const r = refuseFuturePiesaDate({ assessed_on: "2027-01-01", rcds_present: true, hazards: "none" }, TODAY);
    expect(r.patch).toEqual({ rcds_present: true, hazards: "none" });
    expect(r.patch.assessed_on).toBeUndefined();
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toContain(PIESA_DATE_IN_FUTURE);
  });

  test("the boundary is the Melbourne calendar date, not UTC", () => {
    // 2026-10-19T12:59Z is still 19 Oct in Melbourne; 13:00Z is already 20 Oct (AEDT, UTC+11).
    expect(melbourneToday(new Date("2026-10-19T12:59:00Z"))).toBe("2026-10-19");
    expect(melbourneToday(new Date("2026-10-19T13:00:00Z"))).toBe("2026-10-20");
    // "today" at the Melbourne boundary means the 20th is accepted once Melbourne has rolled over,
    // and rejected while Melbourne is still on the 19th.
    expect(piesaDateBlockers("2026-10-20", melbourneToday(new Date("2026-10-19T13:00:00Z")))).toEqual([]);
    expect(piesaDateBlockers("2026-10-20", melbourneToday(new Date("2026-10-19T12:59:00Z")))).toEqual([PIESA_DATE_IN_FUTURE]);
    // 21 Oct is future in both readings
    expect(piesaDateBlockers("2026-10-21", melbourneToday(new Date("2026-10-19T13:00:00Z")))).toEqual([PIESA_DATE_IN_FUTURE]);
  });

  test("the comparison is lexicographic on YYYY-MM-DD, which is the date order", () => {
    expect(piesaDateInFuture("2026-10-20", "2026-10-19")).toBe(true);
    expect(piesaDateInFuture("2026-10-19", "2026-10-20")).toBe(false);
    expect(piesaDateInFuture("2026-10-19", "2026-10-19")).toBe(false);
    // year/month rollover
    expect(piesaDateInFuture("2026-11-01", "2026-10-31")).toBe(true);
    expect(piesaDateInFuture("2027-01-01", "2026-12-31")).toBe(true);
    expect(piesaDateInFuture("2026-01-01", "2025-12-31")).toBe(true);
  });
});

// ---------------- Safety check payment status ----------------

const facts = (p: Partial<StatusFacts> = {}): StatusFacts => ({
  stage: "piesa_scheduled", stageSince: null, now: new Date("2026-10-19T02:00:00Z"), staff: false,
  bookings: [], quoteSentAt: null, quoteAcceptedAt: null, safetyPaidAt: null, ownerTimesChosenAt: null,
  rectQuoteSentAt: null, paidInFullAt: null, apApprovedAt: null, payout: null,
  safetyPay: { kind: "unknown" }, ...p,
});

describe("Safety check payment status", () => {
  test("money actually received is Paid", () => {
    expect(safetyCheckPayState({ requiredAmount: 349, invoicePaid: 349, overrideCount: 0, qaSimulated: false })).toEqual({ kind: "paid", paidAt: null });
    expect(safetyCheckPayState({ requiredAmount: 349, invoicePaid: 500, overrideCount: 0, qaSimulated: false })).toEqual({ kind: "paid", paidAt: null });
  });

  test("a partial payment is still unpaid, not overridden", () => {
    expect(safetyCheckPayState({ requiredAmount: 349, invoicePaid: 100, overrideCount: 0, qaSimulated: false })).toEqual({ kind: "unpaid" });
  });

  test("an administrative override is NOT money received", () => {
    const s = safetyCheckPayState({ requiredAmount: 349, invoicePaid: 0, overrideCount: 1, qaSimulated: false });
    expect(s.kind).toBe("overridden");
    expect(safetyCheckPayLabel(s, false)).toBe("Payment requirement overridden");
    expect(safetyCheckPayLabel(s, true)).toBe("Payment requirement overridden");
    expect(safetyCheckPayNote(s, false)).toContain("no money has been received");
  });

  test("a TEST simulated payment is labelled as simulated", () => {
    const s = safetyCheckPayState({ requiredAmount: 349, invoicePaid: 0, overrideCount: 0, qaSimulated: true });
    expect(s.kind).toBe("test_simulated");
    expect(safetyCheckPayLabel(s, false)).toBe("TEST payment (simulated)");
    expect(safetyCheckPayNote(s, false)).toContain("no real money");
  });

  test("missing payment information is never presented as paid", () => {
    const s = safetyCheckPayState({ requiredAmount: null, invoicePaid: null, overrideCount: 0, qaSimulated: false });
    expect(s.kind).toBe("unknown");
    expect(safetyCheckPayLabel(s, false)).toBe("PIESA payment to confirm");
    expect(safetyCheckPayNote(s, false)).toContain("No payment information yet");
  });

  test("an override never beats money that was actually received", () => {
    expect(safetyCheckPayState({ requiredAmount: 349, invoicePaid: 349, overrideCount: 3, qaSimulated: true })).toEqual({ kind: "paid", paidAt: null });
  });

  test("a recorded $349 payment row counts as paid (legacy TEST pre-assessment record)", () => {
    const s = safetyCheckPayState({ requiredAmount: 349, invoicePaid: 0, overrideCount: 0, qaSimulated: false, recordedPaidAt: "2026-10-18T01:00:00Z" });
    expect(s).toEqual({ kind: "paid", paidAt: "2026-10-18T01:00:00Z" });
  });

  test("the trade timeline row is Done only for a real payment", () => {
    const rows = (p: Partial<StatusFacts>) => jobTimeline(facts(p)).find((r) => r.key === "safety_paid")!;
    // Unknown is never "paid": the step stays open and says so.
    expect(rows({ safetyPaidAt: "2026-10-18T01:00:00Z", safetyPay: { kind: "unknown" } }))
      .toMatchObject({ label: "PIESA payment to confirm", state: "later" });
    // Real money closes the step.
    expect(rows({ safetyPaidAt: "2026-10-18T01:00:00Z", safetyPay: { kind: "paid", paidAt: "2026-10-18T01:00:00Z" } }))
      .toMatchObject({ label: "$349 paid", state: "done" });
    // An override keeps the step open and names itself.
    expect(rows({ safetyPay: { kind: "overridden", at: null } })).toMatchObject({ label: "Payment requirement overridden", state: "later" });
    expect(rows({ safetyPay: { kind: "unpaid" } })).toMatchObject({ label: "$349 due" });
    expect(rows({ staff: true, safetyPaidAt: "2026-10-18T01:00:00Z", safetyPay: { kind: "paid", paidAt: "2026-10-18T01:00:00Z" } }).label).toBe("PIESA paid");
  });

  test("the payment gate is unchanged: an override still clears it, with the same option", () => {
    // Regression guard for the "do not weaken eligibility rules" requirement.
    const base = {
      enabled: true, route: "hiv_lead" as const,
      currentQuote: { id: "q1", customer_total_inc_gst: 3178 },
      invoice: { quote_id: "q1", total_inc_gst: 3178, total_paid: 0 },
      plan: null, overrideCount: 1, safetyFeeIncGst: 349,
    };
    expect(evaluatePaymentGate(base)).toEqual({ cleared: true, option: "office_override" });
    expect(evaluatePaymentGate({ ...base, overrideCount: 0, invoice: { quote_id: "q1", total_inc_gst: 3178, total_paid: 349 } }))
      .toEqual({ cleared: true, option: "safety_check_paid" });
    expect(evaluatePaymentGate({ ...base, overrideCount: 0 }).cleared).toBe(false);
  });
});
