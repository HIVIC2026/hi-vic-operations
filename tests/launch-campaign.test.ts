import { describe, expect, test } from "bun:test";
import { campaignSaveAllowed, deskCheckReasonError, launchGroup, LAUNCH_BATCH_SIZE, LAUNCH_COPY_APPROVED } from "../src/lib/launch-campaign.core";
import { readFileSync } from "node:fs";

describe("existing leads launch campaign", () => {
  test("Group B waits for a positive office check, never a declaration or upload alone", () => {
    for (const status of [null, undefined, "pending", "not_needed", "not_eligible", "needs_onsite_check"]) expect(campaignSaveAllowed("onsite", status)).toBe(false);
    expect(campaignSaveAllowed("onsite", "looks_eligible")).toBe(true);
    expect(campaignSaveAllowed("likely", null)).toBe(true);
    const server = readFileSync("src/lib/launch-campaign.server.ts", "utf8");
    const submission = server.slice(server.indexOf("export async function markCampaignMediaReceived"), server.indexOf("export async function launchCampaignOffice"));
    expect(submission).not.toContain("queueSpotSavedConfirmations");
    expect(submission).not.toMatch(/spot_saved_at\s*:/);
    expect(submission).not.toMatch(/eligibility_outcome\s*:|stage\s*:/);
    expect(server).toContain("!campaignSaveAllowed(c.group, review?.desk_check_status)");
  });
  test("segments the two approved groups and excludes ineligible leads", () => {
    expect(launchGroup("likely_eligible", "none")).toBe("likely");
    expect(launchGroup("likely_eligible", "present")).toBe("onsite");
    expect(launchGroup("needs_onsite_confirmation", "unknown")).toBe("onsite");
    expect(launchGroup("does_not_appear_eligible", "none")).toBeNull();
  });

  test("copy is approved (Jo 8 Oct) so owner links work; batch stays capped", () => {
    expect(LAUNCH_COPY_APPROVED).toBe(true);
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
    expect(page).not.toMatch(/bookReadyCheck|Book now/i);
    expect(page).not.toContain("Book your Ready Check");
  });
});