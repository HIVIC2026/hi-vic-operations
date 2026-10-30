import { expect, test } from "bun:test";
import { paysOwnElectricians, safetyCheckPayee, IN_HOUSE_PIESA_HOLD_REASON } from "../src/lib/installer-paid-electricians.core";
import { jobHeldByInHousePartner, partnerBillsRectification } from "../src/lib/in-house.core";
import { suggestBatches } from "../src/lib/in-house-batch.core";

test("Reinsulate pays its electricians at $350 without being held or partner-billed rectification", () => {
  const business = { id: "reinsulate", name: "Reinsulate", in_house: false, pays_own_electricians: true, piesaIncGst: 350, rectification_billed_by: "partner" as const };
  expect(paysOwnElectricians(business)).toBe(true);
  expect(safetyCheckPayee({ business, electricianChoice: "usual" })).toEqual({ businessId: "reinsulate", name: "Reinsulate", piesaIncGst: 350 });
  expect(safetyCheckPayee({ business, electricianChoice: "hivic" })).toBeNull();
  expect(safetyCheckPayee({ business: { ...business, piesaIncGst: null }, electricianChoice: "usual" })).toEqual({ businessId: "reinsulate", name: "Reinsulate", piesaIncGst: null, release_hold_reason: IN_HOUSE_PIESA_HOLD_REASON });
  expect(jobHeldByInHousePartner({ activeInstallerBusiness: business })).toBe(false);
  expect(partnerBillsRectification(business)).toBe(false);
});

test("in-house alone enables the flat PIESA payee AND held workflows; neither flag enables neither", () => {
  for (const in_house of [true, false]) {
    const business = { id: "b", name: "Partner", in_house, pays_own_electricians: false, piesaIncGst: 440 };
    expect(paysOwnElectricians(business)).toBe(in_house);
    expect(jobHeldByInHousePartner({ activeInstallerBusiness: business })).toBe(in_house);
    expect(safetyCheckPayee({ business, electricianChoice: "different" })).toEqual(in_house ? { businessId: "b", name: "Partner", piesaIncGst: 440 } : null);
  }
});

test("batch suggestions ignore payee-only partners even with capacity and coverage", () => {
  const job = { id: "j", source: "base44", deleted_at: null, stage: "preliminary_estimate_ready", spot_saved_at: "2026-10-30", optedOut: false, hasActiveInstaller: false, postcode: "3199", lat: null, lng: null };
  const partner = { id: "b", name: "Reinsulate", in_house: false, pays_own_electricians: true, is_active: true, openJobs: 0, service_postcodes: ["3199"], covers_all_victoria: false, coverage_lat: null, coverage_lng: null, coverage_radius_km: null };
  expect(suggestBatches([job], [partner])).toEqual([]);
  expect(suggestBatches([job], [{ ...partner, in_house: true, pays_own_electricians: false }])).toEqual([{ businessId: "b", jobIds: ["j"] }]);
});