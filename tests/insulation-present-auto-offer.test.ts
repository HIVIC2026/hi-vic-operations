import { describe, expect, test } from "bun:test";
import { automaticLeadEmail } from "../src/lib/enquiry-groups.core";
import { existingInsulationRules, DEFAULT_FILTERS } from "../src/lib/save-spot-rules.core";
import { PRESENT_AUTO_OFFER_EVENT, presentAutoOfferDetails, qualifyingDeclaration } from "../src/lib/insulation-review.core";

const base = { source: "base44", channel: "hivic_sourced", decisionSource: "system", reviewRequired: false, outcome: "needs_onsite_confirmation", intakeWorkActive: false, declaredInsulation: "present" as const, ownerEnteredArea: true };

describe("Jo 23 Oct 4:10pm: insulation present -> existing-insulation Save my spot", () => {
  for (const detail of ["likely_save_spot", "more_photos", null] as const) {
    test(`detail route ${detail} gets the existing-insulation offer, never the photo request`, () => {
      expect(automaticLeadEmail({ ...base, insulationDetailRoute: detail })).toEqual({ email: "offer_spot", blocker: null, existingInsulation: true });
    });
  }
  test("likely eligible with insulation present also gets it", () => expect(automaticLeadEmail({ ...base, outcome: "likely_eligible" }).existingInsulation).toBe(true));
  test("decision 417: an Office review no longer holds the offer", () => expect(automaticLeadEmail({ ...base, officeReviewed: true }).email).toBe("offer_spot"));
  test("decision 417: photos showing R2 or more stop the offer", () => expect(automaticLeadEmail({ ...base, officeReviewed: true, officeReviewOutcome: "over_r2" })).toEqual({ email: "none", blocker: "Photos show insulation already R2 or more — office review" }));
  test("decision 392: owner unsure whether insulation exists gets the same offer (don't-know wording), not the details request", () => expect(automaticLeadEmail({ ...base, declaredInsulation: "unknown" })).toEqual({ email: "offer_spot", blocker: null, existingInsulation: true, insulationUnknown: true }));
  test("decision 417: an Office review of an unsure owner gets Save my spot", () => expect(automaticLeadEmail({ ...base, declaredInsulation: "unknown", officeReviewed: true }).email).toBe("offer_spot"));
  test("no-insulation owners are unchanged", () => expect(automaticLeadEmail({ ...base, outcome: "likely_eligible", declaredInsulation: "none" })).toEqual({ email: "offer_spot", blocker: null }));
  test("TEST enquiries never auto-email", () => expect(automaticLeadEmail({ ...base, source: "qa_test" }).email).toBe("none"));
  test("rules no longer hold present insulation or onsite-confirmation on this route; others unchanged", () => {
    const r = DEFAULT_FILTERS;
    const live = { ...r, insulation: { enabled: true, values: ["none"] as never }, eligibility: { enabled: true, outcomes: ["likely_eligible"] as never } };
    const w = existingInsulationRules(live);
    expect(w.insulation.values).toEqual(["none", "present"] as never);
    expect(w.eligibility.outcomes).toEqual(["likely_eligible", "needs_onsite_confirmation"] as never);
    expect(w.postcode).toEqual(live.postcode); expect(w.ceilingArea).toEqual(live.ceilingArea); expect(w.jobStatus).toEqual(live.jobStatus); expect(w.enquiryDate).toEqual(live.enquiryDate);
  });
  test("the automatic qualification lets the owner save a spot", () => {
    expect(qualifyingDeclaration([{ event_type: PRESENT_AUTO_OFFER_EVENT, details: presentAutoOfferDetails() }])).toBe(true);
    expect(qualifyingDeclaration([{ event_type: PRESENT_AUTO_OFFER_EVENT, details: { ...presentAutoOfferDetails(), declaration_type: "x" } }])).toBe(false);
    // Decision 392: the honest "don't know" record qualifies too, only in its exact shape.
    expect(qualifyingDeclaration([{ event_type: PRESENT_AUTO_OFFER_EVENT, details: presentAutoOfferDetails("unknown") }])).toBe(true);
    expect(qualifyingDeclaration([{ event_type: PRESENT_AUTO_OFFER_EVENT, details: { ...presentAutoOfferDetails("unknown"), answer: "yes" } }])).toBe(false);
  });
});
