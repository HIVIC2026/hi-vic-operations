// Phase 1 enquiry backlog — classification, template choice and send-safety matrix.
// Pure unit tests: no network, no database, no email. Covers Jo's categories A–E plus the safety rules
// that decide whether an outstanding enquiry may be answered automatically or must go to Office review.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { automaticLeadEmail, ineligibleReplyBlocker } from "../src/lib/enquiry-groups.core";
import { groupBInvitationBlocker, originalEnquiryMedia } from "../src/lib/group-b-media.core";
import { reservationAllowed } from "../src/lib/emailsafety.core";
import { testRecipientBoundary } from "../src/lib/comms-test-recipient.core";
import { renderJoOutcomeEmail } from "../src/lib/jo-outcome-email.core";
import { selectJoTemplate } from "../src/lib/jo-email-templates.core";

const src = (p: string) => readFileSync(p, "utf8");

/** A website homeowner enquiry after a completed official Gate 1 decision. */
const enquiry = (over: Partial<Parameters<typeof automaticLeadEmail>[0]> = {}) => ({
  source: "base44",
  channel: "hivic_sourced",
  decisionSource: "system",
  reviewRequired: false,
  outcome: "likely_eligible",
  intakeWorkActive: false,
  declaredInsulation: "none" as const,
  ownerEnteredArea: true,
  ...over,
});

const links = {
  saveMySpotUrl: "https://estimate.example/estimate/tok/campaign",
  uploadMediaUrl: "https://estimate.example/estimate/tok/video",
  reviewResultUrl: "https://estimate.example/estimate/tok",
  calculatorUrl: "https://estimate.example/estimate/tok#calculator",
};
const figures = {
  veuRebate: 1200, customerTotal: 3800, totalBeforeRebate: 5000, installation: 4200,
  piesaFee: 349, apFee: 451, ceilingAreaM2: 150, areaEstimated: true,
};
const recipient = { firstName: "Alex", propertyAddress: "12 Example St, Melbourne VIC 3000", enquiryReference: "JOB-1001" };

describe("A. eligible / no existing insulation", () => {
  test("known owner area → Save-my-spot, real area, no assumption flag", () => {
    const r = automaticLeadEmail(enquiry({ ownerEnteredArea: true }));
    expect(r.email).toBe("offer_spot");
    expect(r.assumedArea).toBeUndefined();
    expect(selectJoTemplate({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true }))
      .toBe("eligible_no_insulation_size_known");
  });

  test("no area → automatic send on the labelled 150 m² assumption", () => {
    const r = automaticLeadEmail(enquiry({ ownerEnteredArea: false }));
    expect(r.email).toBe("offer_spot");
    expect(r.assumedArea).toBe(true);
    expect(selectJoTemplate({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: false }))
      .toBe("eligible_no_insulation_size_unknown");
  });

  test("assumed area is disclosed, never presented as measured", () => {
    const mail = renderJoOutcomeEmail({
      outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: false, recipient,
      figures: { ...figures, areaEstimated: true }, links,
    });
    expect(mail).not.toBeNull();
    expect(mail!.html.toLowerCase()).toContain("150");
    // Jo's rule: the 150 m² figure is labelled as an assumption, never as a measured area.
    expect(mail!.html.toLowerCase()).toContain("estimated, not measured");
  });

  test("missing figures → refuses to render (never a half-built price)", () => {
    expect(() => renderJoOutcomeEmail({
      outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true, recipient, links,
    })).toThrow(/estimate figures/);
  });
});

describe("B. clearly ineligible", () => {
  test("verified system reason → ineligible route + T7", () => {
    expect(automaticLeadEmail(enquiry({ outcome: "does_not_appear_eligible" })).email).toBe("ineligible");
    expect(ineligibleReplyBlocker({ outcome: "does_not_appear_eligible", decisionSource: "system", reviewRequired: false, reason: "Ceiling has R4 insulation." })).toBeNull();
    expect(selectJoTemplate({ outcome: "ineligible", insulation: null, ceilingSizeKnown: false })).toBe("ineligible");
  });

  test("no verified reason → held for Office review, nothing sent", () => {
    expect(ineligibleReplyBlocker({ outcome: "does_not_appear_eligible", decisionSource: "system", reviewRequired: false, reason: null })).toBe("ineligible_reason_not_recorded");
    expect(ineligibleReplyBlocker({ outcome: "does_not_appear_eligible", decisionSource: "system", reviewRequired: false, reason: "   " })).toBe("ineligible_reason_not_recorded");
  });

  test("Office-decided ineligible with a recorded reason may reply", () => {
    expect(ineligibleReplyBlocker({ outcome: "does_not_appear_eligible", decisionSource: "admin", reviewRequired: false, reason: "Owner confirmed R4 batts." })).toBeNull();
  });

  test("no official decision at all → never ineligible", () => {
    expect(ineligibleReplyBlocker({ outcome: "does_not_appear_eligible", decisionSource: null, reviewRequired: false, reason: "x" })).toBe("official_decision_not_recorded");
    expect(automaticLeadEmail(enquiry({ outcome: "does_not_appear_eligible", decisionSource: null })).email).toBe("none");
  });

  test("review-required ineligible → held", () => {
    expect(ineligibleReplyBlocker({ outcome: "does_not_appear_eligible", decisionSource: "system", reviewRequired: true, reason: "x" })).toBe("eligibility_review_required");
    expect(automaticLeadEmail(enquiry({ outcome: "does_not_appear_eligible", reviewRequired: true })).email).toBe("none");
  });
});

