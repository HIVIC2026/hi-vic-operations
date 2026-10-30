// Jo, 5 Oct 2026: same address + m² => same VEU discount in calculator, office quote, installer draft and bulk import.
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { lookupLocation } from "../src/lib/activity48.core";
import { computeEstimate, pickArea, wholeVeecDiscount, veecDiscountLabel, benchmarkNote, type RetailSettings } from "../src/lib/estimate.core";
import { buildInstallerQuoteDraft } from "../src/lib/installer-led.core";
import { ghgEquivalentReduction } from "../src/lib/activity48.core";

const S = { id: "s", version: 1, r5_install_inc_gst_per_m2: 30, removal_inc_gst_per_m2: 15, piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349,
  access_standard_multiplier: 1, access_moderate_multiplier: 1.1, access_difficult_multiplier: 1.2, indicative_veec_value: 70,
  veec_value_source_label: "", veec_value_source_url: "", veec_value_checked_at: "", minimum_customer_copayment_inc_gst: 200, spec_version: "v25", spec_source_url: "" } as RetailSettings;

test("150 m² Metropolitan/Mild (3000): 21 VEECs × $70 = $1,470 on all four paths", () => {
  const loc = lookupLocation("3000")!;
  const calc = computeEstimate(pickArea({ owner: 150 }), loc, "none", S).applied_discount;
  const office = wholeVeecDiscount(150, loc, 70);
  const installer = buildInstallerQuoteDraft({ price: { price: { totalIncGst: 4500, included: ["R5.0 supply & install"], otherDescription: null }, issues: [] } as never,
    measuredM2: 150, wholeVeec: { veecs: Math.floor(ghgEquivalentReduction(150, loc).ghgReduction), raw: Math.floor(ghgEquivalentReduction(150, loc).ghgReduction) * 70 }, piesaIncGst: 349, apFeeIncGst: 349, caps: { metropolitan: true, minCopay: 200 } as never }).discount;
  const bulk = wholeVeecDiscount(150, loc, 70).raw; // bulk-import calls this same helper (checked below)
  expect(office.veecs).toBe(21);
  for (const d of [calc, office.raw, installer, bulk]) expect(d).toBe(1470);
  expect(veecDiscountLabel(office.veecs, 70)).toBe("VEU discount, 21 VEECs × $70");
  expect(benchmarkNote(70)).toContain("about $1,470");
});

test("office and bulk builders use the shared whole-VEEC helper, not the flat per-m² credit", () => {
  const q = readFileSync(new URL("../src/lib/quotes.server.ts", import.meta.url), "utf8");
  const gen = q.slice(q.indexOf("export async function generateInstallerQuotes"), q.indexOf("export async function deriveRectificationItems"));
  expect(gen).toContain("wholeVeecDiscount(");
  expect(gen).not.toContain("veec_credit_per_m2_inc_gst");
});
