// Pure orchestration of installer agreement signing (mirrors rec-sign.core.ts). All I/O is injected so the
// validation order, exact-review check and atomic commit can be tested without a database.
import {
  ACKNOWLEDGEMENTS, INSTALLER_AGREEMENT_TITLE, INSTALLER_AGREEMENT_VERSION, INSTALLER_VISIBLE_PAGES,
  agreementText, firstIncompleteStep, normaliseInstallerDraft, type InstData,
} from "./installer-onboarding.core";
import { validBusinessEmail } from "./rec-onboarding.core";

export type InstallerSignApp = {
  id: string; status: string; data: unknown; insurance_certificate_path: string | null; created_at: string; updated_at: string;
  test_mode?: boolean | null; allow_incomplete_sign?: boolean | null;
};
export type InstallerSignInput = {
  signer_name: string; signer_position: string; signer_email: string;
  acknowledgements: Record<string, boolean>; agreement_version: string;
  /** Draft revision this tab last loaded/saved, and the hash of the exact agreement text it reviewed. */
  expected_updated_at: string; agreement_sha256: string;
};
export type InstallerSignOutcome = { outcome: "signed" | "already_signed_same"; partner_enquiry_id: string; signed_at: string };
export type InstallerSignDeps = {
  sha256: (s: string) => Promise<string>;
  /** One transaction (sign_installer_application): lock, CAS revision + hash, upsert enquiry, queue nominations, mark signed. Never deletes. */
  signAtomic: (args: { appId: string; expectedUpdatedAt: string; agreementSha256: string; enquiry: Record<string, unknown>; signed: Record<string, unknown>; nominations: Record<string, unknown>[] }) => Promise<InstallerSignOutcome>;
};
export const INSTALLER_STALE_MESSAGE = "Your application changed in another tab. Reload and review the agreement again before signing.";
export const installerSubmissionId = (appId: string) => `portal-installer-onboarding-${appId}`;

/** Every server-side reason this application cannot be signed. Review, staff branch and address checks are never relaxed by test mode. */
export function installerSignBlocker(app: InstallerSignApp, input: InstallerSignInput, now = new Date()): string | null {
  if (app.status !== "draft") return "This application has already been signed.";
  if (!input.expected_updated_at || !/^[a-f0-9]{64}$/.test(input.agreement_sha256 ?? "")) return "Please review the agreement again before signing.";
  if (input.agreement_version !== INSTALLER_AGREEMENT_VERSION) return "The agreement has been updated. Please reload and review it again.";
  if (input.signer_name.trim().length < 2 || input.signer_position.trim().length < 2) return "Enter the signer's name and position.";
  if (!validBusinessEmail(input.signer_email)) return "Enter a real business email for the signer.";
  const d = signedData(app);
  if (d.works_for_business !== false) return "Staff join Home Insulation Victoria by private invitation from your business.";
  for (const a of ACKNOWLEDGEMENTS) if (input.acknowledgements[a.key] !== true) return "Tick every acknowledgement to sign.";
  if (d.agreement_reviewed !== true) return "Please review the agreement before signing.";
  // Test applications may skip optional detail, but never review, services or the staff branch above.
  const relax = !!app.test_mode && app.allow_incomplete_sign === true;
  const missing = relax ? (["services"] as const).find(() => d.wants_hivic_leads === true && d.free_measureups_for_hivic_quote_leads !== true) ?? null : firstIncompleteStep(d, now);
  if (missing) return `Please complete the "${INSTALLER_VISIBLE_PAGES.find((p) => p.key === missing)?.title ?? missing}" page before signing.`;
  return null;
}

export const signedData = (app: Pick<InstallerSignApp, "data" | "insurance_certificate_path">): InstData =>
  normaliseInstallerDraft({ ...(app.data as InstData), insurance_uploaded: !!app.insurance_certificate_path });

