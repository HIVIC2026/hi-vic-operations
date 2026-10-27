// Jo 27 Oct: a calculator registration starts the normal website enquiry journey (same intake, matching, Gate 1,
// Save my spot and reminders). Pure mapping only: no I/O. The office tells it apart by the "calculator" marker.
import type { NormalisedInterest } from "./interest.core";

export const CALCULATOR_INTAKE_CHANNEL = "calculator";
export const CALCULATOR_EVENT = "calculator_registration";
const TEST_DOMAIN = /@(?:[a-z0-9-]+\.)*hivic-test\.example$/i;

/** TEST-domain registrations become qa_test jobs (no live automation, emails redirected to Jo's TEST inbox). */
export function calculatorIntakeSource(email: string): "qa_test" | "base44" {
  return TEST_DOMAIN.test(email.trim()) ? "qa_test" : "base44";
}

export const calculatorExternalId = (interestId: string) => `${CALCULATOR_INTAKE_CHANNEL}:${interestId}`;

/** The website (Base44) answer word for the declared insulation, read back by the same Gate 1 rules. */
export const CALCULATOR_INSULATION_ANSWER = { none: "no", present: "yes", unknown: "unknown" } as const;

/** Why a registration can't start an enquiry (website enquiries require a ceiling size); null = it can. */
export function calculatorIntakeBlocker(v: Pick<NormalisedInterest, "ceilingM2" | "addressLine">): string | null {
  if (!v.ceilingM2 || v.ceilingM2 <= 0) return "No ceiling size given — website enquiries need one.";
  if (v.addressLine.trim().length < 3) return "No street address given.";
  return null;
}

/** Same shape the signed website handoff gives upsertEnquiry. Owner answers stay DECLARED. */
export function calculatorEnquiryInput(interestId: string, v: NormalisedInterest, consentedAt: string) {
  return {
    external_enquiry_id: calculatorExternalId(interestId),
    source_reference: CALCULATOR_INTAKE_CHANNEL,
    full_name: v.fullName,
    email: v.email,
    phone: v.mobile,
    address_line: v.addressLine,
    suburb: v.suburb || null,
    postcode: v.postcode || null,
    state: "VIC",
    estimated_area_m2: v.ceilingM2,
    contact_consent: true,
    contact_consent_version: v.consentVersion,
    contact_consented_at: consentedAt,
    base44_answers: { insulation: CALCULATOR_INSULATION_ANSWER[v.insulationDeclared], intake_channel: CALCULATOR_INTAKE_CHANNEL },
    media: [],
    media_manifest_complete: true,
  };
}
