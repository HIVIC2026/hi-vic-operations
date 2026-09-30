import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { lookupLocation, V25_LOCATIONS } from "../src/lib/activity48.core";
import { whatIfEstimate } from "../src/lib/estimate.core";
import { acceptSelectedAddress, locationBasisLine, resolveWhatIfLocation, WHATIF_ADDRESS_COPY, type SelectedAddress } from "../src/lib/whatif-location";
const sel = (postcode: string): SelectedAddress => ({ label: `1 Test St VIC ${postcode}`, postcode, state: "VIC", latitude: null, longitude: null });

const settings = { id: "t", version: 2, r5_install_inc_gst_per_m2: 30, removal_inc_gst_per_m2: 15, piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349, access_standard_multiplier: 1, access_moderate_multiplier: 1.1, access_difficult_multiplier: 1.25, indicative_veec_value: 70, minimum_customer_copayment_inc_gst: 200 } as never;
const original = lookupLocation("3336")!;
const disc = (loc: typeof original) => whatIfEstimate(150, loc, "none" as never, settings)!.scenarios[0]!.by_access.standard.applied_discount;

describe("address-aware what-if calculator", () => {
  test("original 3336 matches baseline and same postcode reproduces it", () => {
    const r = resolveWhatIfLocation(original, null);
    expect(r.status).toBe("original");
    expect(disc(original)).toBeCloseTo(1481.76, 2);
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
  test("UI wiring: local only, never persisted or sent via onUse; referral copy updated", () => {
    const ui = readFileSync("src/components/portal/estimate.tsx", "utf8");
    const calc = ui.slice(ui.indexOf("export function AreaCalculator"), ui.indexOf("export function OwnerEstimateCard"));
    for (const t of ["WHATIF_ADDRESS_COPY.change", "WHATIF_ADDRESS_COPY.revert", "WHATIF_ADDRESS_COPY.notice", "WHATIF_ADDRESS_COPY.unlisted", "locationBasisLine(activeLocation)", "VictorianAddressAutocomplete", "TRY ANOTHER PROPERTY OR CEILING SIZE"]) expect(calc).toContain(t);
    expect(calc).not.toMatch(/Postcode<|inputMode="numeric"|postcodeFromAddress|CHECK ANOTHER CEILING SIZE/);
    const ac = readFileSync("src/components/portal/VictorianAddressAutocomplete.tsx", "utf8");
    for (const t of ['role="combobox"', 'role="listbox"', "aria-selected", "ArrowDown", "Escape", "min-h-11", "onSelect(null)"]) expect(ac).toContain(t);
    const proxy = readFileSync("src/lib/address-search.functions.ts", "utf8");
    expect(proxy).not.toMatch(/supabase|upsert|\.insert\(|\.update\(|GOOGLE_[A-Z_]*KEY|process\.env/);
    expect(calc).toContain("onUse(m2)");
    expect(calc).not.toMatch(/onUse\([^)]*(altPostcode|altAddress|activeLocation)/);
    expect(calc).not.toMatch(/useServerFn|supabase|fetch\(/);
    expect(calc).not.toMatch(/climate_region|climate_zone|metropolitan_or_regional/);
    expect(WHATIF_ADDRESS_COPY.notice).toBe("This address is used only for this calculator comparison. It does not change the property on your enquiry.");
    const share = readFileSync("src/components/portal/ReferralShare.tsx", "utf8");
    expect(share).toContain("property address so");
    expect(share).toContain("correct local VEU settings");
    expect(share).not.toContain("HI VIC with");
  });
});
