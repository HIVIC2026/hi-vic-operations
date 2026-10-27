// Pure orchestration of REC agreement signing. All I/O is injected so the
// validation order, idempotence and failure rollback can be tested without a database.
import { mayRelaxRequiredSteps } from "./onboarding-security.core";
import {
  acknowledgementsFor, agreementText, blockedMandatoryStep, effectiveElectricians, firstIncompleteStep,
  melbourneToday, REC_AGREEMENT_TITLE, REC_AGREEMENT_VERSION, validBusinessEmail, validCalendarDate, type RecData,
} from "./rec-onboarding.core";

export type RecSignApp = {
  id: string; status: string; data: unknown; insurance_certificate_path: string | null; created_at: string; updated_at: string;
  test_mode?: boolean | null; allow_incomplete_sign?: boolean | null;
  agreement_sha256?: string | null; partner_enquiry_id?: string | null;
};
export type RecSignInput = {
  signer_name: string; signer_position: string; signer_email: string;
  acknowledgements: Record<string, boolean>; agreement_version: string;
  /** Draft revision this tab last loaded/saved, and the hash of the agreement text it reviewed. */
  expected_updated_at: string; agreement_sha256: string;
};
export type RecSignOutcome = { outcome: "signed" | "already_signed_same"; partner_enquiry_id: string; signed_at: string };
export type RecSignDeps = {
  sha256: (s: string) => Promise<string>;
  /** One database transaction (sign_rec_application): lock row, CAS revision, upsert enquiry, mark signed. Never deletes. */
  signAtomic: (args: { appId: string; expectedUpdatedAt: string; agreementSha256: string; enquiry: Record<string, unknown>; signed: Record<string, unknown> }) => Promise<RecSignOutcome>;
};
export const REC_STALE_MESSAGE = "Your application changed in another tab. Reload and review the agreement again before signing.";

export const recSubmissionId = (appId: string) => `portal-rec-onboarding-${appId}`;

/** Every server-side reason this application cannot be signed, in check order. Never relaxed for role, licence, services or review. */
export function recSignBlocker(app: RecSignApp, input: RecSignInput, now = new Date()): string | null {
  if (app.status !== "draft") return "This application has already been signed.";
  if (!input.expected_updated_at || !/^[a-f0-9]{64}$/.test(input.agreement_sha256 ?? "")) return "Please review the agreement again before signing.";
  if (input.agreement_version !== REC_AGREEMENT_VERSION) return "The agreement has been updated. Please reload and review it again.";
  if (input.signer_name.trim().length < 2 || input.signer_position.trim().length < 2) return "Enter the signer's name and position.";
  if (!validBusinessEmail(input.signer_email)) return "Enter a real business email for the signer.";
  const d: RecData = { ...(app.data as RecData), insurance_uploaded: !!app.insurance_certificate_path };
  if (d.works_under_rec !== false) return "Staff join Home Insulation Victoria by private invitation from your REC business.";
  for (const a of acknowledgementsFor(d)) if (input.acknowledgements[a.key] !== true) return "Tick every acknowledgement to sign.";
  if (d.contact_is_licensed_electrician !== true || !(d.licence_number ?? "").trim()) return 'Please confirm you are a licensed electrician and enter your licence number on the "About you" step before signing.';
  // Decision 415 (Jo 27 Oct 2026): a current licence expiry is required on the server too, never relaxed in test mode.
  if (!validCalendarDate(d.licence_expiry)) return "Please enter your electrical licence expiry date before signing.";
  if ((d.licence_expiry as string) < melbourneToday(now)) return "Your electrical licence has expired. Enter the new expiry date before signing.";
  const relax = mayRelaxRequiredSteps({ test_mode: !!app.test_mode, allow_incomplete_sign: app.allow_incomplete_sign ?? null });
  const missing = blockedMandatoryStep("sign", d, now) ?? (relax ? null : firstIncompleteStep(d, now));
  if (missing) return `Please complete the "${missing.replace(/_/g, " ")}" step before signing.`;
  return null;
}

