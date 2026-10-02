// Public installer onboarding (mirrors rec-onboarding.functions.ts) server functions. Access is by an opaque resume token (only its
// SHA-256 is stored). Drafts are editable; once signed the record is immutable (DB trigger).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withRequestMeta, withStartLimitStatus } from "./request-meta";
import { mayRelaxRequiredSteps } from "./onboarding-security.core";
import { validBusinessEmail } from "./rec-onboarding.core";
import {
  ACKNOWLEDGEMENTS, INSTALLER_AGREEMENT_TITLE, INSTALLER_AGREEMENT_VERSION, agreementText, applyMaterialReset,
  firstIncompleteStep, type InstData,
} from "./installer-onboarding.core";

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const tokenSchema = z.string().min(20).max(100).regex(/^[A-Za-z0-9_-]+$/);

async function admin() {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

async function findApp(token: string) {
  const db = await admin();
  const { data, error } = await db.from("rec_onboarding_applications").select("*").eq("resume_token_hash", await sha256(token)).eq("partner_type", "installer").maybeSingle();
  if (error) throw new Error("Could not load your application.");
  if (!data) throw new Error("This onboarding link is no longer valid. Please start again.");
  return { db, app: data };
}

// Loose schema: drafts may be partial; strict checks happen in stepErrors on submit.
const s = (m: number) => z.string().max(m).optional();
const n = z.number().finite().min(0).max(1_000_000_000).nullable().optional();
const dataSchema = z.object({
  legal_entity_name: s(200), trading_name: s(200), abn: s(20), cii_status: s(20), cii_details: s(1000),
  business_address: s(300), primary_contact_name: s(200), business_phone: s(30), business_email: s(320), authorised_to_register: z.boolean().optional(),
  insurer: s(200), insurance_policy_number: s(100), public_liability_cover_amount: n, public_liability_expiry: s(10),
  installers: z.array(z.object({ full_legal_name: s(200), qualification: s(300), mobile: s(30), email: s(320) })).max(50).optional(),
  service_batts_removal: z.boolean().optional(), service_loose_fill_removal: z.boolean().optional(), free_quotes_for_hivic_leads: z.boolean().nullable().optional(), free_measureups_for_hivic_quote_leads: z.boolean().nullable().optional(),
  service_origin: s(300), travel_radius_km: n, excluded_areas: s(2000),
  typical_days: z.array(z.string().max(3)).max(7).optional(), normal_attendance_speed: s(50),
  capacity_band: s(10), accepting_jobs: z.boolean().optional(),
  gst_registered: z.boolean().nullable().optional(), r5_rate: n, batts_removal_rate: n, loose_fill_removal_rate: n,
  extra_rates: z.record(z.string().max(40), n).optional(),
  bank_account_name: s(200), bank_bsb: s(7), bank_account_number: s(10),
  agreement_reviewed: z.boolean().optional(),
  how_it_works_acknowledged: z.boolean().optional(),
  electrician_choice: z.enum(["have", "match", "later"]).nullable().optional(),
  preferred_electricians: z.array(z.object({ name: s(200), email: s(320), mobile: s(30), business_name: s(200), licence_number: s(50), rec_number: s(50), is_primary: z.boolean().optional() })).max(5).optional(),
  electrician_contact_consent: z.boolean().optional(),
}).strict();

function publicView(app: { status: string; step_key: string | null; data: unknown; insurance_certificate_path: string | null; signed_at: string | null; agreement_version: string | null; test_mode?: boolean | null }) {
  const relaxed = mayRelaxRequiredSteps({ test_mode: !!app.test_mode, allow_incomplete_sign: (app as { allow_incomplete_sign?: boolean | null }).allow_incomplete_sign ?? null });
  return { status: app.status, step_key: app.step_key, data: { ...(app.data as InstData), insurance_uploaded: !!app.insurance_certificate_path }, signed_at: app.signed_at, agreement_version: app.agreement_version, test_mode: !!app.test_mode, relaxed };
}

// Public start: browser-supplied random resume token (replay-safe) plus optional staff link; never a test flag.
export const startInstallerOnboarding = createServerFn({ method: "POST" })
  .middleware([withRequestMeta, withStartLimitStatus])
  .inputValidator((d) => z.object({ token: tokenSchema, staff_link: tokenSchema.optional() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const hash = await sha256(data.token);
    const { data: existing } = await db.from("rec_onboarding_applications").select("id, partner_type").eq("resume_token_hash", hash).maybeSingle();
    if (existing) {
      if (existing.partner_type !== "installer") throw new Error("Could not start onboarding. Please try again.");
      return { token: data.token, test_mode: false, relaxed: false };
    }
    const sec = await import("./onboarding-security.server");
    const auth = await sec.consumeAuthorisation(db as never, data.staff_link, "installer");
    if (!auth) await sec.consumeStart(db as never, context.ip, context.userAgent, "installer");
    const qa = auth?.purpose === "qa_test";
    const { error } = await db.from("rec_onboarding_applications").insert({
      resume_token_hash: hash, step_key: "business", partner_type: "installer", test_mode: qa,
      ...(auth ? { authorisation_id: auth.id, allow_incomplete_sign: qa && auth.allow_incomplete_sign } : {}),
    } as never);
    if (error) {
      if ((error as { code?: string }).code === "23505") return { token: data.token, test_mode: false, relaxed: false };
      throw new Error("Could not start onboarding. Please try again.");
    }
    return { token: data.token, test_mode: qa, relaxed: qa && !!auth?.allow_incomplete_sign };
  });

export const loadInstallerOnboarding = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema }).parse(d))
  .handler(async ({ data }) => publicView((await findApp(data.token)).app));

