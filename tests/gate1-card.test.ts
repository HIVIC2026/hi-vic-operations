import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

// Static assertion: pipeline/job card badge precedence for Gate 1 during
// new_enquiry / eligibility_review — display-only, no business logic.
const src = readFileSync(new URL("../src/components/portal/JobCard.tsx", import.meta.url), "utf8");

describe("JobCard Gate 1 labels (display only)", () => {
  it("shows REVIEW REQUIRED only when eligibility_review_required is true, and never doubled with the stage label", () => {
    expect(src).toContain('job.eligibility_review_required && step.label !== "Review required" ? <Pill t="warn">Review required</Pill>');
  });

  it("shows Needs onsite confirmation for needs_onsite_confirmation", () => {
    expect(src).toContain('job.eligibility_outcome === "needs_onsite_confirmation" ?');
  });

  it("adds a green Likely eligible label for likely_eligible", () => {
    expect(src).toContain('job.eligibility_outcome === "likely_eligible" ?');
    expect(src).toContain("Likely Eligible");
    expect(src).toContain('<Pill t="good">Likely Eligible</Pill>');
  });

  it("checks review-required before likely_eligible (no dual label)", () => {
    const reviewIdx = src.indexOf("job.eligibility_review_required");
    const likelyIdx = src.indexOf('job.eligibility_outcome === "likely_eligible"');
    expect(reviewIdx).toBeGreaterThan(-1);
    expect(likelyIdx).toBeGreaterThan(reviewIdx);
  });

  it("shows ineligible state in retained views", () => {
    expect(src).toContain("does_not_appear_eligible");
  });
});
