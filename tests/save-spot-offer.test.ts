import { describe, expect, test } from "bun:test";
import { SPOT_SAVED_HEADING, calculatorInsulation, originalEstimateBlocker, pickSaveSpotVariant } from "../src/lib/save-spot-offer.core";

// The old three-variant Save my spot email (Office "Prepare email to copy") was removed on 24 Oct 2026; variant
// selection and the personal-calculator rules below are still used.
describe("variant selection", () => {
  test("owner size vs assumed size", () => {
    expect(pickSaveSpotVariant({ route: "offer_spot", insulation: "none", mediaReview: null, criteriaPassed: false, areaAssumed: false })).toEqual({ variant: "no_insulation_owner_size", assumedArea: false });
    expect(pickSaveSpotVariant({ route: "offer_spot", insulation: "none", mediaReview: null, criteriaPassed: false, areaAssumed: true })).toEqual({ variant: "no_insulation_assumed_size", assumedArea: true });
  });
  test("reviewed variant only from recorded below-R2 review", () => {
    expect("blocked" in pickSaveSpotVariant({ route: "request_insulation", insulation: "present", mediaReview: null, criteriaPassed: true, areaAssumed: false })).toBe(true);
    expect("blocked" in pickSaveSpotVariant({ route: "request_insulation", insulation: "present", mediaReview: "over_r2", criteriaPassed: true, areaAssumed: false })).toBe(true);
    expect("blocked" in pickSaveSpotVariant({ route: "request_insulation", insulation: "none", mediaReview: "below_r2", criteriaPassed: true, areaAssumed: false })).toBe(true);
    expect(pickSaveSpotVariant({ route: "request_insulation", insulation: "present", mediaReview: "below_r2", criteriaPassed: true, areaAssumed: true })).toEqual({ variant: "reviewed_under_r2", assumedArea: true });
  });
});

describe("calculator choice", () => {
  const est = { area_m2: 150, area_source: "typical_default", insulation_declared: "none", hasPrice: true };
  test("original recoverable or fails clearly", () => {
    expect(originalEstimateBlocker({ estimate: est, ownerAreaKnown: false, reviewedUnderR2: false })).toBeNull();
    expect(originalEstimateBlocker({ estimate: null, ownerAreaKnown: false, reviewedUnderR2: false })).toContain("couldn’t find the original estimate");
    expect(originalEstimateBlocker({ estimate: est, ownerAreaKnown: true, reviewedUnderR2: false })).not.toBeNull();
    expect(originalEstimateBlocker({ estimate: { ...est, insulation_declared: "present" }, ownerAreaKnown: false, reviewedUnderR2: false })).not.toBeNull();
    expect(originalEstimateBlocker({ estimate: { ...est, insulation_declared: "present" }, ownerAreaKnown: false, reviewedUnderR2: true })).toBeNull();
  });
  test("calculator never changes recorded insulation", () => {
    expect(calculatorInsulation("present")).toBe("present");
    expect(calculatorInsulation("none")).toBe("none");
  });
  test("success heading", () => expect(SPOT_SAVED_HEADING).toBe("Your spot has been saved"));
});
