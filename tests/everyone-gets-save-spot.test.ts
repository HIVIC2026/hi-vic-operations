import { expect, test } from "bun:test";
import { spotSavedRank, compareSpots, spotSummary } from "../src/lib/spot-saved-rank.core";
import { insulationTapRoute } from "../src/lib/insulation-details.core";
import { renderJoEstimateEmail, EXISTING_SAVE_SPOT_LINE, THIN_PATCHY_SAVE_SPOT_LINE } from "../src/lib/jo-email-templates.core";

const b = { reviewOutcome: null, hadUnclearReview: false, deskLooksEligible: false, declared: "present", mediaCount: 0, tap: null, declaredThinPatchy: false } as const;
test("Jo 08:23 ranks 1-8", () => {
  expect(spotSavedRank({ ...b, reviewOutcome: "no_insulation", mediaCount: 2 })).toBe(1);
  expect(spotSavedRank({ ...b, reviewOutcome: "below_r2", mediaCount: 2 })).toBe(2);
  expect(spotSavedRank({ ...b, reviewOutcome: "below_r2", hadUnclearReview: true, mediaCount: 2 })).toBe(3);
  expect(spotSavedRank({ ...b, deskLooksEligible: true })).toBe(3);
  expect(spotSavedRank({ ...b, declared: "none" })).toBe(4);
  expect(spotSavedRank({ ...b, tap: { insulation_type: "batts", insulation_thickness: "thicker", house_built_period: "1990_or_earlier" } })).toBe(5);
  expect(spotSavedRank({ ...b, tap: { insulation_type: "loose_fill", insulation_thickness: "hand" } })).toBe(5);
  expect(spotSavedRank({ ...b, tap: { insulation_type: "batts", insulation_thickness: "thin" } })).toBe(5);
  expect(spotSavedRank({ ...b, tap: { insulation_type: "batts", insulation_thickness: "hand", house_built_period: "2000_2009" } })).toBe(6);
  expect(spotSavedRank({ ...b, tap: { insulation_type: "batts", insulation_thickness: "thicker" } })).toBe(6);
  expect(spotSavedRank({ ...b, tap: { insulation_type: "unknown", insulation_thickness: "unknown" } })).toBe(7);
  expect(spotSavedRank({ ...b, declared: "unknown" })).toBe(7);
  expect(spotSavedRank({ ...b })).toBe(8);
});
test("no 'photos not checked' rank: unchecked photos rank by what the owner said", () => {
  expect(spotSavedRank({ ...b, mediaCount: 3 })).toBe(8);
  expect(spotSavedRank({ ...b, declared: "none", mediaCount: 3 })).toBe(4);
});
test("a later photo review moves the rank", () => {
  expect(spotSavedRank({ ...b, declared: "none", mediaCount: 3, reviewOutcome: "no_insulation" })).toBe(1);
  expect(spotSavedRank({ ...b, mediaCount: 3, reviewOutcome: "below_r2" })).toBe(2);
});
test("one-line facts", () => {
  expect(spotSummary({ owner: "Sam Lee", suburb: "Preston", houseAge: "1990 or earlier", mediaCount: 2, areaM2: 150, spotSavedAt: "2026-10-20T00:00:00Z" }, Date.parse("2026-10-23T08:00:00Z"))).toBe("Sam Lee · Preston · built 1990 or earlier · 150 m² · 📷 2 · waiting 3 days");
});
test("longest waiting first within a rank", () => {
  expect(compareSpots({ rank: 7, spotSavedAt: "2026-10-01" }, { rank: 7, spotSavedAt: "2026-10-20" })).toBeLessThan(0);
});
const fig = { veuRebate: 1258, customerTotal: 2341, totalBeforeRebate: 3599, installation: 2901, piesaFee: 349, apFee: 349, ceilingAreaM2: 150, areaEstimated: false, removalUpTo: 2250 } as never;
const r = { firstName: "Sam", propertyAddress: "1 St", enquiryReference: "HV-1" } as never;
test("standard existing wording has removal line and never says thin", () => {
  const t = renderJoEstimateEmail("eligible_no_insulation_size_known" as never, r, fig, { declaredExisting: true }).body;
  expect(t).toContain(EXISTING_SAVE_SPOT_LINE); expect(t).not.toContain(THIN_PATCHY_SAVE_SPOT_LINE); expect(t).toContain("up to $2,250");
});
test("thin wording only for thin/loose fill", () => {
  const t = renderJoEstimateEmail("eligible_no_insulation_size_known" as never, r, fig, { declaredThinPatchy: true }).body;
  expect(t).toContain(THIN_PATCHY_SAVE_SPOT_LINE); expect(t).not.toContain(EXISTING_SAVE_SPOT_LINE);
});
