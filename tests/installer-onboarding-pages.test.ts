import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ACKNOWLEDGEMENTS, INSTALLER_AGREEMENT_VERSION, INSTALLER_VISIBLE_PAGES, STEPS, agreementText, applyMaterialReset, firstIncompleteStep, installerSignUiBlockers, pageErrors, pageMembers, parseInstallerSampleStep, stepErrors, visiblePageForStep, type InstData,
} from "../src/lib/installer-onboarding.core";

const addr = (label: string) => ({ label, street: "1 Main St", suburb: "Melbourne", postcode: "3000", state: "VIC", country: "AU" as const, provider: "google_places_au" as const });
const complete: InstData = {
  works_for_business: false, primary_contact_name: "Sam Taylor", business_phone: "0412345678", business_email: "sam@example.com",
  legal_entity_name: "Sample Pty Ltd", abn: "51824753556", business_address: "1 Main St, Melbourne VIC 3000", business_address_details: addr("1 Main St, Melbourne VIC 3000"),
  insurance_uploaded: true, insurer: "X", insurance_policy_number: "P1", public_liability_cover_amount: 5_000_000, public_liability_expiry: "2099-12-31",
  installers: [{ full_legal_name: "A B", piisa_done: "no", qualification: "CII", mobile: "0412345679", email: "a@example.com", cii_holds: "held", cii_certificate_number: "CII-1", cii_issuer: "EEC", cii_issue_date: "2024-01-01", cii_level: "full", cii_expiry: "2099-01-01" }],
  electrician_choice: "match", wants_hivic_leads: false, service_origin: "1 Main St, Melbourne VIC 3000", service_origin_details: addr("1 Main St, Melbourne VIC 3000"), travel_radius_km: 50,
  typical_days: ["Mon"], normal_attendance_speed: "1-2 weeks", capacity_band: "4-8", accepting_jobs: true, gst_registered: true, r5_rate: 20, batts_removal_rate: 8, loose_fill_removal_rate: 10,
  bank_account_name: "S", bank_bsb: "123-456", bank_account_number: "12345678", agreement_reviewed: true,
};