export function installerEnquiry(app: InstallerSignApp, d: InstData, hash: string, signedAt: string, signer: { name: string; position: string; email: string }) {
  return {
    source_system: "portal_form", enquiry_type: "installer", submission_id: installerSubmissionId(app.id),
    source: app.test_mode ? "portal_installer_onboarding_test" : "portal_installer_onboarding", name: d.primary_contact_name ?? null, email: d.business_email ?? null, phone: d.business_phone ?? null,
    company: d.trading_name || d.legal_entity_name || null, service_areas: [d.service_origin, d.travel_radius_km === 9999 ? "Anywhere in Victoria" : `${d.travel_radius_km} km radius`].filter(Boolean) as string[],
    // Business-level certification is not claimed; per-person CII details are in the signed snapshot and verified by the office.
    cii_certification_status: null, cii_certification_details: null,
    // Removal is mandatory for every installer partner, so both removal services and prices always map.
    services: ["supply_install", "batts_removal", "loose_fill_removal"],
    estimated_r5_install_rate_per_sqm_inc_gst: d.r5_rate ?? null,
    estimated_batts_removal_rate_per_sqm_inc_gst: d.batts_removal_rate ?? null,
    estimated_loose_fill_removal_rate_per_sqm_inc_gst: d.loose_fill_removal_rate ?? null,
    free_quotes_for_hivic_leads: d.free_quotes_for_hivic_leads ?? null,
    free_measureups_for_hivic_quote_leads: d.free_measureups_for_hivic_quote_leads ?? null,
    booking_lead_time: d.normal_attendance_speed ?? null, weekly_capacity: d.capacity_band ?? null,
    source_created_at: app.created_at, source_updated_at: signedAt,
    raw_payload: {
      rec_onboarding_id: app.id, partner_type: "installer", gst_registered: d.gst_registered ?? null, wants_hivic_leads: d.wants_hivic_leads ?? null, accepting_jobs: d.accepting_jobs ?? null,
      typical_days: d.typical_days ?? [], installers: (d.installers ?? []).map((x) => ({ name: x.full_legal_name ?? null, email: (x.email ?? "").trim().toLowerCase(), cii_holds: x.cii_holds ?? null, cii_certificate_number: x.cii_certificate_number ?? null, cii_issuer: x.cii_issuer ?? null, cii_issue_date: x.cii_issue_date ?? null })),
      agreement_version: INSTALLER_AGREEMENT_VERSION, agreement_sha256: hash, signed_at: signedAt, signer,
    },
  };
}

export async function performInstallerSign(app: InstallerSignApp, input: InstallerSignInput, meta: { ip: string | null; userAgent: string | null }, deps: InstallerSignDeps, now = new Date()) {
  const blocker = installerSignBlocker(app, input, now);
  if (blocker) throw new Error(blocker);
  const d = signedData(app);
  const text = agreementText(d);
  const hash = await deps.sha256(text);
  if (input.expected_updated_at !== app.updated_at || input.agreement_sha256 !== hash) throw new Error(INSTALLER_STALE_MESSAGE);
  const signedAt = now.toISOString();
  const signer = { name: input.signer_name.trim(), position: input.signer_position.trim(), email: input.signer_email.trim().toLowerCase() };
  const acks = Object.fromEntries(ACKNOWLEDGEMENTS.map((a) => [a.key, { text: a.text, accepted: true }]));
  const signed = {
    agreement_version: INSTALLER_AGREEMENT_VERSION, agreement_title: INSTALLER_AGREEMENT_TITLE, agreement_text: text, agreement_sha256: hash, acknowledgements: acks,
    signer_name: signer.name, signer_position: signer.position, signer_email: signer.email,
    signed_at: signedAt, signed_ip: meta.ip, signed_user_agent: meta.userAgent,
  };
  // Nominated electricians are queued in the same transaction; nothing is sent while communications are locked.
  const nominations = d.electrician_choice === "have" && d.electrician_contact_consent
    ? (d.preferred_electricians ?? []).filter((p) => p.email && p.name).map((p) => ({
      contact_name: p.name!.trim(), email: p.email!.trim().toLowerCase(), phone: p.mobile ?? null, business_name: p.business_name || null,
      licence_number: p.licence_number || null, rec_number: p.rec_number || null, is_primary: !!p.is_primary,
    }))
    : [];
  let r: InstallerSignOutcome;
  try {
    r = await deps.signAtomic({ appId: app.id, expectedUpdatedAt: app.updated_at, agreementSha256: hash, enquiry: installerEnquiry(app, d, hash, signedAt, signer), signed, nominations });
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    if (m.includes("installer_sign:stale")) throw new Error(INSTALLER_STALE_MESSAGE);
    if (m.includes("installer_sign:already_signed")) throw new Error("This application has already been signed.");
    throw new Error("Could not record your signature. Please try again.");
  }
  return { ok: true as const, outcome: r.outcome, signed_at: r.signed_at, agreement_sha256: hash };
}
