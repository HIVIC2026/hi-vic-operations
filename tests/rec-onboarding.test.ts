import { describe, expect, test } from "bun:test";
import { validAbn, validPhone, validBusinessEmail, stepErrors, firstIncompleteStep, applyMaterialReset, agreementText, visibleSteps, ACKNOWLEDGEMENTS, type RecData } from "../src/lib/rec-onboarding.core";

const full: RecData = {
  legal_entity_name: "Spark Pty Ltd", abn: "51824753556", rec_registration_number: "REC 12345",
  business_address: "1 Main St, Melton VIC", primary_contact_name: "Sam", business_phone: "0412345678", business_email: "sam@spark.com.au", authorised_to_register: true,
  insurance_uploaded: true, insurer: "QBE", insurance_policy_number: "P1", public_liability_cover_amount: 10_000_000, public_liability_expiry: "2099-01-01",
  electricians: [{ full_legal_name: "Sam Smith", licence_number: "A123", mobile: "0412345678", email: "sam@spark.com.au" }],
  service_origin: "Melton", travel_radius_km: 50, typical_days: ["Mon"], normal_attendance_speed: "1-2 weeks", capacity_band: "6-10",
  gst_registered: true, assessment_rate: 300, agreement_reviewed: true,
  bank_account_name: "Spark Pty Ltd", bank_bsb: "123-456", bank_account_number: "12345678",
};

describe("rec onboarding", () => {
  test("ABN checksum", () => { expect(validAbn("51 824 753 556")).toBe(true); expect(validAbn("51824753557")).toBe(false); });
  test("phone + email", () => { expect(validPhone("0412 345 678")).toBe(true); expect(validPhone("12345")).toBe(false); expect(validBusinessEmail("x@privaterelay.appleid.com")).toBe(false); });
  test("complete application has no incomplete step", () => expect(firstIncompleteStep(full)).toBeNull());
  test("insurance under $5M and expired rejected", () => {
    expect(stepErrors("insurance", { ...full, public_liability_cover_amount: 4_999_999 }).length).toBe(1);
    expect(stepErrors("insurance", { ...full, public_liability_expiry: "2000-01-01" }).length).toBe(1);
  });
  test("duplicate electrician licence rejected", () => {
    const e = full.electricians![0];
    expect(stepErrors("electricians", { ...full, electricians: [e, { ...e, email: "b@spark.com.au" }] })).toContain("Each electrician needs a different licence number.");
  });
  test("rectification step only when opted in, and requires all rates", () => {
    expect(visibleSteps(full).some((s) => s.key === "rectification_pricing")).toBe(false);
    expect(firstIncompleteStep({ ...full, service_rectification: true })).toBe("rectification_pricing");
  });
  test("material change resets review", () => {
    expect(applyMaterialReset(full, { ...full, assessment_rate: 350 }).agreement_reviewed).toBe(false);
    expect(applyMaterialReset(full, { ...full, primary_contact_name: "Other" }).agreement_reviewed).toBe(true);
  });
  test("bank details are required and excluded from the agreement text", () => {
    expect(stepErrors("bank", { ...full, bank_bsb: "123" })).toContain("Enter a valid 6-digit BSB.");
    expect(agreementText(full)).not.toContain("Account number:");
    expect(agreementText(full)).not.toContain("BSB:");
  });
  test("agreement text includes markup clause, schedules and all 8 acknowledgements", () => {
    const t = agreementText(full);
    expect(t).toContain("HI-VIC-A48-REC-1.6-2026-10-01");
    expect(t).toContain("is not the customer-facing price");
    expect(t).toContain("does not depend on HI VIC! receiving payment from the customer");
    expect(t).toContain("Pre-insulation electrical safety assessment (PIESA): $300.00 / visit");
    expect(ACKNOWLEDGEMENTS.length).toBe(8);
    for (const a of ACKNOWLEDGEMENTS) expect(t).toContain(a.text);
  });
});
