// Phase 3 path 1 (Jo 27 Oct 2026): a "needs review" eligibility result is a hard stop the office must act on —
// one Needs me row, and the job page's Next panel never says "Nothing for the office to do".
import { describe, expect, test } from "bun:test";
import { buildNeedsRows, eligibilityReviewLine, needsCandidates } from "../src/lib/office-needs.core";

const base = { jobId: "J", jobNumber: "HV-1", surname: "Test", suburb: null };

describe("eligibility needs review → Needs me", () => {
  test("one row for the job, in Today, opening the Ready Check card", () => {
    const rows = buildNeedsRows({ now: Date.now(), jobs: [{ ...base, eligibilityReview: { at: new Date().toISOString(), reason: "Insulation answers missing" } }] });
    const mine = Object.values(rows).flat().filter((r) => r.jobId === "J");
    expect(mine.length).toBe(1);
    expect(mine[0]!.kind).toBe("eligibility_review");
    expect(mine[0]!.group).toBe("today");
    expect(mine[0]!.line).toBe("Eligibility needs review · Insulation answers missing");
  });
  test("no row without a needs-review result", () => {
    expect(needsCandidates({ ...base }, Date.now()).some((c) => c.kind === "eligibility_review")).toBe(false);
  });
  test("plain default reason when none was typed", () => {
    expect(eligibilityReviewLine(null)).toBe("Eligibility needs review · Ready Check answers missing or conflicting");
  });
});

import { openPaymentReversal } from "../src/lib/office-needs.core";
describe("payment reversed → one Money row until paid again", () => {
  test("reversal is the newest payment event → row with the amount", () => {
    const o = openPaymentReversal([{ event_type: "owner_payment_recorded", created_at: "2026-10-27T01:00:00Z", amount_cents: 34900 }, { event_type: "owner_payment_reversed", created_at: "2026-10-27T02:00:00Z", amount_cents: 34900 }]);
    expect(o?.text).toBe("$349.00 no longer counted · ask the owner to pay again");
    const rows = buildNeedsRows({ now: Date.now(), jobs: [{ ...base, paymentReversed: o }] });
    expect(Object.values(rows).flat().filter((r) => r.kind === "payment_reversed").length).toBe(1);
  });
  test("a payment after the reversal clears it", () => {
    expect(openPaymentReversal([{ event_type: "owner_payment_reversed", created_at: "2026-10-27T02:00:00Z" }, { event_type: "owner_payment_recorded", created_at: "2026-10-27T03:00:00Z" }])).toBeNull();
  });
});

describe("refused Mitti form → one Needs me row", () => {
  test("wrong job number shows once with the reason", () => {
    const rows = buildNeedsRows({ now: Date.now(), jobs: [{ ...base, mittiFormProblem: { at: "2026-10-27T16:00:00Z", error: "Mitti Portal Job Number (HV-0001) does not match HV-3461." } }] });
    const r = Object.values(rows).flat().filter((x) => x.kind === "mitti_form_problem");
    expect(r.length).toBe(1);
    expect(r[0]!.line).toBe("Mitti form refused · Mitti Portal Job Number (HV-0001) does not match HV-3461.");
  });
});
