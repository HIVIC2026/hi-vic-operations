// Persistence for the tidy partner profile. Server-only.
import { WorkflowError } from "./workflow.server";
import { normaliseEmail, normaliseMobile, type AppMeta, type CiiCheck, type PartnerProfile } from "./partner-profile.core";

type AdminDb = typeof import("@/integrations/supabase/client.server").supabaseAdmin;

export async function loadProfileInputs(admin: AdminDb, applicationId: string) {
  const { data: app, error } = await admin.from("rec_onboarding_applications")
    .select("id, partner_type, status, test_mode, data, signer_name, signer_position, signer_email, agreement_version, signed_at, agreement_text, insurance_certificate_path").eq("id", applicationId).single();
  if (error || !app) throw new WorkflowError("Application not found.");
  const data = (app.data ?? {}) as Record<string, unknown>;
  const [{ data: certs }, { data: levels }, { data: mark }, { data: act }, { data: peers }] = await Promise.all([
    admin.from("partner_worker_certifications").select("id, worker_email, status, recorded_at").eq("application_id", applicationId).order("recorded_at", { ascending: false }),
    Promise.resolve({ data: [] as { certification_id: string; expires_on: string | null }[] }),
    admin.from("onboarding_test_marks").select("application_id").eq("application_id", applicationId).maybeSingle(),
    admin.from("partner_activations").select("business_id").eq("application_id", applicationId).maybeSingle(),
    admin.from("rec_onboarding_applications").select("id, partner_type, data").eq("status", "submitted").eq("test_mode", false),
  ]);
  const certIds = (certs ?? []).map((c) => c.id);
  const { data: levelRows } = certIds.length ? await admin.from("worker_certification_levels").select("certification_id, expires_on").in("certification_id", certIds) : { data: levels };
  const cii = new Map<string, CiiCheck>();
  for (const c of certs ?? []) {
    const email = (c.worker_email ?? "").toLowerCase();
    if (cii.has(email)) continue;
    cii.set(email, { status: c.status, expires_on: (levelRows ?? []).find((l) => l.certification_id === c.id)?.expires_on ?? null });
  }
  const { data: marks } = await admin.from("onboarding_test_marks").select("application_id");
  const tests = new Set((marks ?? []).map((m) => m.application_id));
  const real = (peers ?? []).filter((p) => !tests.has(p.id) && p.id !== applicationId);
  const n = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);
  const abn = String(data["abn"] ?? "").replace(/\D/g, "");
  let existingBusinessId: string | null = null; let existingCapabilities: string[] = [];
  if (abn) {
    const { data: biz } = await admin.from("businesses").select("id, abn, capabilities").not("abn", "is", null);
    const hit = (biz ?? []).find((b) => (b.abn ?? "").replace(/\D/g, "") === abn);
    if (hit) { existingBusinessId = hit.id; existingCapabilities = hit.capabilities ?? []; }
  }
  let approvalMessage: string | null = null;
  if (act?.business_id) {
    const { data: b } = await admin.from("businesses").select("approval_message_status").eq("id", act.business_id).maybeSingle();
    approvalMessage = b?.approval_message_status ?? null;
  }
  return {
    meta: app as unknown as AppMeta, data, cii, existingCapabilities, existingBusinessId,
    activatedBusinessId: act?.business_id ?? null, approvalMessage,
    isTest: !!app.test_mode || !!mark,
    peers: {
      r5: real.filter((p) => p.partner_type === "installer").map((p) => n((p.data as Record<string, unknown>)?.["r5_rate"])).filter((x): x is number => x != null),
      piesa: real.filter((p) => p.partner_type !== "installer").map((p) => n((p.data as Record<string, unknown>)?.["assessment_rate"])).filter((x): x is number => x != null),
    },
  };
}

/** Writes the tidy profile onto the ONE business row created/updated by activation. Idempotent; never sends anything. */
export async function applyPartnerProfile(admin: AdminDb, businessId: string, p: PartnerProfile, actor: string) {
  const { error } = await admin.from("businesses").update({
    legal_name: p.business.legal_name, trading_name: p.business.trading_name, abn: p.business.abn,
    email: p.business.email, phone: p.business.phone, address: p.business.address, base_suburb: p.business.base_suburb,
    coverage_lat: p.coverage.lat, coverage_lng: p.coverage.lng, coverage_radius_km: p.coverage.radius_km, covers_all_victoria: p.coverage.anywhere_in_victoria,
    public_liability_cover_amount: p.insurance.amount,
    ...(p.rates.free_quotes != null ? { free_quotes_for_hivic_leads: p.rates.free_quotes } : {}),
    signer_name: p.signer.name, signer_position: p.signer.position, signer_mobile: p.signer.mobile, signer_email: p.signer.email,
  }).eq("id", businessId);
  if (error) throw new WorkflowError(`Partner approved, but the tidy profile did not save: ${error.message}`);
  // Workers: lower-case emails and +61 mobiles.
  const { data: workers } = await admin.from("partner_workers").select("id, email, mobile").eq("business_id", businessId);
  for (const w of workers ?? []) {
    const email = normaliseEmail(w.email) ?? w.email; const mobile = normaliseMobile(w.mobile);
    if (email !== w.email || mobile !== w.mobile) await admin.from("partner_workers").update({ email, mobile }).eq("id", w.id);
  }
  // Licences: one row per kind + number (+ holder); never duplicated on re-approval. Office verification stays separate.
  const { data: existing } = await admin.from("business_credentials").select("kind, number, label").eq("business_id", businessId);
  const have = new Set((existing ?? []).map((c) => `${c.kind}|${c.number ?? ""}|${c.label}`));
  const KIND: Record<string, string> = { cii_certification: "installer_certification", esv_licence: "electrical_licence", rec_registration: "rec_registration" };
  const rows = p.licences.filter((l) => l.number && KIND[l.kind]).map((l) => ({
    business_id: businessId, kind: KIND[l.kind]!, label: l.holder ? `${l.label} — ${l.holder}` : l.label, number: l.number, issuer: l.issuer,
    expires_at: l.expires_at, critical: true, verification: l.verified ? "verified" : "pending", verified_by: l.verified ? actor : null, verified_at: l.verified ? new Date().toISOString() : null, created_by: actor,
  })).filter((r) => !have.has(`${r.kind}|${r.number ?? ""}|${r.label}`));
  if (rows.length) {
    const { error: cErr } = await admin.from("business_credentials").insert(rows);
    if (cErr) throw new WorkflowError(`Partner approved, but licences did not save: ${cErr.message}`);
  }
}

/** Marks the approval message as queued at activation. It is delivered as the approved welcome email when the office sends the
 *  partner login link (sendPartnerLoginLink / sendTestWelcome), which moves the status to "sent". Nothing else sends it. */
export async function queueApprovalMessage(admin: AdminDb, businessId: string) {
  await admin.from("businesses").update({ approval_message_status: "queued", approval_message_queued_at: new Date().toISOString() }).eq("id", businessId).is("approval_message_status", null);
}