export async function performRecSign(app: RecSignApp, input: RecSignInput, meta: { ip: string | null; userAgent: string | null }, deps: RecSignDeps, now = new Date()) {
  // A double-click or a response lost after commit must replay through the atomic RPC. The RPC returns
  // the original signature only when this exact reviewed hash already owns the submitted application.
  if (app.status !== "draft" && app.agreement_sha256 && app.partner_enquiry_id && input.agreement_sha256 === app.agreement_sha256) {
    const r = await deps.signAtomic({ appId: app.id, expectedUpdatedAt: app.updated_at, agreementSha256: app.agreement_sha256, enquiry: {}, signed: {} })
      .catch(() => { throw new Error("This application has already been signed."); });
    if (r.outcome !== "already_signed_same") throw new Error("This application has already been signed.");
    return { ok: true as const, outcome: r.outcome, signed_at: r.signed_at, agreement_sha256: app.agreement_sha256 };
  }
  const blocker = recSignBlocker(app, input, now);
  if (blocker) throw new Error(blocker);
  const d: RecData = { ...(app.data as RecData), insurance_uploaded: !!app.insurance_certificate_path };
  const text = agreementText(d);
  const hash = await deps.sha256(text);
  // The reviewed text and revision must be exactly what is signed; another tab's save cannot substitute terms.
  if (input.expected_updated_at !== app.updated_at || input.agreement_sha256 !== hash) throw new Error(REC_STALE_MESSAGE);
  const signedAt = now.toISOString();
  const acks = Object.fromEntries(acknowledgementsFor(d).map((a) => [a.key, { text: a.text, accepted: true }]));
  const submissionId = recSubmissionId(app.id);
  const signer = { name: input.signer_name.trim(), position: input.signer_position.trim(), email: input.signer_email.trim().toLowerCase() };
  const enquiry = {
    source_system: "portal_form", enquiry_type: "electrician_rec", submission_id: submissionId,
    source: app.test_mode ? "portal_rec_onboarding_test" : "portal_rec_onboarding", name: d.primary_contact_name ?? null, email: d.business_email ?? null, phone: d.business_phone ?? null,
    company: d.trading_name || d.legal_entity_name || null, service_areas: [d.service_origin, d.travel_radius_km === 9999 ? "Anywhere in Victoria" : `${d.travel_radius_km} km radius`].filter(Boolean) as string[],
    rec_registration_number: (d.rec_registration_number ?? "").toUpperCase(), esv_licensed_electricians_confirmed: effectiveElectricians(d).length > 0,
    services: ["assessment_piesa", "rectification", "installation_attendance"], estimated_piesa_fee_inc_gst: d.assessment_rate ?? null, estimated_return_visit_fee_inc_gst: d.installation_attendance_rate ?? null, booking_lead_time: d.normal_attendance_speed ?? null,
    source_created_at: app.created_at, source_updated_at: signedAt,
    raw_payload: { rec_onboarding_id: app.id, agreement_version: REC_AGREEMENT_VERSION, agreement_sha256: hash, signed_at: signedAt, signer },
  };
  const signed = {
    agreement_version: REC_AGREEMENT_VERSION, agreement_title: REC_AGREEMENT_TITLE, agreement_text: text, agreement_sha256: hash, acknowledgements: acks,
    signer_name: signer.name, signer_position: signer.position, signer_email: signer.email,
    signed_at: signedAt, signed_ip: meta.ip, signed_user_agent: meta.userAgent,
  };
  let r: RecSignOutcome;
  try {
    r = await deps.signAtomic({ appId: app.id, expectedUpdatedAt: app.updated_at, agreementSha256: hash, enquiry, signed });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (m.includes("rec_sign:stale")) throw new Error(REC_STALE_MESSAGE);
    if (m.includes("rec_sign:already_signed")) throw new Error("This application has already been signed.");
    throw new Error("Could not record your signature. Please try again.");
  }
  return { ok: true as const, outcome: r.outcome, signed_at: r.signed_at, agreement_sha256: hash };
}

export type RecSignRecoveryDeps = {
  load: () => Promise<{ status: string; updated_at: string | null }>;
  sign: (expectedUpdatedAt: string, sha256: string) => Promise<{ outcome: string; signed_at: string }>;
};

/** Reconcile one lost signing response without changing, re-saving or re-reviewing the REC draft. */
export async function signRecWithRecovery(expectedUpdatedAt: string, reviewedSha: string, deps: RecSignRecoveryDeps) {
  try {
    return await deps.sign(expectedUpdatedAt, reviewedSha);
  } catch (error) {
    const after = await deps.load();
    if (after.status !== "draft") return deps.sign(after.updated_at ?? new Date(0).toISOString(), reviewedSha);
    throw error;
  }
}
