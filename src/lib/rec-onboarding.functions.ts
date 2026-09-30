// Public REC onboarding server functions. Access is by an opaque resume token (only its
// SHA-256 is stored). Drafts are editable; once signed the record is immutable (DB trigger).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withRequestMeta } from "./request-meta";
import {
  ACKNOWLEDGEMENTS, REC_AGREEMENT_TITLE, REC_AGREEMENT_VERSION, agreementText, applyMaterialReset,
  firstIncompleteStep, validBusinessEmail, type RecData,
} from "./rec-onboarding.core";

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
  const { data, error } = await db.from("rec_onboarding_applications").select("*").eq("resume_token_hash", await sha256(token)).eq("partner_type", "rec").maybeSingle();
  if (error) throw new Error("Could not load your application.");
  if (!data) throw new Error("This onboarding link is no longer valid. Please start again.");
  return { db, app: data };
}

// Loose schema: drafts may be partial; strict checks happen in stepErrors on submit.
const s = (m: number) => z.string().max(m).optional();
const n = z.number().finite().min(0).max(1_000_000_000).nullable().optional();
const dataSchema = z.object({
  legal_entity_name: s(200), trading_name: s(200), abn: s(20), rec_registration_number: s(50),
  business_address: s(300), primary_contact_name: s(200), business_phone: s(30), business_email: s(320), authorised_to_register: z.boolean().optional(),
  insurer: s(200), insurance_policy_number: s(100), public_liability_cover_amount: n, public_liability_expiry: s(10),
  electricians: z.array(z.object({ full_legal_name: s(200), licence_number: s(50), mobile: s(30), email: s(320) })).max(30).optional(),
  service_rectification: z.boolean().optional(), service_installation_isolation: z.boolean().optional(),
  service_origin: s(300), travel_radius_km: n, excluded_areas: s(2000),
  typical_days: z.array(z.string().max(3)).max(7).optional(), normal_attendance_speed: s(50),
  capacity_band: s(10), accepting_jobs: z.boolean().optional(),
  gst_registered: z.boolean().nullable().optional(), assessment_rate: n, installation_attendance_rate: n,
  rectification_rates: z.record(z.string().max(40), n).optional(),
  coes_fee_choice: z.enum(["included", "separate", ""]).optional(), coes_fee: n,
  agreement_reviewed: z.boolean().optional(),
}).strict();

function publicView(app: { status: string; step_key: string | null; data: unknown; insurance_certificate_path: string | null; signed_at: string | null; agreement_version: string | null }) {
  return { status: app.status, step_key: app.step_key, data: { ...(app.data as RecData), insurance_uploaded: !!app.insurance_certificate_path }, signed_at: app.signed_at, agreement_version: app.agreement_version };
}

export const startRecOnboarding = createServerFn({ method: "POST" }).handler(async () => {
  const token = newToken();
  const db = await admin();
  const { error } = await db.from("rec_onboarding_applications").insert({ resume_token_hash: await sha256(token), step_key: "business" });
  if (error) throw new Error("Could not start onboarding. Please try again.");
  return { token };
});

export const loadRecOnboarding = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema }).parse(d))
  .handler(async ({ data }) => publicView((await findApp(data.token)).app));

export const saveRecOnboarding = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema, step_key: z.string().max(40), data: dataSchema }).parse(d))
  .handler(async ({ data }) => {
    const { db, app } = await findApp(data.token);
    if (app.status !== "draft") throw new Error("This application has already been signed and submitted.");
    const next = applyMaterialReset(app.data as RecData, data.data as RecData);
    const { data: row, error } = await db.from("rec_onboarding_applications").update({ data: next as never, step_key: data.step_key }).eq("id", app.id).select("*").single();
    if (error) throw new Error("Could not save your progress. Please try again.");
    return publicView(row);
  });

const ALLOWED = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" } as const;
export const insuranceUploadUrl = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema, content_type: z.enum(["application/pdf", "image/jpeg", "image/png"]), size: z.number().int().min(1).max(20 * 1024 * 1024) }).parse(d))
  .handler(async ({ data }) => {
    const { db, app } = await findApp(data.token);
    if (app.status !== "draft") throw new Error("Already submitted.");
    const path = `rec-onboarding/${app.id}/insurance-${crypto.randomUUID()}.${ALLOWED[data.content_type]}`;
    const { data: signed, error } = await db.storage.from("partner-files").createSignedUploadUrl(path);
    if (error || !signed) throw new Error("Could not prepare the upload. Please try again.");
    return { path, token: signed.token };
  });