describe("installer visible pages", () => {
  test("nine pages cover every legacy step exactly once", () => {
    expect(INSTALLER_VISIBLE_PAGES.length).toBe(9);
    const members = INSTALLER_VISIBLE_PAGES.flatMap((p) => p.members);
    expect([...members].sort()).toEqual(STEPS.map((s) => s.key).sort());
    for (const p of INSTALLER_VISIBLE_PAGES) expect(p.members[0]).toBe(p.key);
  });
  test("every legacy draft key resumes on its group page; unknown fails safe", () => {
    expect(visiblePageForStep("contact")).toBe("about");
    expect(visiblePageForStep("business")).toBe("about");
    expect(visiblePageForStep("coverage")).toBe("services");
    expect(visiblePageForStep("capacity")).toBe("availability");
    expect(visiblePageForStep("extras_pricing")).toBe("install_pricing");
    expect(visiblePageForStep("sign")).toBe("review");
    expect(visiblePageForStep("bogus")).toBe("about");
    expect(visiblePageForStep(null)).toBe("about");
  });
  test("group pages validate all member steps", () => {
    for (const p of INSTALLER_VISIBLE_PAGES) {
      const blank = pageErrors(p.key, {});
      const expected = [...new Set(pageMembers(p.key).flatMap((m) => stepErrors(m, {})))];
      expect(blank).toEqual(expected);
    }
    expect(pageErrors("about", { ...complete, business_address: "" })).toContain("Enter your business address.");
    expect(pageErrors("services", { ...complete, service_origin: "" })).toContain("Enter your service starting location.");
    expect(pageErrors("availability", { ...complete, capacity_band: "" })).toEqual([]);
    expect(pageErrors("install_pricing", { ...complete, extra_rates: { difficult_access: -1 } }).length).toBe(1);
  });
  test("required gates retained", () => {
    expect(firstIncompleteStep(complete)).toBeNull();
    expect(firstIncompleteStep({ ...complete, installers: [] })).toBe("installers");
    expect(firstIncompleteStep({ ...complete, batts_removal_rate: null })).toBe("install_pricing");
    expect(firstIncompleteStep({ ...complete, public_liability_cover_amount: 4_999_999 })).toBe("insurance");
    expect(firstIncompleteStep({ ...complete, wants_hivic_leads: true, free_measureups_for_hivic_quote_leads: null })).toBe("services");
    expect(firstIncompleteStep({ ...complete, electrician_choice: "have", preferred_electricians: [] })).toBe("electrician");
    expect(firstIncompleteStep({ ...complete, agreement_reviewed: false })).toBe("review");
    expect(firstIncompleteStep({ ...complete, works_for_business: null })).toBe("about");
    expect(firstIncompleteStep({ ...complete, works_for_business: true })).toBe("about");
  });
  test("contact asked once; no authority checkbox gate", () => {
    // Typed text that was never resolved to a real Australian address is refused.
    expect(stepErrors("contact", { works_for_business: false, business_address: "x" }).length).toBeGreaterThan(0);
    expect(firstIncompleteStep({ ...complete, authorised_to_register: undefined })).toBeNull();
    const src = readFileSync("src/routes/installer-onboarding.tsx", "utf8");
    expect(src).not.toContain("authorised_to_register");
    expect(src.match(/\{\.\.\.t\("business_email"\)\}/g)?.length).toBe(1);
  });
  test("material changes reset review", () => {
    expect(applyMaterialReset(complete, { ...complete, r5_rate: 21 }).agreement_reviewed).toBe(false);
    expect(applyMaterialReset(complete, { ...complete, bank_bsb: "123-457" }).agreement_reviewed).toBe(true);
  });
  test("signing shows every actionable blocker and a complete draft enables submission", () => {
    const acks = Object.fromEntries(ACKNOWLEDGEMENTS.map((a) => [a.key, true]));
    expect(installerSignUiBlockers({ data: complete, reviewed: true, acknowledgements: acks, signerName: "Sam Taylor", signerPosition: "Director", signerEmail: "sam@example.com" })).toEqual([]);
    const blocked = installerSignUiBlockers({ data: { ...complete, insurance_uploaded: false, r5_rate: null, agreement_reviewed: false }, reviewed: false, acknowledgements: {}, signerName: "", signerPosition: "", signerEmail: "bad" });
    expect(blocked.some((x) => x.page === "insurance")).toBe(true);
    expect(blocked.some((x) => x.page === "install_pricing")).toBe(true);
    expect(blocked.map((x) => x.key)).toEqual(expect.arrayContaining(["review", "acknowledgements", "signer-name", "signer-position", "signer-email"]));
    expect(INSTALLER_AGREEMENT_VERSION).toBe("HI-VIC-A48-INST-1.18-2026-10-09");
  });
  test("pink access-charges note is removed and fee copy hides internal overrides", () => {
    const route = readFileSync("src/routes/installer-onboarding.tsx", "utf8");
    const hint = "Enter $0 if it's included at no extra charge.";
    const note = "Keeping access charges reasonable helps more homeowners proceed—and creates more opportunities for your business.";
    expect(route).toContain(hint);
    expect(route).not.toContain(note);
    const agreement = agreementText(complete);
    expect(agreement).toContain("AP accreditation number: A003654");
    expect(agreement).toContain("Accredited Person fee recorded for the Installer in Home Insulation Victoria (standard $349 including GST");
    expect(agreement).not.toContain("job-specific amount before quote acceptance");
    expect(agreement).not.toContain("authorised staff member");
  });
  test("sample keys are allow-listed", () => {
    expect(parseInstallerSampleStep("welcome")).toBe("welcome");
    expect(parseInstallerSampleStep("submitted")).toBe("submitted");
    expect(parseInstallerSampleStep("coverage")).toBe("services");
    expect(parseInstallerSampleStep("sign")).toBe("review");
    expect(parseInstallerSampleStep("admin")).toBeNull();
    expect(parseInstallerSampleStep("")).toBeNull();
  });
  test("sample mode never writes", () => {
    const src = readFileSync("src/routes/installer-onboarding.tsx", "utf8");
    expect(src).toMatch(/async function persist[^]*?if \(sampleMode \|\| !token\) return;/);
    expect(src).toContain('if (preview) { setError("Sample preview only — certificate upload is disabled."); return; }');
    expect(src).toContain('if (preview) { setErr("Sample preview only — no agreement was signed or submitted."); return; }');
    expect(src).not.toMatch(/radial-gradient/);
    expect(src).not.toContain("saves as you go");
  });
  test("address lookup mirrors REC race guards", () => {
    const src = readFileSync("src/routes/installer-onboarding.tsx", "utf8");
    const shared = readFileSync("src/components/onboarding/VerifiedAddressInput.tsx", "utf8");
    for (const s of ["mine !== detailsSeq.current", "mine !== searchSeq.current", "resolved?.label !== value", "onSelect(null); onChange(next)"]) expect(shared).toContain(s);
    expect(src).toContain("service_origin_details: d.business_address_details");
  });
});
