import { describe, expect, test } from "bun:test";
import { nextStep, stageMismatches } from "../src/lib/nextstep.core";
import { planStep, type AdvanceFacts } from "../src/lib/autoadvance.core";
import { DEFAULT_NEXT_ACTION, STAGE_ORDER as STAGES } from "../src/lib/workflow";

const base: AdvanceFacts = { eligibilityConfirmed: true, electricianAssigned: false, assessmentBookingConfirmed: false, openRectItems: 0, rectQuoteIssued: false, rectQuoteAccepted: false, installQuotesIssued: false, installQuoteAccepted: false, consumerSigned: false, invoiceExists: false, depositCleared: false, rectBookingConfirmed: false, installBookingConfirmed: false, installationCompleted: false, installerDeclarationSigned: false, veecLodged: false };

describe("one next-step rule", () => {
  test("eligible early jobs never say electrician", () => {
    for (const outcome of ["likely_eligible", "needs_onsite_confirmation"]) for (const stage of ["new_enquiry", "eligibility_review"]) {
      const s = nextStep({ stage, eligibility_outcome: outcome, next_action: "Assign electrician" });
      expect(s.label).not.toMatch(/electrician/i);
      expect(s.next.toLowerCase()).not.toContain("electrician");
    }
  });
  test("stored free text is never shown as the step (except review reasons)", () => {
    expect(nextStep({ stage: "ready_check_ready_to_schedule", eligibility_outcome: "likely_eligible", next_action: "Assign electrician" }).next).toBe(DEFAULT_NEXT_ACTION.ready_check_ready_to_schedule);
    expect(nextStep({ stage: "new_enquiry", eligibility_review_required: true, next_action: "Review required: Address ambiguous" }).next).toBe("Review eligibility");
  });
  test("ineligible and review override the stage", () => {
    expect(nextStep({ stage: "ready_check_scheduled", eligibility_outcome: "does_not_appear_eligible" }).label).toBe("Does Not Appear Eligible");
    expect(nextStep({ stage: "new_enquiry", eligibility_review_required: true }).label).toBe("Needs review");
  });
  test("every stage produces a label and a next step", () => {
    for (const stage of STAGES) { const s = nextStep({ stage, eligibility_outcome: "likely_eligible" }); expect(s.label.length).toBeGreaterThan(0); expect(s.next.length).toBeGreaterThan(0); }
  });
});

describe("routing after eligibility", () => {
  // Jo 8 Oct: eligibility alone never creates a Ready Check; the job waits for the owner to save a spot.
  test("no approved measure-up → waits for the owner to save a spot", () => expect(planStep("new_enquiry", base)).toMatchObject({ to: "preliminary_estimate_ready" }));
  test("HI VIC-approved measure-up → skips Ready Check", () => expect(planStep("new_enquiry", { ...base, measureUpAccepted: true })).toMatchObject({ to: "ready_check_complete" }));
  test("waiting at Ready Check, measure-up approved later → skips", () => expect(planStep("ready_check_ready_to_schedule", { ...base, measureUpAccepted: true })).toMatchObject({ to: "ready_check_complete" }));
  test("waiting at Ready Check, not approved → stays", () => expect(planStep("ready_check_ready_to_schedule", base).kind).toBe("stop"));
});

describe("mismatch alarm", () => {
  const ok = { stage: "ready_check_scheduled", eligibility_outcome: "likely_eligible", eligibility_review_required: false, electricianAssigned: false, installQuoteAccepted: false };
  test("clean job has none", () => expect(stageMismatches(ok)).toEqual([]));
  test("legacy awaiting electrician flagged", () => expect(stageMismatches({ ...ok, stage: "awaiting_electrician" }).length).toBe(1));
  test("moved on while ineligible flagged", () => expect(stageMismatches({ ...ok, eligibility_outcome: "does_not_appear_eligible" }).length).toBeGreaterThan(0));
  test("post-acceptance stage without accepted quote flagged", () => expect(stageMismatches({ ...ok, stage: "installation_booked" }).length).toBe(1));
});

import { nextStep as ns2 } from "../src/lib/nextstep.core";
test("saved spot at preliminary estimate shows Spot saved", () => {
  expect(ns2({ stage: "preliminary_estimate_ready", eligibility_outcome: "likely_eligible", office_status: "spot_saved" }).label).toBe("Spot saved");
  expect(ns2({ stage: "preliminary_estimate_ready", eligibility_outcome: "likely_eligible", office_status: "offered_spot" }).label).toBe("Estimate sent");
});
