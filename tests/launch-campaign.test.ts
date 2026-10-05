import { describe, expect, test } from "bun:test";
import { deskCheckReasonError, launchGroup, LAUNCH_BATCH_SIZE, LAUNCH_COPY_APPROVED } from "../src/lib/launch-campaign.core";
import { readFileSync } from "node:fs";

describe("existing leads launch campaign", () => {
  test("segments the two approved groups and excludes ineligible leads", () => {
    expect(launchGroup("likely_eligible", "none")).toBe("likely");
    expect(launchGroup("likely_eligible", "present")).toBe("onsite");
    expect(launchGroup("needs_onsite_confirmation", "unknown")).toBe("onsite");
    expect(launchGroup("does_not_appear_eligible", "none")).toBeNull();
  });

  test("keeps sending locked and caps the future batch", () => {
    expect(LAUNCH_COPY_APPROVED).toBe(false);
    expect(LAUNCH_BATCH_SIZE).toBe(50);
  });

  test("requires a reason for a not-eligible desk check", () => {
    expect(deskCheckReasonError("not_eligible", "")).toContain("reason");
    expect(deskCheckReasonError("not_eligible", "Existing insulation appears above R2.0")).toBeNull();
  });

  test("owner page uses the exact campaign actions and does not book", () => {
    const page = readFileSync("src/routes/estimate_.$token.campaign.tsx", "utf8");
    expect(page).toContain("Save my spot");
    expect(page).toContain("Take me off the list");
    expect(page).toContain("does not book a visit");
    expect(page).not.toContain("Book your Ready Check");
  });
});