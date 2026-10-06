// Independent maths check (Jo, 6 Oct 2026). Recomputes from scratch with Spec v25 constants typed in here,
// NOT imported from the app, then compares with the app's estimate core to the cent.
import { describe, expect, test } from "bun:test";
import { computeEstimate, discountIsWholeVeecs, type RetailSettings } from "../src/lib/estimate.core";

const GHG = { Mild: 0.00576, Cold: 0.00771, Hot: 0.00546 } as const;
const REGIONAL = { Metropolitan: 0.98, Regional: 1.04 } as const;
export function independent(m2: number, climate: keyof typeof GHG, metro: keyof typeof REGIONAL) {
  const veecs = Math.floor(GHG[climate] * m2 * 25 * REGIONAL[metro]);
  const gross = m2 * 30 + 349 + 349;
  const discount = Math.min(veecs * 70, Math.max(0, gross - 200));
  return { veecs, discount, total: Math.round((gross - discount) * 100) / 100 };
}

const settings = { id: "s", version: 2, r5_install_inc_gst_per_m2: 30, removal_inc_gst_per_m2: 0, piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349, access_standard_multiplier: 1, access_moderate_multiplier: 1, access_difficult_multiplier: 1, indicative_veec_value: 70, minimum_customer_copayment_inc_gst: 200 } as unknown as RetailSettings;
const loc = (postcode: string, metropolitan_or_regional: "Metropolitan" | "Regional", climate_region: "Mild" | "Cold" | "Hot") => ({ postcode, metropolitan_or_regional, climate_region, reticulated_gas: true, climate_zone: 4, source_version: "25.0", source_url: "", source_sha256: null }) as never;
const app = (m2: number, l: never) => { const e = computeEstimate({ m2, source: "owner_estimate", basis: "declared", id: null, label: "x" }, l, "none", settings); return { discount: e.applied_discount, total: e.primary.by_access.standard.estimated_customer_total }; };

describe("Jo's hand-calculated spot checks", () => {
  const cases: [string, number, never, number, number, number][] = [
    ["150 m² Melbourne", 150, loc("3805", "Metropolitan", "Mild"), 21, 1470, 3728],
    ["200 m² Melbourne", 200, loc("3000", "Metropolitan", "Mild"), 28, 1960, 4738],
    ["125 m² Geelong 3216", 125, loc("3216", "Regional", "Mild"), 18, 1260, 3188],
    ["244 m² Horsham 3400", 244, loc("3400", "Regional", "Cold"), 48, 3360, 4658],
    ["40 m² 3078", 40, loc("3078", "Metropolitan", "Mild"), 5, 350, 1548],
  ];
  for (const [name, m2, l, veecs, discount, total] of cases) test(name, () => {
    const ind = independent(m2, (l as { climate_region: "Mild" }).climate_region, (l as { metropolitan_or_regional: "Metropolitan" }).metropolitan_or_regional);
    expect(ind).toEqual({ veecs, discount, total });
    expect(app(m2, l)).toEqual({ discount, total });
  });
});

describe("whole-VEEC send check", () => {
  test("blocks part-VEEC discounts", () => {
    expect(discountIsWholeVeecs(1470, 3728, 70)).toBe(true);
    expect(discountIsWholeVeecs(1481.76, 3716.24, 70)).toBe(false);
    expect(discountIsWholeVeecs(569, 1857, 70)).toBe(false);
  });
  test("allows a discount reduced only for the $200 minimum", () => expect(discountIsWholeVeecs(123.45, 200, 70)).toBe(true));
});
