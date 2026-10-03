// Pure orchestration of REC agreement signing. All I/O is injected so the
// validation order, idempotence and failure rollback can be tested without a database.
import { mayRelaxRequiredSteps } from "./onboarding-security.core";
import {
  acknowledgementsFor, agreementText, blockedMandatoryStep, effectiveElectricians, firstIncompleteStep,
  REC_AGREEMENT_TITLE, REC_AGREEMENT_VERSION, validBusinessEmail, type RecData,
} from "./rec-onboarding.core";

export type RecSignApp = {
  id: string; status: string; data: unknown; insurance_certificate_path: string | null; created_at: string;
  test_mode?: boolean | null; allow_incomplete_sign?: boolean | null;
};
export type RecSignInput = {
  signer_name: string; signer_position: string; signer_email: string;
  acknowledgements: Record<string, boolean>; agreement_version: string;
};
export type RecSignDeps = {
  sha256: (s: string) => Promise<string>;
  /** Insert the office-review enquiry. Returns null on a unique conflict (an earlier attempt already created it). */
  insertEnquiry: (row: Record<string, unknown>) => Promise<{ id: string } | null>;
  findEnquiry: (submissionId: string) => Promise<{ id: string } | null>;
  /** Draft -> submitted, conditional on status still being draft. Returns true only when a row changed. */
  markSigned: (appId: string, fields: Record<string, unknown>) => Promise<boolean>;
  currentStatus: (appId: string) => Promise<string | null>;
  deleteEnquiry: (id: string) => Promise<void>;
};

export const recSubmissionId = (appId: string) => `portal-rec-onboarding-${appId}`;

/** Every server-side reason this application cannot be signed, in check order. Never relaxed for role, licence, services or review. */
export function recSignBlocker(app: RecSignApp, input: RecSignInput, now = new Date()): string | null {
  if (app.status !== "draft") return "This application has already been signed.";
  if (input.agreement_version !== REC_AGREEMENT_VERSION) return "The agreement has been updated. Please reload and review it again.";
  if (input.signer_name.trim().length < 2 || input.signer_position.trim().length < 2) return "Enter the signer's name and position.";
  if (!validBusinessEmail(input.signer_email)) return "Enter a real business email for the signer.";
  const d: RecData = { ...(app.data as RecData), insurance_uploaded: !!app.insurance_certificate_path };
  if (d.works_under_rec !== false) return "Staff join Home Insulation Victoria by private invitation from your REC business.";
  for (const a of acknowledgementsFor(d)) if (input.acknowledgements[a.key] !== true) return "Tick every acknowledgement to sign.";
  if (d.contact_is_licensed_electrician !== true || !(d.licence_number ?? "").trim()) return 'Please confirm you are a licensed electrician and enter your licence number on the "About you" step before signing.';
  const relax = mayRelaxRequiredSteps({ test_mode: !!app.test_mode, allow_incomplete_sign: app.allow_incomplete_sign ?? null });
  const missing = blockedMandatoryStep("sign", d, now) ?? (relax ? null : firstIncompleteStep(d, now));
  if (missing) return `Please complete the "${missing.replace(/_/g, " ")}" step before signing.`;
  return null;
}

export async function performRecSign(app: RecSignApp, input: RecSignInput, meta: { ip: string | null; userAgent: string | null }, deps: RecSignDeps, now = new Date()) {
  const blocker = recSignBlocker(app, input, now);
  if (blocker) throw new Error(blocker);
  const d: RecData = { ...(app.data as RecData), insurance_uploaded: !!app.insurance_certificate_path };
  const text = agreementText(d);
  const signedAt = now.toISOString();
  const ackList = acknowledgementsFor(d);
  const acks = Object.fromEntries(ackList.map((a) => [a.key, { text: a.text, accepted: true }]));
  const hash = await deps.sha256(text);
  const submissionId = recSubmissionId(app.id);
  const services = ["assessment_piesa", "rectification", "installation_attendance"];

  let created = true;
  let pe = await deps.insertEnquiry({
    source_system: "portal_form", enquiry_type: "electrician_rec", submission_id: submissionId,
    source: app.test_mode ? "portal_rec_onboarding_test" : "portal_rec_onboarding", name: d.primary_contact_name ?? null, email: d.business_email ?? null, phone: d.business_phone ?? null,
    company: d.trading_name || d.legal_entity_name || null, service_areas: [d.service_origin, d.travel_radius_km === 9999 ? "Anywhere in Victoria" : `${d.travel_radius_km} km radius`].filter(Boolean) as string[],
    rec_registration_number: (d.rec_registration_number ?? "").toUpperCase(), esv_licensed_electricians_confirmed: effectiveElectricians(d).length > 0,
    services, estimated_piesa_fee_inc_gst: d.assessment_rate ?? null, booking_lead_time: d.normal_attendance_speed ?? null, weekly_capacity: d.capacity_band ?? null,
    source_created_at: app.created_at, source_updated_at: signedAt,
    raw_payload: { rec_onboarding_id: app.id, agreement_version: REC_AGREEMENT_VERSION, agreement_sha256: hash, signed_at: signedAt, signer: { name: input.signer_name.trim(), position: input.signer_position.trim(), email: input.signer_email.trim() } },
  });
  if (!pe) { created = false; pe = await deps.findEnquiry(submissionId); }
  if (!pe) throw new Error("Could not submit your application. Please try again.");

  let changed = false;
  try {
    changed = await deps.markSigned(app.id, {
      status: "submitted", step_key: "sign", agreement_version: REC_AGREEMENT_VERSION, agreement_title: REC_AGREEMENT_TITLE,
      agreement_text: text, agreement_sha256: hash, acknowledgements: acks,
      signer_name: input.signer_name.trim(), signer_position: input.signer_position.trim(), signer_email: input.signer_email.trim().toLowerCase(),
      signed_at: signedAt, signed_ip: meta.ip, signed_user_agent: meta.userAgent, partner_enquiry_id: pe.id,
    });
  } catch { changed = false; }
  if (!changed) {
    const status = await deps.currentStatus(app.id).catch(() => null);
    if (status && status !== "draft") throw new Error("This application has already been signed.");
    if (created) await deps.deleteEnquiry(pe.id).catch(() => undefined); // a retry re-uses any row left behind
    throw new Error("Could not record your signature. Please try again.");
  }
  return { ok: true as const, signed_at: signedAt, agreement_sha256: hash };
}
