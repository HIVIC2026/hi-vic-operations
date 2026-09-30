import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { lookupLocation, V25_LOCATIONS } from "../src/lib/activity48.core";
import { whatIfEstimate } from "../src/lib/estimate.core";
import { locationBasisLine, postcodeFromAddress, resolveWhatIfLocation, WHATIF_ADDRESS_COPY } from "../src/lib/whatif-location";

const settings = { r5_install_inc_gst_per_m2: 30, removal_inc_gst_per_m2: 15, piesa_fee_inc_gst: 349, ap_fee_inc_gst: 349, min_copayment_inc_gst: 200, indicative_veec_value: 70, access_moderate_multiplier: 1.1, access_difficult_multiplier: 1.25 } as never;
const original = lookupLocation("3336")!;
const disc = (loc: typeof original) => whatIfEstimate(150, loc, "none" as never, settings)!.scenarios[0]!.by_access.standard.applied_discount;

describe("address-aware what-if calculator", () => {
  test("original 3336 matches baseline and same postcode reproduces it", () => {
    const r = resolveWhatIfLocation(original, null);
    expect(r.status).toBe("original");
    expect(disc(original)).toBeCloseTo(1481.76, 2);
    const same = resolveWhatIfLocation(original, "3336");
    expect(same.status === "alternate" && disc(same.location)).toBeCloseTo(disc(original), 6);
  });
  test("postcode with a different v25 factor changes the discount", () => {
    const other = [...V25_LOCATIONS.values()].find((l) => l.metropolitan_or_regional !== original.metropolitan_or_regional || l.climate_region !== original.climate_region)!;
    const r = resolveWhatIfLocation(original, other.postcode);
    expect(r.status).toBe("alternate");
    if (r.status === "alternate") expect(disc(r.location)).not.toBeCloseTo(disc(original), 2);
  });
  test("unlisted or malformed postcode yields no estimate (no range approximation)", () => {
    expect(resolveWhatIfLocation(original, "0000").status).toBe("unlisted");
    expect(resolveWhatIfLocation(original, "33").status).toBe("invalid");
    expect(resolveWhatIfLocation(original, "abcd").status).toBe("invalid");
  });
  test("revert restores original location", () => {
    const r = resolveWhatIfLocation(original, null);
    expect(r.status === "original" && r.location).toBe(original);
  });
  test("address postcode autofill + basis line", () => {
    expect(postcodeFromAddress("12 Main St, Ballarat VIC 3350")).toBe("3350");
    expect(postcodeFromAddress("1234 Long Rd, Geelong VIC 3220")).toBe("3220");
    expect(postcodeFromAddress("No postcode")).toBeNull();
    expect(locationBasisLine(original)).toBe("VEU estimate based on postcode 3336.");
  });
  test("UI wiring: local only, never persisted or sent via onUse; referral copy updated", () => {
    const ui = readFileSync("src/components/portal/estimate.tsx", "utf8");
    const calc = ui.slice(ui.indexOf("export function AreaCalculator"), ui.indexOf("export function OwnerEstimateCard"));
    for (const t of ["WHATIF_ADDRESS_COPY.change", "WHATIF_ADDRESS_COPY.revert", "WHATIF_ADDRESS_COPY.notice", "WHATIF_ADDRESS_COPY.unlisted", "locationBasisLine(activeLocation)", "VIC"]) expect(calc).toContain(t);
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