describe("C. insulation status unknown → information request, never ineligible", () => {
  test("unknown insulation requests photos/video", () => {
    const r = automaticLeadEmail(enquiry({ declaredInsulation: "unknown" }));
    expect(r.email).toBe("request_insulation");
    expect(selectJoTemplate({ outcome: "likely_eligible", insulation: "unknown", ceilingSizeKnown: true })).toBe("potentially_eligible_unknown_size_known");
  });

  test("unknown insulation with no ceiling size still requests information (T5)", () => {
    expect(automaticLeadEmail(enquiry({ declaredInsulation: "unknown", ownerEnteredArea: false })).email).toBe("request_insulation");
    expect(selectJoTemplate({ outcome: "likely_eligible", insulation: "unknown", ceilingSizeKnown: false })).toBe("potentially_eligible_unknown_size_unknown");
  });
});

describe("D. existing insulation with media → Office review", () => {
  const none = { excluded: false, received: false, uncertain: false, pendingSync: false, count: 0 };

  test("media already received → invitation blocked for review", () => {
    expect(groupBInvitationBlocker({ ...none, received: true, count: 2 })).toContain("office review");
  });

  test("media sync uncertain → held, never treated as 'no media'", () => {
    expect(groupBInvitationBlocker({ ...none, uncertain: true })).toContain("held");
    const unknownManifest = originalEnquiryMedia(undefined, []);
    expect(unknownManifest.uncertain).toBe(true);
    expect(groupBInvitationBlocker(unknownManifest)).not.toBeNull();
  });

  test("proven empty manifest → the information request may go", () => {
    const m = originalEnquiryMedia({ answers: { media: [] }, original_media_verification: { complete: true } }, []);
    expect(m.received).toBe(false);
    expect(m.uncertain).toBe(false);
    expect(groupBInvitationBlocker(m)).toBeNull();
  });

  test("a stray non-media answer is uncertainty, not proof of absence", () => {
    const m = originalEnquiryMedia({ answers: { photos: ["not-a-file"] }, original_media_verification: { complete: true } }, []);
    expect(m.uncertain).toBe(true);
  });
});

describe("E. ambiguous enquiries are held, never guessed", () => {
  test("review required → none", () => {
    expect(automaticLeadEmail(enquiry({ reviewRequired: true })).email).toBe("none");
  });

  test("no insulation answer at all → none (cannot assume 'no insulation')", () => {
    expect(automaticLeadEmail(enquiry({ declaredInsulation: null })).email).toBe("none");
  });

  test("initial checks still running → none", () => {
    expect(automaticLeadEmail(enquiry({ intakeWorkActive: true })).email).toBe("none");
  });

  test("non-website or installer-sourced records are outside the automatic reply", () => {
    expect(automaticLeadEmail(enquiry({ channel: "installer_sourced" })).email).toBe("none");
    expect(automaticLeadEmail(enquiry({ source: "qa_test" })).email).toBe("none");
  });

  test("unknown outcome → none", () => {
    expect(automaticLeadEmail(enquiry({ outcome: null })).email).toBe("none");
  });
});

describe("F. duplicates, retries and recipients", () => {
  test("sent / in-flight / unrecorded are never re-sent; only a clean failure retries", () => {
    expect(reservationAllowed(null)).toBe(true);
    expect(reservationAllowed({ status: "failed" })).toBe(true);
    for (const s of ["sent", "delivered_unrecorded", "sending", "queued"]) expect(reservationAllowed({ status: s })).toBe(false);
  });

  test("non-production blocks a real homeowner address", () => {
    expect(testRecipientBoundary("owner@example.com", "base44", { env: "preview", allowlist: "" }).restricted).toBe(true);
  });

  test("production is not restricted by the test boundary", () => {
    expect(testRecipientBoundary("owner@example.com", "base44", { env: "production" }).status).toBe("inactive");
  });

  test("allow-listed test recipient passes outside production", () => {
    expect(testRecipientBoundary("jo@homeinsulationvictoria.com.au", "base44", { env: "preview", allowlist: "jo@homeinsulationvictoria.com.au" }).status).toBe("allowed");
  });
});

describe("G. template unification (source guarantees)", () => {
  const send = src("src/lib/hot-leads-send.server.ts");
  const followups = src("src/lib/followups.server.ts");
  const routing = src("src/lib/lead-email-routing.server.ts");

  test("an automatic send with no Jo template is blocked, never sent with legacy copy", () => {
    // P1-S77: the hold now covers EVERY path (automatic, Office copy, follow-up, previews) — no legacy mailBase exists.
    expect(send).toContain("if (!joMail) {");
    expect(send).toContain("const mail = joMail;");
    expect(send).not.toContain("mailBase");
    expect(send).toContain("No approved Jo template applies");
  });

  test("the ineligible sender no longer falls back to the legacy renderer", () => {
    expect(followups).not.toContain("renderIneligibleEmail");
    expect(followups).toContain("no_approved_template");
  });

  test("the router gates the automatic ineligible reply on a verified reason", () => {
    expect(routing).toContain("ineligibleReplyBlocker");
    expect(routing).toContain("syncStep3");
  });
});