export const saveInstallerOnboarding = createServerFn({ method: "POST" })
  .middleware([withStartLimitStatus])
  .inputValidator((d) => z.object({ token: tokenSchema, step_key: z.string().max(40), data: dataSchema }).parse(d))
  .handler(async ({ data }) => {
    const { db, app } = await findApp(data.token);
    if (app.status !== "draft") throw new Error("This application has already been signed and submitted.");
    const next = applyMaterialReset(app.data as InstData, data.data as InstData);
    const sec = await import("./onboarding-security.server");
    const contact = app.test_mode ? null : await sec.contactHash(next, "installer");
    await sec.enforceContactCap(db as never, app.id, "installer", contact);
    const { data: row, error } = await db.from("rec_onboarding_applications").update({ data: next as never, step_key: data.step_key, ...(contact ? { contact_hash: contact } : {}) } as never).eq("id", app.id).eq("status", "draft").select("*").single();
    if (error) throw new Error("Could not save your progress. Please try again.");
    return publicView(row);
  });

// Insurance certificate: quarantine upload, then server verification of the actual bytes.
export const installerInsuranceUploadUrl = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema, content_type: z.enum(["application/pdf", "image/jpeg", "image/png"]), size: z.number().int().min(1).max(10 * 1024 * 1024), filename: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { db, app } = await findApp(data.token);
    if (app.status !== "draft") throw new Error("Already submitted.");
    const { safeOriginalName } = await import("./onboarding-security.core");
    if (!safeOriginalName(data.filename)) throw new Error("Please upload a single PDF, PNG or JPEG file (for example certificate.pdf).");
    const sec = await import("./onboarding-security.server");
    return sec.quarantineSlot(db as never, "installer-onboarding", app.id);
  });

export const confirmInstallerInsuranceUpload = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema, path: z.string().max(300), content_type: z.enum(["application/pdf", "image/jpeg", "image/png"]) }).parse(d))
  .handler(async ({ data }) => {
    const { db, app } = await findApp(data.token);
    if (app.status !== "draft") throw new Error("Already submitted.");
    const sec = await import("./onboarding-security.server");
    const done = await sec.verifyAndPromote(db as never, "installer-onboarding", app.id, data.path, data.content_type);
    const { extractInsurance } = await import("./insurance-extract.server");
    const extracted = await extractInsurance(db as never, done.finalPath);
    return { ok: true, extracted };
  });

export const getInstallerAgreement = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema }).parse(d))
  .handler(async ({ data }) => {
    const { db, app } = await findApp(data.token);
    const d = { ...(app.data as InstData), insurance_uploaded: !!app.insurance_certificate_path };
    return { title: INSTALLER_AGREEMENT_TITLE, version: INSTALLER_AGREEMENT_VERSION, text: app.agreement_text ?? agreementText(d) };
  });

