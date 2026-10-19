// Shared sample facts for the static customer email previews (Step 3 preview page and the office Templates hub).
// Moved verbatim from src/routes/step3-email-preview.tsx — renderers and wording unchanged; nothing here sends.
import { renderFollowupEmail } from "./followup-email";
import { renderCoverageUnavailableEmail } from "./coverage-email";
import { renderEstimateEmail, renderIneligibleOutcomeEmail } from "./estimate-email";
import { renderStep3SaveSpot, renderStep3SaveSpotNoSize, STEP3_SAVESPOT_SAMPLE } from "./step3-emails";
import { renderMeasuredQuoteEmail, renderBookingConsentEmail, renderPreInstallPackEmail, renderAssignmentSigningEmail, renderCompletionPackEmail, LIFECYCLE_SAMPLE } from "./lifecycle-emails";
import { withUnsubscribe } from "./emailsafety.core";
import type { RetailSettings } from "./estimate.core";

export const estimateUrl = "https://estimate.homeinsulationvictoria.com.au/estimate/sample-secure-link";
export const referralUrl = `https://homeinsulationvictoria.com.au/homeowner?ref=${"R".repeat(43)}`;
export const unsubscribeUrl = `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"U".repeat(43)}`;
// PREVIEW SAMPLE ONLY. The Ready Check is free; PIESA and AP fees remain dynamic quote inputs.
// Illustrative example only — real Step 3 calculation for postcode 3336, 150 m², standard access, no removal, current settings v2.
export const SAMPLE_INSTALL = 4500, SAMPLE_DISCOUNT = 1481.76, PIESA_FEE = 349, AP_FEE = 349;
export const SAMPLE_GROSS = SAMPLE_INSTALL + PIESA_FEE + AP_FEE;
export const SAMPLE_CUSTOMER = SAMPLE_GROSS - SAMPLE_DISCOUNT;
export const previewSettings: RetailSettings = {
  id: "preview-v2", version: 2, r5_install_inc_gst_per_m2: 30, removal_inc_gst_per_m2: 0,
  piesa_assessment_inc_gst: PIESA_FEE, ap_management_inc_gst: AP_FEE,
  access_standard_multiplier: 1, access_moderate_multiplier: 1.1, access_difficult_multiplier: 1.25,
  indicative_veec_value: 70, veec_value_source_label: "Current settings example",
  veec_value_source_url: "https://www.energy.vic.gov.au/victorian-energy-upgrades/products/insulation-discounts",
  veec_value_checked_at: "2026-09-29", minimum_customer_copayment_inc_gst: 200,
  max_discount_metro_inc_gst: 1500, max_discount_regional_inc_gst: 2100,
  spec_version: "25.0", spec_source_url: "https://www.energy.vic.gov.au/",
};
export const quote = {
  estimateUrl,
  estimatedTotal: SAMPLE_CUSTOMER,
  veuDiscount: SAMPLE_DISCOUNT,
  areaM2: 150,
  installationPrice: SAMPLE_INSTALL,
  assessmentFee: PIESA_FEE,
  apFee: AP_FEE,
  grossProjectTotal: SAMPLE_GROSS,
  amountPayableNow: 0,
  estimatedRemainingBalance: SAMPLE_CUSTOMER,
  savingsPercent: Math.round((SAMPLE_DISCOUNT / SAMPLE_GROSS) * 100),
  firstName: "Alex",
  address: "30 Dash St, Fraser Rise VIC 3336",
  referralUrl,
  reference: "SAMPLE-1001",
} as const;
export const samples = {
  likely: withUnsubscribe(renderEstimateEmail({
    ...quote,
    estimateUrl,
    outcome: "likely",
    apCount: 2, // business-owner supplied current figure (1 Oct 2026), not registry-verified
  }), unsubscribeUrl),
  // APPROVED by Jo Lowe, 7 Oct 2026 — FINAL Save your spot email.
  savespot: renderStep3SaveSpot(STEP3_SAVESPOT_SAMPLE),
  savespotNoSize: renderStep3SaveSpotNoSize(STEP3_SAVESPOT_SAMPLE),
  onsite: withUnsubscribe(renderEstimateEmail({
    ...quote,
    outcome: "onsite",
    reasons: ["The existing insulation and eligible ceiling area need to be confirmed onsite.", "Roof access and electrical safety need to be checked."],
  }), unsubscribeUrl),
  ineligible: withUnsubscribe(renderIneligibleOutcomeEmail({
    referralUrl,
    reasons: ["The information supplied indicates this property does not meet the preliminary requirements for this offer."],
    reference: "SAMPLE-1001",
  }), unsubscribeUrl),
  reminder3: withUnsubscribe(renderFollowupEmail({ kind: "estimate_unopened_3d", estimateUrl, referralUrl }), unsubscribeUrl),
  coverage: withUnsubscribe(renderCoverageUnavailableEmail({ firstName: "Alex", suburb: "Fraser Rise", postcode: "3336", missing: ["installer"], reference: "SAMPLE-1001" }), unsubscribeUrl),
  // P1-R2-S02 later-stage lifecycle previews (draft wording; nothing sends). Sample figures only.
  measured_quote: withUnsubscribe(renderMeasuredQuoteEmail({
    ...LIFECYCLE_SAMPLE, measuredAreaM2: 150, piesaFee: "$349.00", supplyInstall: "$4,500.00", apFee: "$349.00",
    veecCount: 21, veuDiscount: "$1,481.76", totalIncGst: "$3,716.24",
    acceptUrl: "https://estimate.homeinsulationvictoria.com.au/quote/sample-secure-link", areaChangedOver15pct: false,
  }), unsubscribeUrl),
  booking_consent: withUnsubscribe(renderBookingConsentEmail({
    ...LIFECYCLE_SAMPLE, installDate: "Tuesday 20 October 2026", installTime: "8:00am–12:00pm",
    installerBusiness: "Sample Insulation Co", firstHalfAmount: "$1,858.12",
    bookingUrl: "https://estimate.homeinsulationvictoria.com.au/booking/sample-secure-link",
  }), unsubscribeUrl),
  pre_install_pack: withUnsubscribe(renderPreInstallPackEmail({
    ...LIFECYCLE_SAMPLE, installDate: "Tuesday 20 October 2026",
    documentsUrl: "https://estimate.homeinsulationvictoria.com.au/documents/sample-secure-link",
  }), unsubscribeUrl),
  assignment_signing: withUnsubscribe(renderAssignmentSigningEmail({
    ...LIFECYCLE_SAMPLE, signingUrl: "https://estimate.homeinsulationvictoria.com.au/sign/sample-secure-link",
  }), unsubscribeUrl),
  completion_pack: withUnsubscribe(renderCompletionPackEmail({
    ...LIFECYCLE_SAMPLE, coesIncluded: false,
    completionUrl: "https://estimate.homeinsulationvictoria.com.au/completion/sample-secure-link",
  }), unsubscribeUrl),
};
export const OUTCOME_LABELS = { likely: "Likely eligible", savespot: "Save your spot", savespotNoSize: "Save your spot — no ceiling size", onsite: "Needs onsite confirmation", ineligible: "Does not appear eligible", reminder3: "Reminder: 3 days, unopened", coverage: "Service availability update", measured_quote: "Measured quote", booking_consent: "Booking confirmation + consent", pre_install_pack: "Pre-installation pack", assignment_signing: "VEEC assignment signing", completion_pack: "Completion pack" } as const;
