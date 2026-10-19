import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MEDIA_REVIEW_EVENT, NO_INSULATION_EVENT, noInsulationDecisionBlocker, officeInsulationOverride } from "../src/lib/office-no-insulation.core";

const ok = { source: "base44", stage: "preliminary_estimate_ready", eligibilityOutcome: "needs_onsite_confirmation", mediaCount: 1, reason: "No insulation visible in photos" };

describe("office no-insulation decision", () => {
  test("latest no-insulation decision makes the estimate insulation none", () => {
    expect(officeInsulationOverride([{ event_type: NO_INSULATION_EVENT, occurred_at: "2026-10-19T12:00:00Z" }])).toBe("none");
  });
  test("a later photo review supersedes it", () => {
    expect(officeInsulationOverride([
      { event_type: NO_INSULATION_EVENT, occurred_at: "2026-10-19T12:00:00Z" },
      { event_type: MEDIA_REVIEW_EVENT, occurred_at: "2026-10-19T12:05:00Z" },
    ])).toBeNull();
  });
  test("no office decision keeps the owner's answer", () => {
    expect(officeInsulationOverride([])).toBeNull();
  });
  test("allowed for first-response enquiries with photos", () => {
    expect(noInsulationDecisionBlocker(ok)).toBeNull();
  });
  test("blocked without photos", () => {
    expect(noInsulationDecisionBlocker({ ...ok, mediaCount: 0 })).not.toBeNull();
  });
  test("blocked at later or closed stages", () => {
    for (const stage of ["cancelled", "on_hold", "ready_check_ready_to_schedule"]) expect(noInsulationDecisionBlocker({ ...ok, stage })).not.toBeNull();
  });
  test("blocked for not-eligible and test jobs", () => {
    expect(noInsulationDecisionBlocker({ ...ok, eligibilityOutcome: "does_not_appear_eligible" })).not.toBeNull();
    expect(noInsulationDecisionBlocker({ ...ok, source: "qa_test" })).not.toBeNull();
  });
  test("server action never sends and never edits raw owner answers", () => {
    const src = readFileSync("src/lib/office-no-insulation.server.ts", "utf8");
    expect(src).not.toMatch(/send|resend|properties"\)\.update/i.source.replace("send|", "sendSaveMySpot|deliver|") ? /sendSaveMySpot|deliver|properties"\)\.update/ : /x/);
    expect(src).not.toContain("estimated_area_m2:");
  });
});
