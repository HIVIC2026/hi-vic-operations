import { describe, expect, test } from "bun:test";
import { coverageAreas, overallCoverage, tradeCoverage, type CoveragePartner } from "../src/lib/coverage.core";

const installer = (patch: Partial<CoveragePartner> = {}): CoveragePartner => ({
  id: "installer", name: "Installer", business_type: "eec_installer", capabilities: ["installer"], onboarding_status: "approved", is_active: true,
  service_postcodes: ["31*"], service_regions: [], coverage_verified_at: "2026-09-30T00:00:00Z", free_measureups_for_hivic_quote_leads: true,
  credentials: [{ kind: "public_liability_insurance", label: "PLI", expires_at: "2028-01-01", critical: true, verification: "verified" }, { kind: "installer_certification", label: "CII", expires_at: "2028-01-01", critical: true, verification: "verified" }],
  ...patch,
});
const rec = (patch: Partial<CoveragePartner> = {}): CoveragePartner => ({
  id: "rec", name: "REC", business_type: "rec", capabilities: ["electrician"], onboarding_status: "approved", is_active: true,
  service_postcodes: ["3121"], service_regions: [], coverage_verified_at: "2026-09-30T00:00:00Z",
  credentials: [{ kind: "public_liability_insurance", label: "PLI", expires_at: "2028-01-01", critical: true, verification: "verified" }, { kind: "electrical_licence", label: "Licence", expires_at: "2028-01-01", critical: true, verification: "verified" }, { kind: "rec_registration", label: "REC", expires_at: "2028-01-01", critical: true, verification: "verified" }],
  ...patch,
});

describe("partner coverage", () => {
  test("matches REC and installer independently using verified postcode coverage", () => {
    const partners = [rec(), installer()];
    const site = { postcode: "3121", suburb: "Richmond" };
    expect(tradeCoverage(partners, "rec", site).state).toBe("serviceable");
    expect(tradeCoverage(partners, "installer", site).state).toBe("serviceable");
    expect(overallCoverage(tradeCoverage(partners, "rec", site), tradeCoverage(partners, "installer", site))).toBe("serviceable");
  });

  test("does not turn an onboarding radius declaration into verified coverage", () => {
    const result = tradeCoverage([installer({ service_postcodes: [], coverage_verified_at: null, declared_service_origin: "Geelong", declared_travel_radius_km: 50 })], "installer", { postcode: "3220" });
    expect(result.state).toBe("partial");
    expect(result.matches).toHaveLength(0);
  });

  test("expired credentials block an otherwise matching partner", () => {
    const result = tradeCoverage([rec({ credentials: rec().credentials.map((credential) => credential.kind === "rec_registration" ? { ...credential, expires_at: "2020-01-01" } : credential) })], "rec", { postcode: "3121" }, new Date("2026-09-30"));
    expect(result.state).toBe("unserviceable");
    expect(result.blocked[0]?.reason).toContain("rec registration");
  });

  test("distinguishes configured-but-uncovered from no configured network", () => {
    expect(tradeCoverage([installer()], "installer", { postcode: "3999" }).state).toBe("unserviceable");
    expect(tradeCoverage([], "installer", { postcode: "3999" }).state).toBe("not_configured");
  });

  test("groups active enquiry locations and shows matching teams by area", () => {
    const areas = coverageAreas([rec(), installer()], [
      { postcode: "3121", suburb: "Richmond" },
      { postcode: "3121", suburb: "Richmond" },
      { postcode: "3999", suburb: "Regional" },
    ]);
    expect(areas).toHaveLength(2);
    expect(areas[0]?.enquiryCount).toBe(2);
    expect(areas[0]?.rec.matches.map((match) => match.name)).toEqual(["REC"]);
    expect(areas[0]?.installer.matches.map((match) => match.name)).toEqual(["Installer"]);
    expect(areas[0]?.overall).toBe("serviceable");
    expect(areas[1]?.overall).toBe("unserviceable");
  });
});