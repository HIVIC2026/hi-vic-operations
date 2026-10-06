import { describe, expect, test } from "bun:test";
import { lookupLocation, ghgEquivalentReduction, A48_SPEC } from "../src/lib/activity48.core";
import { applyDiscountRules, computeEstimate, discountNotes, pickArea, DISCOUNT_REDUCED_MIN_NOTE, type RetailSettings } from "../src/lib/estimate.core";
import { buildInstallerQuoteDraft } from "../src/lib/installer-led.core";

// Jo, 5 Oct 2026 (VEU Industry Pack): NO maximum discount; only the $200 inc GST minimum customer contribution.
const S: RetailSettings = {
  id: "s1", version: 1, r5_install_inc_gst_per_m2: 30, removal_inc_gst_per_m2: 0, piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349,
  access_standard_multiplier: 1, access_moderate_multiplier: 1.1, access_difficult_multiplier: 1.25, indicative_veec_value: 70,
  veec_value_source_label: "x", veec_value_source_url: "https://www.energy.vic.gov.au/x", veec_value_checked_at: "2026-09-29",
  minimum_customer_copayment_inc_gst: 200, spec_version: "25.0", spec_source_url: A48_SPEC.sourceUrl,
  max_discount_metro_inc_gst: 1500, max_discount_regional_inc_gst: 2100, // retired values must be ignored
};
const owner = (m2: number) => pickArea({ owner: m2 })!;
const metro = lookupLocation("3058")!;
const regional = lookupLocation("3300")!;

describe("no maximum discount", () => {
  test("large discounts are never capped", () => {
    const r = applyDiscountRules(5000, 20000, true, S);
    expect(r.discount).toBe(5000); expect(r.cappedAtMax).toBe(false); expect(discountNotes(r)).toEqual([]);
  });
  for (const [name, loc] of [["metro", metro], ["regional", regional]] as const)
    for (const m2 of [50, 150, 300, 600])
      test(`${name} ${m2} m²: full calculated discount unless the $200 minimum applies`, () => {
        const e = computeEstimate(owner(m2), loc, "none", S);
        const t = e.primary.by_access.standard;
        expect(t.applied_discount).toBeCloseTo(Math.min(e.raw_estimated_discount, t.pre_discount_total - 200), 2);
        expect(t.estimated_customer_total).toBeGreaterThanOrEqual(200 - 0.005);
        expect(t.cap_applied).toBe(false);
      });
});

describe("$200 minimum contribution", () => {
  test("discount reduced so customer pays $200, with approved line", () => {
    const r = applyDiscountRules(1200, 1298, true, S);
    expect(r.discount).toBe(1098); expect(r.reducedForMin).toBe(true);
    expect(discountNotes(r)).toEqual([DISCOUNT_REDUCED_MIN_NOTE]);
    expect(DISCOUNT_REDUCED_MIN_NOTE).toBe("Discount reduced so the minimum $200 customer contribution applies");
  });
  test("installer draft quote: big discount not capped; cheap job reduced to $200", () => {
    const price = (t: number) => ({ price: { totalIncGst: t, included: ["Supply and install insulation"], otherDescription: null }, issues: [] }) as never;
    const caps = { metropolitan: true, minCopay: 200 };
    const big = buildInstallerQuoteDraft({ price: price(9000), measuredM2: 600, wholeVeec: { veecs: Math.floor(60), raw: Math.floor(60) * 70 }, piesaIncGst: 349, apFeeIncGst: 349, caps });
    expect(big.discount).toBe(4200);
    const cheap = buildInstallerQuoteDraft({ price: price(400), measuredM2: 100, wholeVeec: { veecs: Math.floor(15), raw: Math.floor(15) * 70 }, piesaIncGst: 349, apFeeIncGst: 349, caps });
    expect(cheap.discount).toBe(898); expect(cheap.afterDiscount).toBeCloseTo(200, 2);
    expect(cheap.discountNote).toContain("minimum $200 customer contribution");
  });
});

test("Industry Pack worked example: 0.00546 × 150 × 25 × 1.04 = 21 VEECs", () => {
  const g = ghgEquivalentReduction(150, { metropolitan_or_regional: "Regional", climate_region: "Hot" } as never);
  expect(Math.floor(g.ghgReduction)).toBe(21);
});
