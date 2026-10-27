import { qaContextActive } from "./qa-context.server";
import { qaPerson } from "./qa-request.core";
import type { NormalisedInterest } from "./interest.core";

/** Existing public form, but only a signed server-verified preview request may create a TEST job. */
export async function recordQaWebsiteEnquiry(value: NormalisedInterest) {
  if (!qaContextActive() || !qaPerson(value.email)) throw new Error("SAFETY STOP: authorised preview request and TEST-domain owner required");
  const { upsertEnquiry } = await import("./enquiry.server");
  const { recordContactConsent } = await import("./intake.server");
  const input = {
    full_name: value.fullName, email: value.email, phone: value.mobile,
    address_line: value.addressLine, suburb: value.suburb, postcode: value.postcode, state: "VIC",
    estimated_area_m2: value.ceilingM2, contact_consent: true,
    contact_consent_version: value.consentVersion, contact_consented_at: new Date().toISOString(),
    external_enquiry_id: `qa-website-${crypto.randomUUID()}`,
    base44_answers: { insulation_declared: value.insulationDeclared },
  };
  const result = await upsertEnquiry(input, "qa_test", null);
  await recordContactConsent(result.job_id, (await (await import("@/integrations/supabase/client.server")).supabaseAdmin.from("jobs").select("owner_id").eq("id", result.job_id).single()).data?.owner_id ?? "", input);
  return result;
}