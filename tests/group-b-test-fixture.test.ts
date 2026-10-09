import { describe, expect, test } from "bun:test";
import { groupBTestAudit, groupBTestRaw } from "../src/lib/group-b-test-fixture.core";
import { originalEnquiryMedia } from "../src/lib/group-b-media.core";
import { declarationCriteriaPassed } from "../src/lib/insulation-review.core";
import { launchGroup } from "../src/lib/launch-campaign.core";
import { GATE1_RULESET_VERSION, normaliseInsulation } from "../src/lib/eligibility.core";
import { declaredExtras } from "../src/lib/enquiry.core";

describe("Group B TEST homeowner for Jo's test copies", () => {
  const raw = groupBTestRaw();
  const insulation = normaliseInsulation(declaredExtras(raw.answers).existing_insulation);
  test("is Group B (existing insulation), not the likely-eligible group", () => {
    expect(launchGroup("likely_eligible", insulation)).toBe("onsite");
  });
  test("original media is confirmed empty, so the four choices show", () => {
    expect(originalEnquiryMedia(raw, []).excluded).toBe(false);
  });
  test("other initial checks pass, so a Yes declaration can open Save your spot", () => {
    expect(declarationCriteriaPassed({ outcome: "likely_eligible", decisionSource: "system", reviewRequired: false, audit: groupBTestAudit(GATE1_RULESET_VERSION) as never, insulation, intakeActive: false })).toBe(true);
  });
});
