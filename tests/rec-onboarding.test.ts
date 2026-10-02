import { describe, expect, test } from "bun:test";
import { validAbn, validPhone, validBusinessEmail, stepErrors, firstIncompleteStep, applyMaterialReset, agreementText, scheduleText, visibleSteps, effectiveElectricians, parseRecSampleStep, recDraftRole, isRecRevisionTimestamp, isAlwaysMandatoryStep, ALWAYS_MANDATORY_STEPS, ACKNOWLEDGEMENTS, type RecData } from "../src/lib/rec-onboarding.core";

const full: RecData = {
  works_under_rec: false,
  legal_entity_name: "Spark Pty Ltd", abn: "51824753556", rec_registration_number: "REC 12345",
  business_address: "1 Main St, Melton VIC 3337", business_address_details: { label: "1 Main St, Melton VIC 3337", state: "VIC", postcode: "3337", country: "AU", provider: "google_places_au" }, primary_contact_name: "Sam Smith", contact_is_licensed_electrician: true, licence_number: "A123", business_phone: "0412345678", business_email: "sam@spark.com.au", authorised_to_register: true,
  insurance_uploaded: true, insurer: "QBE", insurance_policy_number: "P1", public_liability_cover_amount: 5_000_000, public_liability_expiry: "2099-01-01",
  services_all_confirmed: true, service_origin: "1 Main St, Melton VIC 3337", service_origin_details: { label: "1 Main St, Melton VIC 3337", state: "VIC", postcode: "3337", country: "AU", provider: "google_places_au" }, travel_radius_km: 50, typical_days: ["Mon"], normal_attendance_speed: "1-2 weeks", capacity_band: "6-10", accepting_jobs: true,
  gst_registered: true, assessment_rate: 300, installation_attendance_rate: 150,
  rectification_rates: { prohibited_luminaires: 50, circuit_protection: 100, rcd_installation: 200, tps_cable_replacement: 10, basic_protection: 150 }, coes_fee_choice: "included", agreement_reviewed: true,
  bank_account_name: "Spark Pty Ltd", bank_bsb: "123-456", bank_account_number: "12345678",
};