export const confirmInsuranceUpload = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema, path: z.string().max(300) }).parse(d))
  .handler(async ({ data }) => {
    const { db, app } = await findApp(data.token);
    if (app.status !== "draft") throw new Error("Already submitted.");
    const prefix = `rec-onboarding/${app.id}/`;
    if (!data.path.startsWith(prefix) || data.path.includes("..")) throw new Error("Invalid upload.");
    const name = data.path.slice(prefix.length);
    const { data: list } = await db.storage.from("partner-files").list(prefix.slice(0, -1), { search: name });
    if (!list?.some((f) => f.name === name)) throw new Error("Upload not found. Please try again.");
    await db.from("rec_onboarding_applications").update({ insurance_certificate_path: data.path }).eq("id", app.id);
    const { extractInsurance } = await import("./insurance-extract.server");
    const extracted = await extractInsurance(db as never, data.path);
    return { ok: true, extracted };
  });

export const getRecAgreement = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema }).parse(d))
  .handler(async ({ data }) => {
    const { app } = await findApp(data.token);
    const d = { ...(app.data as RecData), insurance_uploaded: !!app.insurance_certificate_path };
    return { title: REC_AGREEMENT_TITLE, version: REC_AGREEMENT_VERSION, text: app.agreement_text ?? agreementText(d) };
  });

export const signRecAgreement = createServerFn({ method: "POST" })
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
    if (data.agreement_version !== REC_AGREEMENT_VERSION) throw new Error("The agreement has been updated. Please reload and review it again.");
    if (!validBusinessEmail(data.signer_email)) throw new Error("Enter a real business email for the signer.");
    for (const a of ACKNOWLEDGEMENTS) if (data.acknowledgements[a.key] !== true) throw new Error("Tick every acknowledgement to sign.");
    const d: RecData = { ...(app.data as RecData), insurance_uploaded: !!app.insurance_certificate_path };
    const missing = firstIncompleteStep(d);
    if (missing) throw new Error(`Please complete the "${missing.replace(/_/g, " ")}" step before signing.`);

    const text = agreementText(d);
    const signedAt = new Date().toISOString();
    const acks = Object.fromEntries(ACKNOWLEDGEMENTS.map((a) => [a.key, { text: a.text, accepted: true }]));
    const hash = await sha256(text);

    // Partner enquiry row so the application appears in the existing admin review list.
    const services = ["assessment_piesa", d.service_rectification && "rectification", d.service_installation_isolation && "installation_attendance"].filter(Boolean) as string[];
    const { data: pe, error: peErr } = await db.from("partner_enquiries").insert({
      source_system: "portal_form", enquiry_type: "electrician_rec", submission_id: `portal-rec-onboarding-${app.id}`,
      source: "portal_rec_onboarding", name: d.primary_contact_name ?? null, email: d.business_email ?? null, phone: d.business_phone ?? null,
      company: d.trading_name || d.legal_entity_name || null, service_areas: [d.service_origin, d.travel_radius_km === 9999 ? "Anywhere in Victoria" : `${d.travel_radius_km} km radius`].filter(Boolean) as string[],
      rec_registration_number: (d.rec_registration_number ?? "").toUpperCase(), esv_licensed_electricians_confirmed: (d.electricians ?? []).length > 0,
      services, estimated_piesa_fee_inc_gst: d.assessment_rate ?? null, booking_lead_time: d.normal_attendance_speed ?? null, weekly_capacity: d.capacity_band ?? null,
      source_created_at: app.created_at, source_updated_at: signedAt,
      raw_payload: { rec_onboarding_id: app.id, agreement_version: REC_AGREEMENT_VERSION, agreement_sha256: hash, signed_at: signedAt, signer: { name: data.signer_name, position: data.signer_position, email: data.signer_email }, application: d } as never,
    }).select("id").single();
    if (peErr) throw new Error("Could not submit your application. Please try again.");

    const { error } = await db.from("rec_onboarding_applications").update({
      status: "submitted", step_key: "sign", agreement_version: REC_AGREEMENT_VERSION, agreement_title: REC_AGREEMENT_TITLE,
      agreement_text: text, agreement_sha256: hash, acknowledgements: acks as never,
      signer_name: data.signer_name, signer_position: data.signer_position, signer_email: data.signer_email.toLowerCase(),
      signed_at: signedAt, signed_ip: context.ip, signed_user_agent: context.userAgent, partner_enquiry_id: pe.id,
    }).eq("id", app.id).eq("status", "draft");
    if (error) {
      await db.from("partner_enquiries").delete().eq("id", pe.id);
      throw new Error("Could not record your signature. Please try again.");
    }
    return { ok: true as const, signed_at: signedAt, agreement_sha256: hash };
  });
