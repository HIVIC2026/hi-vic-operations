// Phase 1 audit repairs: received-media automatic acknowledgement, any-purpose first-response dedupe, fail-closed media,
// durable retry selection, Office next responsible party, no-insulation offer gate and truthful response counts.
import { expect, test } from "bun:test";
import { groupBInitialAction, originalEnquiryMedia, MEDIA_IMPORT_PENDING } from "../src/lib/group-b-media.core";
import { priorInitialResponseBlocker, sweepEligible, EXPLICITLY_EXCLUDED_JOBS } from "../src/lib/automatic-first-response.core";
import { enquiryNextStep, noInsulationOfferBlocker, parseResponseCounts, showingRange, RESPONSE_STATE_LABEL } from "../src/lib/enquiry-response.core";
import { renderJoOutcomeEmail, type JoOutcomeEmailInput } from "../src/lib/jo-outcome-email.core";

const JOB = "a1691ed7-58e0-4729-84e2-0441a240de45";
const doc = (n: number) => ({ kind: "intake_media", mime_type: "image/jpeg", storage_path: `${JOB}/intake/${n}.jpg`, source_system: "base44", external_id: `m${n}` });
const raw = (media: unknown) => ({ answers: { existing_insulation: "Not sure" }, media });

// --- received-media acknowledgement vs request vs hold -------------------------------------------------------------
test("five imported homeowner files → automatic acknowledgement, not a repeat upload request", () => {
  const ids = [1, 2, 3, 4, 5];
  const state = originalEnquiryMedia(raw(ids.map((n) => ({ id: `m${n}`, mime_type: "image/jpeg" }))), ids.map(doc));
  expect(groupBInitialAction(state)).toEqual({ action: "acknowledge" });
});
test("explicit empty media → photo/video request", () => {
  expect(groupBInitialAction(originalEnquiryMedia(raw([]), []))).toEqual({ action: "request" });
});
test("media still importing → held (retried), never request or acknowledgement", () => {
  const state = originalEnquiryMedia(raw([{ id: "m1", mime_type: "image/jpeg" }, { id: "m2", mime_type: "image/jpeg" }]), [doc(1)]);
  expect(groupBInitialAction(state)).toEqual({ held: MEDIA_IMPORT_PENDING });
});
test("absent, non-array or unreadable manifests fail closed", () => {
  expect("held" in groupBInitialAction(originalEnquiryMedia({ answers: {} }, []))).toBe(true);
  expect("held" in groupBInitialAction(originalEnquiryMedia(raw("yes"), []))).toBe(true);
  expect("held" in groupBInitialAction(originalEnquiryMedia(raw([]), [], true))).toBe(true);
  expect("held" in groupBInitialAction(originalEnquiryMedia({ ...raw([]), original_media_manifest_uncertain: true }, []))).toBe(true);
});

const email: JoOutcomeEmailInput = {
  outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: true, mediaAlreadyReceived: true,
  recipient: { firstName: "Fictional", propertyAddress: "1 TEST Street VIC 3000", enquiryReference: "TEST" },
  figures: { veuRebate: 1481.76, customerTotal: 3697.24, totalBeforeRebate: 5179, installation: 4481, piesaFee: 349, apFee: 349, ceilingAreaM2: 150, areaEstimated: false },
  links: { saveMySpotUrl: "https://x.test/c", uploadMediaUrl: "https://x.test/v", reviewResultUrl: "https://x.test/r", calculatorUrl: "https://x.test/k" },
};
test("acknowledgement uses the approved received-media variant and decides no eligibility", () => {
  const mail = renderJoOutcomeEmail(email)!;
  expect(mail.plainText).toContain("you do not need to upload it again");
  expect(mail.plainText).toContain("Final eligibility will be confirmed at your free Ready Check");
  expect(mail.plainText).toContain("Add more photos or video");
  expect(mail.plainText).not.toContain("Please upload clear photos");
  expect(mail.ctas).not.toContain("save_my_spot");
});
test("acknowledgement can never be rendered as a likely-eligible offer", () => {
  expect(() => renderJoOutcomeEmail({ ...email, outcome: "likely_eligible", insulation: "none" })).toThrow();
});

// --- first-response dedupe -----------------------------------------------------------------------------------------
test("any-purpose sent or delivered blocks an automatic initial", () => {
  expect(priorInitialResponseBlocker({ sendStatuses: ["sent"], customerOutboundEmails: 0 })).toBe("Confirmed first response already sent");
  expect(priorInitialResponseBlocker({ sendStatuses: ["delivered"], customerOutboundEmails: 0 })).toBe("Confirmed first response already sent");
});
test("correspondence-only reply blocks an automatic initial", () => {
  expect(priorInitialResponseBlocker({ sendStatuses: [], customerOutboundEmails: 1 })).toBe("Customer correspondence already recorded on this job");
});
test("uncertain attempts block; a confirmed failure stays retryable", () => {
  for (const s of ["sending", "queued", "delivered_unrecorded", "sending_unknown"]) expect(priorInitialResponseBlocker({ sendStatuses: [s], customerOutboundEmails: 0 })).toContain("uncertain");
  expect(priorInitialResponseBlocker({ sendStatuses: ["failed"], customerOutboundEmails: 0 })).toBeNull();
});
test("unreadable history blocks", () => {
  expect(priorInitialResponseBlocker({ sendStatuses: null, customerOutboundEmails: 0 })).not.toBeNull();
  expect(priorInitialResponseBlocker({ sendStatuses: [], customerOutboundEmails: null })).not.toBeNull();
});