describe("rec onboarding", () => {
  test("ABN checksum", () => { expect(validAbn("51 824 753 556")).toBe(true); expect(validAbn("51824753557")).toBe(false); });
  test("phone + email", () => { expect(validPhone("0412 345 678")).toBe(true); expect(validPhone("12345")).toBe(false); expect(validBusinessEmail("x@privaterelay.appleid.com")).toBe(false); });
  test("complete application has no incomplete step", () => expect(firstIncompleteStep(full)).toBeNull());
  test("sample steps are restricted to real onboarding states", () => {
    expect(parseRecSampleStep("welcome")).toBe("welcome");
    expect(parseRecSampleStep("assessment_pricing")).toBe("assessment_pricing");
    expect(parseRecSampleStep("made-up-step")).toBeNull();
  });
  test("legacy draft role answers remain explicit", () => {
    expect(recDraftRole({ works_under_rec: false })).toBe("business");
    expect(recDraftRole({ works_under_rec: true })).toBe("worker");
    expect(recDraftRole({ works_under_rec: null })).toBe("unresolved");
  });
  test("the applicant IS the electrician: licence collected up front, no add-electricians step", () => {
    expect(visibleSteps(full).some((s) => s.key === "electricians")).toBe(false);
    expect(visibleSteps(full).some((s) => s.key === "howitworks")).toBe(false);
    expect(stepErrors("about", { ...full, licence_number: undefined })).toContain("Enter your Victorian electrician licence number.");
    expect(stepErrors("about", { ...full, contact_is_licensed_electrician: null })).toContain("Tell us if you are a licensed electrician.");
    expect(effectiveElectricians(full)).toEqual([{ full_legal_name: "Sam Smith", licence_number: "A123", mobile: "0412345678", email: "sam@spark.com.au" }]);
    // an explicit legacy list always wins
    expect(effectiveElectricians({ ...full, electricians: [{ full_legal_name: "Other", licence_number: "B9", mobile: "0400000000", email: "o@x.com" }] })[0].full_legal_name).toBe("Other");
  });
  test("services: all three electrical services are mandatory", () => {
    expect(stepErrors("services", {})).toContain("Confirm your REC can provide all three electrical services.");
    expect(stepErrors("services", { service_piesa: false, service_rectification: false, service_installation_isolation: false })).toContain("Confirm your REC can provide all three electrical services.");
    expect(stepErrors("services", { services_all_confirmed: true })).toEqual([]);
    expect(scheduleText({ service_piesa: false, service_rectification: false })).not.toMatch(/: no$/m);
    expect(scheduleText({})).toContain("Installation-day electrical attendance");
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
    expect(stepErrors("about", { works_under_rec: null, primary_contact_name: "Sam", contact_is_licensed_electrician: true, licence_number: "A12345", business_phone: "0412345678", business_email: "sam@example.com" })).toContain("Tell us if you are registering the REC business or joining as staff.");
  });
  test("REC insurance under $5M and expired rejected", () => {
    expect(stepErrors("insurance", { ...full, public_liability_cover_amount: 4_999_999 })).toContain("Public liability cover must be at least $5,000,000.");
    expect(stepErrors("insurance", { ...full, public_liability_cover_amount: 5_000_000 })).toEqual([]);
    expect(stepErrors("insurance", { ...full, public_liability_expiry: "2000-01-01" }).length).toBe(1);
  });
  test("PIESA rate always required", () => {
    expect(stepErrors("assessment_pricing", { ...full, service_piesa: false, installation_attendance_rate: 150, assessment_rate: undefined })).toContain("Enter your PIESA visit rate.");
  });
  test("rectification pricing step is always shown and requires all rates", () => {
    expect(visibleSteps(full).some((s) => s.key === "rectification_pricing")).toBe(true);
    expect(firstIncompleteStep({ ...full, rectification_rates: undefined })).toBe("rectification_pricing");
  });
  test("material change resets review", () => {
    expect(applyMaterialReset(full, { ...full, assessment_rate: 350 }).agreement_reviewed).toBe(false);
    expect(applyMaterialReset(full, { ...full, public_liability_cover_amount: 20_000_000 }).agreement_reviewed).toBe(false);
    expect(applyMaterialReset(full, { ...full, primary_contact_name: "Other" }).agreement_reviewed).toBe(false);
    expect(applyMaterialReset(full, { ...full, business_address: "2 Main St, Melton VIC 3337" }).agreement_reviewed).toBe(false);
    expect(applyMaterialReset(full, { ...full, licence_number: "A999" }).agreement_reviewed).toBe(false);
  });
  test("database revision timestamps accept PostgREST offsets", () => {
    expect(isRecRevisionTimestamp("2026-10-01T11:29:00+00:00")).toBe(true);
    expect(isRecRevisionTimestamp("2026-10-01T21:29:00.123456+10:00")).toBe(true);
    expect(isRecRevisionTimestamp("2026-10-01T11:29:00Z")).toBe(true);
    expect(isRecRevisionTimestamp("not-a-timestamp")).toBe(false);
  });
  test("bank details are required and excluded from the agreement text", () => {
    expect(stepErrors("bank", { ...full, bank_bsb: "123" })).toContain("Enter a valid 6-digit BSB.");
    expect(agreementText(full)).not.toContain("Account number:");
    expect(agreementText(full)).not.toContain("BSB:");
  });
  test("agreement text includes final clauses, schedules and every acknowledgement", () => {
    const t = agreementText(full);
    expect(t).toContain("HI-VIC-A48-REC-2.3-2026-10-01");
    expect(t).toContain("public liability insurance of at least $5,000,000");
    expect(t).toContain("No separate fixed product-liability minimum is imposed");
    expect(t).toContain("six years after the record was made or the relevant transaction was completed, whichever is later");
    expect(t).toContain("is not the customer-facing price");
    expect(t).toContain("does not depend on Home Insulation Victoria receiving payment from the customer");
    expect(t).toContain("does not itself commence this agreement");
    expect(t).toContain("Home Insulation Victoria, as the Accredited Person (AP)");
    expect(t).toContain("within 48 elapsed hours after the allocation is made available and notified to the REC");
    expect(t).toContain("there is no automatic cancellation");
    expect(t).toContain("Home Insulation Victoria's written authority does not replace the owner's required approval");
    expect(t).toContain("does not repeat the business signup or require a second invitation");
    expect(t).toContain("Pre-insulation electrical safety assessment (PIESA): $300.00 / visit");
    expect(t).toContain("1. Sam Smith — licence A123");
    expect(ACKNOWLEDGEMENTS.length).toBe(9);
    for (const a of ACKNOWLEDGEMENTS) expect(t).toContain(a.text);
  });

  test("the services confirmation stays mandatory in every mode", () => {
    expect(ALWAYS_MANDATORY_STEPS).toEqual(["services"]);
    expect(isAlwaysMandatoryStep("services")).toBe(true);
    expect(isAlwaysMandatoryStep("coverage")).toBe(false);
    expect(stepErrors("services", {})).toEqual(["Confirm your REC can provide all three electrical services."]);
    expect(stepErrors("services", { services_all_confirmed: false })).toEqual(["Confirm your REC can provide all three electrical services."]);
    expect(stepErrors("services", { services_all_confirmed: true })).toEqual([]);
  });
});

import { blockedMandatoryStep } from "../src/lib/rec-onboarding.core";
import { describe as d2, test as t2, expect as e2 } from "bun:test";
d2("server guard for the services confirmation", () => {
  t2("refuses a manipulated save past services while unticked", () => {
    e2(blockedMandatoryStep("coverage", {})).toBe("services");
    e2(blockedMandatoryStep("sign", { services_all_confirmed: false })).toBe("services");
    e2(blockedMandatoryStep("unknown-step", {})).toBe("services");
  });
  t2("allows saves on or before services, and past it once ticked", () => {
    e2(blockedMandatoryStep("services", {})).toBeNull();
    e2(blockedMandatoryStep("about", {})).toBeNull();
    e2(blockedMandatoryStep("coverage", { services_all_confirmed: true })).toBeNull();
  });
});