export const signInstallerAgreement = createServerFn({ method: "POST" })
  .middleware([withRequestMeta])
  .inputValidator((d) => z.object({
    token: tokenSchema,
    signer_name: z.string().trim().min(2).max(200),
    signer_position: z.string().trim().min(2).max(100),
    signer_email: z.string().trim().max(320),
    acknowledgements: z.record(z.string(), z.boolean()),
    agreement_version: z.string(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { db, app } = await findApp(data.token);
    if (app.status !== "draft") throw new Error("This application has already been signed.");
    if (data.agreement_version !== INSTALLER_AGREEMENT_VERSION) throw new Error("The agreement has been updated. Please reload and review it again.");
    if (!validBusinessEmail(data.signer_email)) throw new Error("Enter a real business email for the signer.");
    for (const a of ACKNOWLEDGEMENTS) if (data.acknowledgements[a.key] !== true) throw new Error("Tick every acknowledgement to sign.");
    const d: InstData = { ...(app.data as InstData), insurance_uploaded: !!app.insurance_certificate_path };
    // Test applications skip mandatory-field checks so staff can run the flow end to end.
    const relax = mayRelaxRequiredSteps({ test_mode: !!app.test_mode, allow_incomplete_sign: (app as { allow_incomplete_sign?: boolean | null }).allow_incomplete_sign ?? null });
    const missing = relax ? null : firstIncompleteStep(d);
    if (missing) throw new Error(`Please complete the "${missing.replace(/_/g, " ")}" step before signing.`);

    const text = agreementText(d);
    const signedAt = new Date().toISOString();
    const acks = Object.fromEntries(ACKNOWLEDGEMENTS.map((a) => [a.key, { text: a.text, accepted: true }]));
    const hash = await sha256(text);

    // Partner enquiry row so the application appears in the existing admin review list.
    const services = ["supply_install", d.service_batts_removal && "batts_removal", d.service_loose_fill_removal && "loose_fill_removal"].filter(Boolean) as string[];
    const { data: pe, error: peErr } = await db.from("partner_enquiries").insert({
      source_system: "portal_form", enquiry_type: "installer", submission_id: `portal-installer-onboarding-${app.id}`,
      source: app.test_mode ? "portal_installer_onboarding_test" : "portal_installer_onboarding", name: d.primary_contact_name ?? null, email: d.business_email ?? null, phone: d.business_phone ?? null,
      company: d.trading_name || d.legal_entity_name || null, service_areas: [d.service_origin, d.travel_radius_km === 9999 ? "Anywhere in Victoria" : `${d.travel_radius_km} km radius`].filter(Boolean) as string[],
      cii_certification_status: d.cii_status ?? null, cii_certification_details: d.cii_details ?? null,
      services, estimated_r5_install_rate_per_sqm_inc_gst: d.r5_rate ?? null,
      estimated_batts_removal_rate_per_sqm_inc_gst: d.service_batts_removal ? d.batts_removal_rate ?? null : null,
      estimated_loose_fill_removal_rate_per_sqm_inc_gst: d.service_loose_fill_removal ? d.loose_fill_removal_rate ?? null : null,
      free_quotes_for_hivic_leads: d.free_quotes_for_hivic_leads ?? null,
      free_measureups_for_hivic_quote_leads: d.free_measureups_for_hivic_quote_leads ?? null,
      booking_lead_time: d.normal_attendance_speed ?? null, weekly_capacity: d.capacity_band ?? null,
      source_created_at: app.created_at, source_updated_at: signedAt,
      raw_payload: { rec_onboarding_id: app.id, partner_type: "installer", agreement_version: INSTALLER_AGREEMENT_VERSION, agreement_sha256: hash, signed_at: signedAt, signer: { name: data.signer_name, position: data.signer_position, email: data.signer_email } } as never,
    }).select("id").single();
    if (peErr) throw new Error("Could not submit your application. Please try again.");

    const { error } = await db.from("rec_onboarding_applications").update({
      status: "submitted", step_key: "sign", agreement_version: INSTALLER_AGREEMENT_VERSION, agreement_title: INSTALLER_AGREEMENT_TITLE,
      agreement_text: text, agreement_sha256: hash, acknowledgements: acks as never,
      signer_name: data.signer_name, signer_position: data.signer_position, signer_email: data.signer_email.toLowerCase(),
      signed_at: signedAt, signed_ip: context.ip, signed_user_agent: context.userAgent, partner_enquiry_id: pe.id,
    }).eq("id", app.id).eq("status", "draft");
    if (error) {
      await db.from("partner_enquiries").delete().eq("id", pe.id);
      throw new Error("Could not record your signature. Please try again.");
    }
    // Preferred electricians are queued for an immediate invite on signing; the email goes out as soon as
    // communications are switched on (nothing is sent while they're locked). Idempotent per application+email.
    if (d.electrician_choice === "have" && d.electrician_contact_consent) {
      const rows = (d.preferred_electricians ?? []).filter((p) => p.email && p.name).map((p) => ({
        installer_application_id: app.id, nominated_for: "installer_team", contact_name: p.name!.trim(), email: p.email!.trim().toLowerCase(), phone: p.mobile ?? null,
        business_name: p.business_name || null, licence_number: p.licence_number || null, rec_number: p.rec_number || null, is_primary: !!p.is_primary,
        consent_confirmed_at: signedAt, status: "invite_pending_comms",
      }));
      for (const r of rows) {
        const { data: ex } = await db.from("electrician_nominations").select("id").eq("installer_application_id", app.id).is("job_id", null).ilike("email", r.email).maybeSingle();
        if (!ex) await db.from("electrician_nominations").insert(r);
      }
    }
    return { ok: true as const, signed_at: signedAt, agreement_sha256: hash };
  });