// --- durable retry selection ---------------------------------------------------------------------------------------
const now = Date.parse("2026-10-20T09:00:00Z"), activated = "2026-10-20T00:12:44Z";
const row = { created_at: "2026-10-20T08:28:00Z", needs_first_response: true, office_bucket: "enquiry", source: "base44", job_number: "HV-2877" };
test("held new enquiry is retried by the sweep", () => expect(sweepEligible(row, activated, now)).toBe(true));
test("sweep skips answered, closed/active, test, pre-activation, >14 days and explicit exclusions", () => {
  expect(sweepEligible({ ...row, needs_first_response: false }, activated, now)).toBe(false);
  expect(sweepEligible({ ...row, office_bucket: "closed" }, activated, now)).toBe(false);
  expect(sweepEligible({ ...row, source: "qa_test" }, activated, now)).toBe(false);
  expect(sweepEligible({ ...row, created_at: "2026-10-19T23:00:00Z" }, activated, now)).toBe(false);
  expect(sweepEligible({ ...row, created_at: "2026-10-20T08:00:00Z" }, activated, now + 15 * 86_400_000)).toBe(false);
  for (const n of EXPLICITLY_EXCLUDED_JOBS) expect(sweepEligible({ ...row, job_number: n }, activated, now)).toBe(false);
  expect(sweepEligible(row, null, now)).toBe(false);
});

// --- next responsible party ----------------------------------------------------------------------------------------
test("received unreviewed media is Office's turn even when the lane is 'insulation requested'", () => {
  const n = enquiryNextStep({ status: "insulation_requested", mediaToReview: true, reviewOutcome: null, mediaCount: 1, fallback: null });
  expect(n.party).toBe("office");
  expect(n.label).toContain("review 1 photo");
});
test("open request for more media waits for the homeowner until new media arrives", () => {
  expect(enquiryNextStep({ status: "insulation_requested", mediaToReview: false, reviewOutcome: "unclear", mediaCount: 2, fallback: null }).party).toBe("homeowner");
  expect(enquiryNextStep({ status: "insulation_requested", mediaToReview: true, reviewOutcome: "unclear", mediaCount: 3, fallback: null }).party).toBe("office");
});
test("reviewed below-R2 / no-insulation show the explicit Office send action until an offer exists", () => {
  expect(enquiryNextStep({ status: "insulation_requested", mediaToReview: false, reviewOutcome: "below_r2", mediaCount: 2, fallback: null }).label).toContain("existing-insulation");
  expect(enquiryNextStep({ status: "needs_attention", mediaToReview: false, reviewOutcome: "no_insulation", mediaCount: 2, fallback: null }).label).toContain("no-insulation");
  expect(enquiryNextStep({ status: "offered_spot", mediaToReview: false, reviewOutcome: "below_r2", mediaCount: 2, fallback: null }).party).toBe("homeowner");
});

// --- no-insulation offer gate --------------------------------------------------------------------------------------
const gate = { source: "base44", stage: "preliminary_estimate_ready", outcome: "likely_eligible", decisionSource: "admin", reviewRequired: false, latestReview: "no_insulation" };
test("no-insulation offer requires the review AND a recorded likely-eligible decision", () => {
  expect(noInsulationOfferBlocker(gate)).toBeNull();
  expect(noInsulationOfferBlocker({ ...gate, outcome: "needs_onsite_confirmation" })).toContain("photos alone never decide eligibility");
  expect(noInsulationOfferBlocker({ ...gate, reviewRequired: true })).toContain("photos alone");
  expect(noInsulationOfferBlocker({ ...gate, latestReview: "below_r2" })).not.toBeNull();
  expect(noInsulationOfferBlocker({ ...gate, stage: "cancelled" })).not.toBeNull();
  expect(noInsulationOfferBlocker({ ...gate, source: "qa_test" })).not.toBeNull();
});

// --- truthful counts/labels ----------------------------------------------------------------------------------------
test("missing response breakdown is unavailable, never zero", () => {
  expect(parseResponseCounts(null)).toBeNull();
  expect(parseResponseCounts({ provider_confirmed: 1, recorded_only: 2, uncertain: 0, unanswered: 3 })).toBeNull();
  expect(parseResponseCounts({ provider_confirmed: 1205, recorded_only: 69, uncertain: 0, unanswered: 3, unanswered_latest_failed: 0 })?.unanswered).toBe(3);
});
test("recorded correspondence is labelled as not delivery-confirmed", () => {
  expect(RESPONSE_STATE_LABEL.recorded_only).toContain("delivery not confirmed");
  expect(RESPONSE_STATE_LABEL.provider_confirmed).toContain("accepted by email service");
});
test("page range reflects the rows on the page, not the filter total", () => {
  expect(showingRange(1, 50, 50, 1277)).toBe("Showing 1–50 of 1,277");
  expect(showingRange(26, 50, 27, 1277)).toBe("Showing 1,251–1,277 of 1,277");
});
