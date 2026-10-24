import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mediaReviewPlan, PHOTO_INELIGIBLE_OWNER_REASON } from "../src/lib/office-media-review.core";

// Decision 5 (Jo 24 Oct): "Not eligible – close" records the Office ineligible decision and sends T7.
describe("photo review Not eligible – close", () => {
  test("approved owner wording", () => {
    expect(PHOTO_INELIGIBLE_OWNER_REASON).toBe("From the photos and details you sent us, the insulation already in your ceiling appears to be R2.0 or above. The VEU ceiling insulation rebate is only available where the existing insulation is below R2.0.");
  });
  test("close still needs an internal reason and only over_r2 closes", () => {
    expect(() => mediaReviewPlan("over_r2", "", true)).toThrow();
    expect(() => mediaReviewPlan("below_r2", "x", true)).toThrow();
    expect(mediaReviewPlan("over_r2", "R3 batts visible", true).close).toBe(true);
  });
  test("close records an admin ineligible decision with the approved wording, office reason internal", () => {
    const srv = readFileSync("src/lib/enquiry-groups.server.ts", "utf8");
    expect(srv).toMatch(/eligibility_outcome: "does_not_appear_eligible", eligibility_reason: PHOTO_INELIGIBLE_OWNER_REASON[^\n]*eligibility_decision_source: "admin", eligibility_review_required: false/);
    expect(srv).toMatch(/office_reason: plan\.reason/);
  });
  test("the dialog always sends through the guarded sender; no tick box", () => {
    const ui = readFileSync("src/components/portal/SpotPhotoCheck.tsx", "utf8");
    expect(ui).not.toMatch(/Email the owner/);
    expect(ui).not.toMatch(/emailOwner/);
    expect(ui).toMatch(/ineligible\(\{ data: \{ jobId, mode: "send" \} \}\)/);
  });
});
