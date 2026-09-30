// Provisional installer-supplied measurements + pilot dual verification. Pure rules + source checks.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { acceptanceBlockers, measurementVariance, parseMethod, parsePurpose, varianceWithinTolerance, verifierBlocker } from "../src/lib/measurement.core";
import { planImportedMeasurement } from "../src/lib/pilot.core";
import { deriveScope } from "../src/lib/scope.core";

const noPiesa = { hasCurrentPiesa: false, piesaExpired: false };
const prov = { provenance: "installer_supplied_provisional", measurement_method: "laser", measurement_purpose: "onsite_measured", supplied_area_m2: 120, verified_area_m2: null, verified_at: null };

describe("imported installer measurement is provisional", () => {
  const m = planImportedMeasurement({ measured_area_m2: 120, removal_required: true, removal_m2: 40, existing_r_value: 1, measurement_method: "Leica laser", measurement_purpose: "onsite", measured_by: "Deep", measured_on: "2026-09-20" }, "imp-1", { businessId: "b1" })!;
  test("supplied figures preserved; relevant area left for onsite measurement; method/purpose captured", () => {
    expect(m).toMatchObject({ provenance: "installer_supplied_provisional", supplied_area_m2: 120, supplied_removal_m2: 40, measured_area_m2: null, measurement_method: "laser", measurement_purpose: "onsite_measured", measured_by_business_id: "b1", measured_on: "2026-09-20", status: "needs_review" });
    expect((m.review_flags as { field: string }[]).map((f) => f.field)).toEqual(["measured_area_m2", "removal_m2"]);
  });
  test("keeps the installer measure-up incomplete while the electrician remains PIESA-only", () => {
    const s = deriveScope({ measurement: { ...m, access_difficulty: "easy", insulation_present: true } as never, electrical: noPiesa });
    expect(s.scope).toBe("ELECTRICAL_PLUS_MEASUREUP_COMPLETION");
    expect(s.electricianTasks).toEqual(["electrical"]);
    expect(s.installerTasks).toEqual(["measure_up"]);
    expect(s.editableMeasureFields).toEqual([]);
  });
  test("aerial / Google map figures are recorded as sales estimates", () => {
    const a = planImportedMeasurement({ measured_area_m2: 90, measurement_method: "Google map" }, "imp-2")!;
    expect(a).toMatchObject({ measurement_method: "aerial_remote", measurement_purpose: "sales_estimate" });
    expect(parseMethod("tape measure")).toBe("tape"); expect(parsePurpose("final installed")).toBe("final_installed");
  });
});

describe("acceptance under the AP measurement standard", () => {
  test("blocked until standard + partner method approved (unless verified onsite)", () => {
    expect(acceptanceBlockers(prov, { standardApproved: false, partnerMethodApproved: false }).join()).toMatch(/standard is not approved/);
    expect(acceptanceBlockers(prov, { standardApproved: true, partnerMethodApproved: false }).join()).toMatch(/method has not been approved/);
    expect(acceptanceBlockers(prov, { standardApproved: true, partnerMethodApproved: true })).toEqual([]);
    expect(acceptanceBlockers({ ...prov, verified_area_m2: 118, verified_at: "2026-10-01" }, { standardApproved: false, partnerMethodApproved: false })).toEqual([]);
  });
  test("aerial / remote never satisfies onsite measurement, even with approvals", () => {
    expect(acceptanceBlockers({ ...prov, measurement_method: "aerial_remote" }, { standardApproved: true, partnerMethodApproved: true }).join()).toMatch(/never satisfy/);
    expect(acceptanceBlockers({ ...prov, provenance: "hivic_onsite", measurement_method: "aerial_remote" }, { standardApproved: true, partnerMethodApproved: true }).length).toBe(1);
  });
  test("sales estimates are never accepted as onsite", () => {
    expect(acceptanceBlockers({ ...prov, measurement_purpose: "sales_estimate" }, { standardApproved: true, partnerMethodApproved: true }).join()).toMatch(/not recorded as an onsite/);
  });
});

describe("pilot dual verification", () => {
  test("variance computed; no tolerance = no judgement", () => {
    expect(measurementVariance(120, 110)).toEqual({ m2: 10, pct: 9.09 });
    expect(measurementVariance(null, 110)).toBeNull();
    expect(varianceWithinTolerance(9.09, null)).toBeNull();
    expect(varianceWithinTolerance(9.09, 10)).toBe(true);
    expect(varianceWithinTolerance(-12, 10)).toBe(false);
  });
  test("verifier must be independent onsite trade during the pilot", () => {
    expect(verifierBlocker({ verifierRole: "installer", verifierBusinessId: "b1", suppliedBusinessId: "b1", standardApproved: false })).toMatch(/independent/);
    expect(verifierBlocker({ verifierRole: "admin", verifierBusinessId: null, suppliedBusinessId: "b1", standardApproved: false })).toMatch(/onsite trade/);
    expect(verifierBlocker({ verifierRole: "electrician", verifierBusinessId: "e1", suppliedBusinessId: "b1", standardApproved: false })).toBeNull();
  });
  test("both figures are permanent and tolerance is admin config, not hard-coded", () => {
    const mig = readFileSync("drizzle/migrations/0026_provisional_installer_measurements.sql", "utf8");
    expect(mig).toContain("installer-supplied measurement figures are permanent");
    expect(mig).toContain("onsite verification figures are permanent");
    expect(mig).toMatch(/measurement_variance_tolerance_pct numeric;?/);
    expect(readFileSync("src/lib/measurement.core.ts", "utf8")).not.toMatch(/TOLERANCE\s*=/);
  });
  test("admin accept path checks the standard; completion records verification", () => {
    const pf = readFileSync("src/lib/portal.functions.ts", "utf8");
    expect(pf.slice(pf.indexOf("export const reviewMeasurement"), pf.indexOf("export const setMeasureUpResponsibility"))).toContain("measurementAcceptanceBlockers");
    expect(pf).toContain("verified_area_m2: m.measured_area_m2");
  });
});
