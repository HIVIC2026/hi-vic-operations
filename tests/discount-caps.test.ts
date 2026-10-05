import { describe, expect, test } from "bun:test";
import { lookupLocation } from "../src/lib/activity48.core";
import {
  applyDiscountRules, computeEstimate, discountNotes, pickArea,
  DISCOUNT_CAPPED_NOTE, DISCOUNT_REDUCED_MIN_NOTE, type RetailSettings,
} from "../src/lib/estimate.core";
import { buildInstallerQuoteDraft } from "../src/lib/installer-led.core";
import { A48_SPEC } from "../src/lib/activity48.core";

const S: RetailSettings = {
  id: "s1", version: 1, r5_install_inc_gst_per_m2: 30, removal_inc_gst_per_m2: 0, piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349,
  access_standard_multiplier: 1, access_moderate_multiplier: 1.1, access_difficult_multiplier: 1.25, indicative_veec_value: 70,
  veec_value_source_label: "DEECA webinar", veec_value_source_url: "https://www.energy.vic.gov.au/x", veec_value_checked_at: "2026-09-29",
  minimum_customer_copayment_inc_gst: 200, spec_version: "25.0", spec_source_url: A48_SPEC.sourceUrl,
  max_discount_metro_inc_gst: 1500, max_discount_regional_inc_gst: 2100,
};
const owner = (m2: number) => pickArea({ owner: m2 })!;
const metro = lookupLocation("3058")!; // Metropolitan / Mild
const regional = lookupLocation("3300")!; // Regional / Cold

describe("applyDiscountRules", () => {
  test("no cap when under the maximum", () => {
    const r = applyDiscountRules(800, 5000, true, S);
    expect(r.discount).toBe(800); expect(r.cappedAtMax).toBe(false); expect(r.reducedForMin).toBe(false);
  });
  test("metro cap $1,500", () => {
    const r = applyDiscountRules(3000, 20000, true, S);
    expect(r.discount).toBe(1500); expect(r.cappedAtMax).toBe(true);
  });
  test("regional cap $2,100", () => {
    const r = applyDiscountRules(3000, 20000, false, S);
    expect(r.discount).toBe(2100); expect(r.cappedAtMax).toBe(true);
  });
  test("unknown region fails safe to the metro cap", () => {
    const r = applyDiscountRules(3000, 20000, null, S);
    expect(r.discount).toBe(1500); expect(r.cappedAtMax).toBe(true);
  });
  test("$200 minimum contribution reduces the discount", () => {
    const r = applyDiscountRules(900, 1000, true, S);
    expect(r.discount).toBe(800); expect(r.reducedForMin).toBe(true); expect(r.cappedAtMax).toBe(false);
  });
  test("discount never exceeds the pre-discount total minus $200", () => {
    const r = applyDiscountRules(5000, 300, true, S);
    expect(r.discount).toBe(100); expect(r.reducedForMin).toBe(true);
  });
  test("notes carry the approved wording", () => {
    expect(discountNotes(applyDiscountRules(3000, 20000, true, S))).toEqual([DISCOUNT_CAPPED_NOTE]);
    expect(discountNotes(applyDiscountRules(900, 1000, true, S))).toEqual([DISCOUNT_REDUCED_MIN_NOTE]);
    expect(DISCOUNT_CAPPED_NOTE).toBe("Government discount (capped at the program maximum)");
    expect(DISCOUNT_REDUCED_MIN_NOTE).toBe("Discount reduced so the minimum $200 customer contribution applies");
  });
});

describe("calculator estimate caps (metro 3058 Mild, regional 3300 Cold)", () => {
  for (const m2 of [50, 150, 300, 600]) {
    test(`metro ${m2} m² discount never exceeds $1,500`, () => {
      const e = computeEstimate(owner(m2), metro, "none", S);
      const t = e.primary.by_access.standard;
      expect(t.applied_discount).toBeLessThanOrEqual(1500);
      expect(t.estimated_customer_total).toBeCloseTo(t.pre_discount_total - t.applied_discount, 2);
      if (e.raw_estimated_discount > 1500) expect(t.cap_applied).toBe(true);
    });
    test(`regional ${m2} m² discount never exceeds $2,100`, () => {
      const e = computeEstimate(owner(m2), regional, "none", S);
      const t = e.primary.by_access.standard;
      expect(t.applied_discount).toBeLessThanOrEqual(2100);
      expect(t.estimated_customer_total).toBeCloseTo(t.pre_discount_total - t.applied_discount, 2);
      if (e.raw_estimated_discount > 2100) expect(t.cap_applied).toBe(true);
    });
  }
  test("600 m² metro is capped (raw discount is in the thousands)", () => {
    const e = computeEstimate(owner(600), metro, "none", S);
    expect(e.raw_estimated_discount).toBeGreaterThan(1500);
    expect(e.primary.by_access.standard.applied_discount).toBe(1500);
    expect(e.primary.by_access.standard.cap_applied).toBe(true);
  });
  test("cheap job: customer still pays at least $200", () => {
    const e = computeEstimate(owner(20), metro, "none", S); // 20×30+698 = 1298 pre-discount
    const t = e.primary.by_access.standard;
    expect(t.estimated_customer_total).toBeGreaterThanOrEqual(200);
    if (t.copayment_capped) expect(t.estimated_customer_total).toBeCloseTo(200, 2);
  });
});

describe("installer-supplied draft quote caps", () => {
  const price = { price: { totalIncGst: 3000, included: ["Supply and install insulation"], otherDescription: null }, issues: [] } as never;
  test("discount capped at metro maximum and noted", () => {
    const d = buildInstallerQuoteDraft({
      price, measuredM2: 600, ghgReduction: 60, veecValue: 70, piesaIncGst: 349, apFeeIncGst: 349,
      caps: { metropolitan: true, maxMetro: 1500, maxRegional: 2100, minCopay: 200 },
    });
    expect(d.discount).toBe(1500);
    expect(d.discountNote).toContain("capped at the program maximum");
    expect(d.afterDiscount).toBeCloseTo(3000 + 349 + 349 - 1500, 2);
  });
  test("cheap job: discount auto-reduced so the customer pays $200 (not blocked)", () => {
    const d = buildInstallerQuoteDraft({
      price, measuredM2: 100, ghgReduction: 5, veecValue: 70, piesaIncGst: 349, apFeeIncGst: 349,
      caps: { metropolitan: true, maxMetro: 1500, maxRegional: 2100, minCopay: 200 },
    });
    // pre = 3698, raw = 350 → under cap, no reduction
    expect(d.discount).toBe(350);
    const cheap = buildInstallerQuoteDraft({
      price: { price: { totalIncGst: 400, included: ["Supply and install insulation"], otherDescription: null }, issues: [] } as never,
      measuredM2: 100, ghgReduction: 15, veecValue: 70, piesaIncGst: 349, apFeeIncGst: 349,
      caps: { metropolitan: true, maxMetro: 1500, maxRegional: 2100, minCopay: 200 },
    });
    // pre = 1098, raw = 1050 → reduced to 898 so customer pays 200
    expect(cheap.discount).toBe(898);
    expect(cheap.afterDiscount).toBeCloseTo(200, 2);
    expect(cheap.discountNote).toContain("minimum $200 customer contribution");
    expect(cheap.ready).toBe(true);
  });
});
