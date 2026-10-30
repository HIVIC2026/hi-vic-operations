import { describe, expect, test } from "bun:test";
import { inHouseEnableBlockers, isInHousePartner, partnerBillsRectification } from "../src/lib/in-house.core";

describe("in-house partner", () => {
  test("reads the stored flag", () => {
    expect(isInHousePartner({ in_house: true })).toBe(true);
    expect(isInHousePartner({ in_house: false })).toBe(false);
  });
  test("requires approved worker and Mitti login", () => {
    expect(inHouseEnableBlockers({ approvedElectricianWorkers: 0, hasActiveRateCardWithPiesa: true, mittiElectricianLogins: 0 })).toEqual(["No approved electrician worker", "No electrician Mitti login"]);
  });
  test("requires an active PIESA rate card", () => {
    expect(inHouseEnableBlockers({ approvedElectricianWorkers: 1, hasActiveRateCardWithPiesa: false, mittiElectricianLogins: 1 })).toEqual(["No active rate card with PIESA"]);
  });
  test("allows all good facts", () => {
    expect(inHouseEnableBlockers({ approvedElectricianWorkers: 1, hasActiveRateCardWithPiesa: true, mittiElectricianLogins: 1 })).toEqual([]);
  });
  test("partner bills rectification only when in-house", () => {
    expect(partnerBillsRectification({ in_house: true, rectification_billed_by: "partner" })).toBe(true);
    expect(partnerBillsRectification({ in_house: false, rectification_billed_by: "partner" })).toBe(false);
    expect(partnerBillsRectification({ in_house: true, rectification_billed_by: "hivic" })).toBe(false);
  });
});