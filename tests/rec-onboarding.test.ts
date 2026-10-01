import { describe, expect, test } from "bun:test";
import { validAbn, validPhone, validBusinessEmail, stepErrors, firstIncompleteStep, applyMaterialReset, agreementText, visibleSteps, effectiveElectricians, ACKNOWLEDGEMENTS, type RecData } from "../src/lib/rec-onboarding.core";

const full: RecData = {
  works_under_rec: false,
  legal_entity_name: "Spark Pty Ltd", abn: "51824753556", rec_registration_number: "REC 12345",
  business_address: "1 Main St, Melton VIC", primary_contact_name: "Sam Smith", licence_number: "A123", business_phone: "0412345678", business_email: "sam@spark.com.au", authorised_to_register: true,
  insurance_uploaded: true, insurer: "QBE", insurance_policy_number: "P1", public_liability_cover_amount: 10_000_000, public_liability_expiry: "2099-01-01",
  service_piesa: true, service_rectification: true, service_installation_isolation: true, service_origin: "Melton", travel_radius_km: 50, typical_days: ["Mon"], normal_attendance_speed: "1-2 weeks", capacity_band: "6-10",
  gst_registered: true, assessment_rate: 300, installation_attendance_rate: 150,
  rectification_rates: { prohibited_luminaires: 50, circuit_protection: 100, rcd_installation: 200, tps_cable_replacement: 10, basic_protection: 150 }, coes_fee_choice: "included", agreement_reviewed: true,
  bank_account_name: "Spark Pty Ltd", bank_bsb: "123-456", bank_account_number: "12345678",
};

describe("rec onboarding", () => {
  test("ABN checksum", () => { expect(validAbn("51 824 753 556")).toBe(true); expect(validAbn("51824753557")).toBe(false); });
  test("phone + email", () => { expect(validPhone("0412 345 678")).toBe(true); expect(validPhone("12345")).toBe(false); expect(validBusinessEmail("x@privaterelay.appleid.com")).toBe(false); });
  test("complete application has no incomplete step", () => expect(firstIncompleteStep(full)).toBeNull());
  test("the applicant IS the electrician: licence collected up front, no add-electricians step", () => {
    expect(visibleSteps(full).some((s) => s.key === "electricians")).toBe(false);
    expect(visibleSteps(full).some((s) => s.key === "howitworks")).toBe(false);
    expect(stepErrors("about", { ...full, licence_number: undefined })).toContain("Enter your Victorian electrician licence number.");
    expect(effectiveElectricians(full)).toEqual([{ full_legal_name: "Sam Smith", licence_number: "A123", mobile: "0412345678", email: "sam@spark.com.au" }]);
    // an explicit legacy list always wins
    expect(effectiveElectricians({ ...full, electricians: [{ full_legal_name: "Other", licence_number: "B9", mobile: "0400000000", email: "o@x.com" }] })[0].full_legal_name).toBe("Other");
  });
  test("services: rectification and install day attendance are required, PIESA optional", () => {
    expect(stepErrors("services", {})).toContain("Rectification work and install day attendance are required — tick both to continue.");
    expect(stepErrors("services", { service_rectification: true })).toContain("Rectification work and install day attendance are required — tick both to continue.");
    expect(stepErrors("services", { service_installation_isolation: true })).toContain("Rectification work and install day attendance are required — tick both to continue.");
    expect(stepErrors("services", { service_rectification: true, service_installation_isolation: true })).toEqual([]);
    expect(stepErrors("services", { service_piesa: true, service_rectification: true, service_installation_isolation: true })).toEqual([]);
  });
  test("customer-ownership acknowledgement is required to sign", () => {
    const ack = ACKNOWLEDGEMENTS.find((a) => a.key === "customer_owner");
    expect(ack?.text).toContain("customer is Home Insulation Victoria's customer");
    expect(ack?.text).toContain("will not quote, invoice or accept payment from them separately");
    expect(agreementText(full)).toContain(ack!.text);
  });
  test("worker under another REC: no ABN/REC/insurance needed, host REC required", () => {
    const under: RecData = { ...full, works_under_rec: true, abn: undefined, rec_registration_number: undefined, host_rec_name: "Host Electrical Pty Ltd", host_rec_number: "REC 999" };
    expect(stepErrors("business", under)).toEqual([]);
    expect(visibleSteps(under).some((s) => s.key === "insurance")).toBe(false);
    expect(visibleSteps(under).some((s) => s.key === "bank")).toBe(false);
    expect(visibleSteps(under).some((s) => s.key === "assessment_pricing")).toBe(false);
    expect(visibleSteps(under).some((s) => s.key === "rectification_pricing")).toBe(false);
    expect(stepErrors("insurance", { ...under, insurance_uploaded: false, insurer: undefined })).toEqual([]);
    expect(stepErrors("bank", { ...under, bank_account_name: undefined })).toEqual([]);
    expect(stepErrors("assessment_pricing", { ...under, assessment_rate: undefined })).toEqual([]);
    expect(stepErrors("rectification_pricing", { ...under, service_rectification: true })).toEqual([]);
    expect(firstIncompleteStep(under)).toBeNull();
    expect(stepErrors("business", { ...under, host_rec_name: undefined })).toContain("Enter the REC business you work under.");
    expect(stepErrors("business", { works_under_rec: null })).toContain("Tell us if you run your own REC business or work under another REC.");
  });
  test("insurance under $5M and expired rejected", () => {
    expect(stepErrors("insurance", { ...full, public_liability_cover_amount: 4_999_999 }).length).toBe(1);
    expect(stepErrors("insurance", { ...full, public_liability_expiry: "2000-01-01" }).length).toBe(1);
  });
  test("PIESA rate not required when PIESA referrals declined", () => {
    expect(stepErrors("assessment_pricing", { ...full, service_piesa: false, service_installation_isolation: true, installation_attendance_rate: 150, assessment_rate: undefined })).toEqual([]);
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
    expect(t).toContain("HI-VIC-A48-REC-1.7-2026-10-01");
    expect(t).toContain("is not the customer-facing price");
    expect(t).toContain("does not depend on Home Insulation Victoria receiving payment from the customer");
    expect(t).toContain("Pre-insulation electrical safety assessment (PIESA): $300.00 / visit");
    expect(t).toContain("1. Sam Smith — licence A123");
    expect(ACKNOWLEDGEMENTS.length).toBe(9);
    for (const a of ACKNOWLEDGEMENTS) expect(t).toContain(a.text);
  });
});
