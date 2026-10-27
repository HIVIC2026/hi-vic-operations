import { describe, expect, test } from "bun:test";
import { activationBlockers, activationWorkers, approvedRateItems } from "../src/lib/partner-activation.core";
import { REC_AGREEMENT_VERSION, type RecData } from "../src/lib/rec-onboarding.core";
import { INSTALLER_AGREEMENT_VERSION, type InstData } from "../src/lib/installer-onboarding.core";

describe("partner activation", () => {
  test("blocks unsigned, stale-agreement and expired-insurance applications", () => {
    const data = { public_liability_expiry: "2020-01-01" } as RecData;
    const b = activationBlockers("rec", data, "old", null, new Date("2026-09-30T00:00:00Z"));
    expect(b.slice(0, 3)).toEqual(["The agreement has not been signed.", expect.stringContaining("must be accepted before activation"), "Public liability insurance is expired or missing."]);
  });

  test("preserves activation of previously signed installer and REC agreement versions", () => {
    const currentInsurance = { public_liability_expiry: "2099-01-01", public_liability_cover_amount: 5_000_000, licence_number: "A1", licence_expiry: "2099-01-01", rec_registration_number: "1" };
    expect(activationBlockers("rec", currentInsurance as RecData, "HI-VIC-A48-REC-2.3-2026-10-01", "2026-10-01")).toEqual([]);
    expect(activationBlockers("installer", currentInsurance as InstData, "HI-VIC-A48-INST-1.13-2026-10-03", "2026-10-03")).toEqual([]);
  });

  test("converts GST-inclusive REC supplier rates to ex-GST rate-card values", () => {
    const data = { gst_registered: true, assessment_rate: 330 } as RecData;
    expect(activationBlockers("rec", { ...data, public_liability_expiry: "2099-01-01", public_liability_cover_amount: 5_000_000, licence_number: "A1", licence_expiry: "2099-01-01", rec_registration_number: "1" }, REC_AGREEMENT_VERSION, "2026-09-30")).toEqual([]);
    expect(approvedRateItems("rec", data).find((x) => x.code === "PIESA")?.unit_price_ex_gst).toBe(300);
  });

  test("persists standard and custom REC units without treating cable metres as square metres", () => {
    const data = { gst_registered: false, rectification_rates: { tps_cable_replacement: 12 }, custom_rectification_rates: [{ id: "custom-123", description: "Roof-space isolation", unit: "visit", price: 90 }] } as RecData;
    const items = approvedRateItems("rec", data);
    expect(items.find((x) => x.code === "TPS_CABLE_REPLACEMENT")).toMatchObject({ unit: "each", display_unit: "metre" });
    expect(items.find((x) => x.code === "CUSTOM_CUSTOM123")).toMatchObject({ description: "Roof-space isolation", unit: "each", display_unit: "visit", unit_price_ex_gst: 90 });
  });

  test("derives the REC applicant worker before activation side effects", () => {
    const data = { primary_contact_name: "Sam Spark", licence_number: "A123", business_phone: "0412345678", business_email: "SAM@SPARK.COM.AU" } as RecData;
    expect(activationWorkers("rec", data, "business-1", "application-1")).toEqual([{
      business_id: "business-1", trade_role: "electrician", full_legal_name: "Sam Spark", email: "sam@spark.com.au",
      mobile: "0412345678", licence_number: "A123", licence_expires_on: null, qualification: null, source_application_id: "application-1",
    }]);
  });

  test("creates separate installer supply and removal rate lines", () => {
    const data = { gst_registered: false, r5_rate: 25, batts_removal_rate: 8, loose_fill_removal_rate: 12 } as InstData;
    expect(activationBlockers("installer", { ...data, public_liability_expiry: "2099-01-01" }, INSTALLER_AGREEMENT_VERSION, "2026-09-30")).toEqual([]);
    expect(approvedRateItems("installer", data).map((x) => x.code)).toEqual(["R5_BATTS", "BATTS_REMOVAL", "LOOSE_FILL_REMOVAL"]);
  });
});