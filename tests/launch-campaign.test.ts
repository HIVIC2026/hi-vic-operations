import { describe, expect, test } from "bun:test";
import { officeSpotSavedCount, campaignSaveAllowed, campaignSendCounts, deskCheckReasonError, launchGroup, LAUNCH_BATCH_SIZE, LAUNCH_COPY_APPROVED } from "../src/lib/launch-campaign.core";
import { readFileSync } from "node:fs";

describe("existing leads launch campaign", () => {
  test("office headline counts all saved responses except opt-outs, TEST and cancelled jobs", () => {
    const saved = { spot_saved_at: "2026-10-21T00:00:00Z", opted_out_at: null, source: "base44", stage: "ready_check_scheduled" };
    const rows = Array.from({ length: 117 }, () => ({ ...saved }));
    expect(officeSpotSavedCount([...rows,
      { ...saved, opted_out_at: "2026-10-21T01:00:00Z" },
      { ...saved, source: "qa_test" }, { ...saved, stage: "cancelled" },
      { ...saved, spot_saved_at: null },
    ])).toBe(117);
    expect(officeSpotSavedCount([{ ...saved, source: null, stage: "complete" }])).toBe(1);
  });
  test("office numbers keep the two email versions separate (Jo 21 Oct)", () => {
    const rows = [
      { status: "sent", idempotency_key: "existing_leads_launch_v1:save_my_spot:job1", source: "base44" },
      { status: "sent", idempotency_key: "existing_leads_launch_v1:existing_insulation_save_spot:job2", source: "base44" },
      { status: "sent", idempotency_key: "existing_leads_launch_v1:insulation_details:job3", source: "base44" },
      { status: "failed", idempotency_key: "existing_leads_launch_v1:save_my_spot:job4", source: "base44" },
      { status: "sending", idempotency_key: "existing_leads_launch_v1:save_my_spot:job5", source: "base44" },
      { status: "sent", idempotency_key: "existing_leads_launch_v1:save_my_spot:job6", source: "qa_test" },
      { status: "delivered_unrecorded", idempotency_key: "existing_leads_launch_v1:insulation_details:job7", source: "base44" },
      { status: "sent", idempotency_key: null, source: "base44" },
    ];
    // job1 + follow-up job2 + legacy null key = 3 spots offered; job3 + uncertain job7 = 2 insulation details.
    // Failed/sending/TEST copies never count.
    expect(campaignSendCounts(rows)).toEqual({ spotsOffered: 3, insulationDetails: 2 });
  });
  test("Group B media waits for positive review; explicit qualifying declaration opens the spot", () => {
    for (const status of [null, undefined, "pending", "not_needed", "not_eligible", "needs_onsite_check"]) expect(campaignSaveAllowed("onsite", status)).toBe(false);
    expect(campaignSaveAllowed("onsite", "looks_eligible")).toBe(true);
    expect(campaignSaveAllowed("likely", null)).toBe(true);
    expect(campaignSaveAllowed("onsite", "not_needed", true)).toBe(true);
    expect(campaignSaveAllowed("onsite", "not_eligible", true)).toBe(false);
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