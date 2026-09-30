import { describe, expect, test } from "bun:test";
import { activationBlockers, approvedRateItems } from "../src/lib/partner-activation.core";
import { REC_AGREEMENT_VERSION, type RecData } from "../src/lib/rec-onboarding.core";
import { INSTALLER_AGREEMENT_VERSION, type InstData } from "../src/lib/installer-onboarding.core";

describe("partner activation", () => {
  test("blocks unsigned, stale-agreement and expired-insurance applications", () => {
    const data = { public_liability_expiry: "2020-01-01" } as RecData;
    expect(activationBlockers("rec", data, "old", null, new Date("2026-09-30T00:00:00Z"))).toHaveLength(3);
  });

  test("converts GST-inclusive REC supplier rates to ex-GST rate-card values", () => {
    const data = { gst_registered: true, assessment_rate: 330 } as RecData;
    expect(activationBlockers("rec", { ...data, public_liability_expiry: "2099-01-01" }, REC_AGREEMENT_VERSION, "2026-09-30")).toEqual([]);
    expect(approvedRateItems("rec", data).find((x) => x.code === "PIESA")?.unit_price_ex_gst).toBe(300);
  });

  test("creates separate installer supply and removal rate lines", () => {
    const data = { gst_registered: false, r5_rate: 25, batts_removal_rate: 8, loose_fill_removal_rate: 12 } as InstData;
    expect(activationBlockers("installer", { ...data, public_liability_expiry: "2099-01-01" }, INSTALLER_AGREEMENT_VERSION, "2026-09-30")).toEqual([]);
    expect(approvedRateItems("installer", data).map((x) => x.code)).toEqual(["R5_BATTS", "BATTS_REMOVAL", "LOOSE_FILL_REMOVAL"]);
  });
});