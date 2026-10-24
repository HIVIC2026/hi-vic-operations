import { describe, expect, test } from "bun:test";
import { approvalFlags, buildPartnerProfile, normaliseAbn, normaliseMobile } from "../src/lib/partner-profile.core";

const meta = { partner_type: "installer", signer_name: "Harpreet Singh", signer_position: "Director", signer_email: "X@Y.COM ", agreement_version: "v3", signed_at: "2026-10-01T00:00:00Z", agreement_text: "body", insurance_certificate_path: "a/b.pdf" };
const inst = { abn: "99 663 065 843", trading_name: "Cozy ", legal_entity_name: "Fluff Master Pty Ltd", business_phone: "0450 229 427", business_email: "Cozy@Gmail.com",
  r5_rate: 16, batts_removal_rate: 3, loose_fill_removal_rate: 11, travel_radius_km: 50, public_liability_cover_amount: 5_000_000, public_liability_expiry: "2026-11-20",
  service_origin: "Truganina VIC 3029", service_origin_details: { suburb: "Truganina", latitude: -37.8, longitude: 144.7 },
  installers: [{ full_legal_name: "Harpreet Singh", email: "COZY@gmail.com", mobile: "0450229427", cii_holds: "held", cii_certificate_number: "1523" }] };

describe("partner profile", () => {
  test("normalises ABN, mobile and email", () => {
    expect(normaliseAbn("70 414 972 794")).toBe("70414972794");
    expect(normaliseMobile("0412 345 678")).toBe("+61412345678");
    expect(normaliseMobile("+61 412 345 678")).toBe("+61412345678");
    const p = buildPartnerProfile(meta, inst);
    expect(p.business.abn).toBe("99663065843");
    expect(p.signer.email).toBe("x@y.com");
    expect(p.workers[0]).toMatchObject({ name: "Harpreet Singh", role: "installer", mobile: "+61450229427", email: "cozy@gmail.com", collection_notice: { state: "missing" } });
    expect(p.coverage).toMatchObject({ lat: -37.8, lng: 144.7, radius_km: 50, anywhere_in_victoria: false });
  });
  test("both trades when an existing business adds a capability", () => {
    expect(buildPartnerProfile(meta, inst, new Map(), ["electrician"]).business.type).toBe("both");
  });
  test("flags but does not block", () => {
    const f = approvalFlags(buildPartnerProfile(meta, inst), { r5: [], piesa: [] }, "2026-10-06");
    expect(f.some((x) => x.includes("R5 rate per m² $16 looks unusual"))).toBe(true);
    expect(f.some((x) => x.includes("expires in 45 days"))).toBe(true);
    expect(f.some((x) => x.includes("CII certification not yet verified"))).toBe(true);
    expect(f.some((x) => x.includes("Missing CII certification expiry"))).toBe(true);
  });
  test("anywhere in Victoria", () => {
    const p = buildPartnerProfile({ ...meta, partner_type: "rec" }, { ...inst, travel_radius_km: 9999, rec_registration_number: "23073", licence_number: "A1", assessment_rate: 350 });
    expect(p.coverage.anywhere_in_victoria).toBe(true);
    const f = approvalFlags(p, { r5: [], piesa: [350, 330, 360] }, "2026-10-06");
    expect(f.some((x) => x.includes("Licence expiry missing"))).toBe(true);
  });
});
