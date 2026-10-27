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
