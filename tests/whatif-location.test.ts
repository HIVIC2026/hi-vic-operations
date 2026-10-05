import { describe, expect, test } from "bun:test";
import { lookupLocation, V25_LOCATIONS } from "../src/lib/activity48.core";
import { whatIfEstimate } from "../src/lib/estimate.core";
import { acceptSelectedAddress, locationBasisLine, resolveWhatIfLocation, WHATIF_ADDRESS_COPY, type SelectedAddress } from "../src/lib/whatif-location";
const sel = (postcode: string): SelectedAddress => ({ label: `1 Test St VIC ${postcode}`, postcode, state: "VIC", latitude: null, longitude: null });

const settings = { id: "t", version: 2, r5_install_inc_gst_per_m2: 30, removal_inc_gst_per_m2: 0, piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349, access_standard_multiplier: 1, access_moderate_multiplier: 1.1, access_difficult_multiplier: 1.25, indicative_veec_value: 70, minimum_customer_copayment_inc_gst: 200, max_discount_metro_inc_gst: 1500, max_discount_regional_inc_gst: 2100 } as never;
const original = lookupLocation("3336")!;
const disc = (loc: typeof original) => whatIfEstimate(150, loc, "none" as never, settings)!.scenarios[0]!.by_access.standard.applied_discount;

describe("address-aware what-if calculator", () => {
  test("original 3336 matches baseline and same postcode reproduces it", () => {
    const r = resolveWhatIfLocation(original, null);
    expect(r.status).toBe("original");
    expect(disc(original)).toBeCloseTo(1470, 2);
    const same = resolveWhatIfLocation(original, sel("3336"));
    expect(same.status === "alternate" && disc(same.location)).toBeCloseTo(disc(original), 6);
  });
  test("postcode with a different v25 factor changes the discount", () => {
    const other = [...V25_LOCATIONS.values()].find((l) => l.metropolitan_or_regional !== original.metropolitan_or_regional || l.climate_region !== original.climate_region)!;
    const r = resolveWhatIfLocation(original, sel(other.postcode));
    expect(r.status).toBe("alternate");
    if (r.status === "alternate") expect(disc(r.location)).not.toBeCloseTo(disc(original), 2);
  });
  test("unlisted or malformed postcode yields no estimate (no range approximation)", () => {
    expect(resolveWhatIfLocation(original, sel("3999")).status).toBe("unlisted");
    expect(resolveWhatIfLocation(original, sel("33")).status).toBe("invalid");
    expect(resolveWhatIfLocation(original, { ...sel("2000"), state: "NSW" } as never).status).toBe("invalid");
  });
  test("revert restores original location", () => {
    const r = resolveWhatIfLocation(original, null);
    expect(r.status === "original" && r.location).toBe(original);
  });
  test("selected detail fills postcode/state; non-VIC rejected; Ballarat changes discount", () => {
    const ok = acceptSelectedAddress({ label: "Main St, Golden Point VIC 3350", postcode: "3350", state: "VIC", latitude: -37.57, longitude: 143.86 });
    expect(ok).toEqual({ ok: true, address: { label: "Main St, Golden Point VIC 3350", postcode: "3350", state: "VIC", latitude: -37.57, longitude: 143.86 } });
    const r = ok.ok ? resolveWhatIfLocation(original, ok.address) : null;
    expect(r?.status).toBe("alternate");
    if (r?.status === "alternate") expect(disc(r.location)).not.toBeCloseTo(disc(original), 2);
    expect(acceptSelectedAddress({ label: "1 George St, Sydney NSW 2000", postcode: "2000", state: "NSW" }).ok).toBe(false);
    expect(acceptSelectedAddress({ label: "Albury NSW 3000?", postcode: "3000", state: "NSW" }).ok).toBe(false);
    expect(acceptSelectedAddress({ label: "x", postcode: null, state: "VIC" }).ok).toBe(false);
    expect(acceptSelectedAddress(null).ok).toBe(false);
    expect(locationBasisLine(original)).toBe("VEU estimate based on postcode 3336.");
  });
});
