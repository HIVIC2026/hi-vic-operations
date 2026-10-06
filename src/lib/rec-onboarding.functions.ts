// Public REC onboarding server functions. Access is by an opaque resume token (only its
// SHA-256 is stored). Drafts are editable; once signed the record is immutable (DB trigger).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withRequestMeta, withStartLimitStatus, withVisitorId } from "./request-meta";
import { mayRelaxRequiredSteps } from "./onboarding-security.core";
import {
  REC_AGREEMENT_TITLE, REC_AGREEMENT_VERSION, agreementText, applyMaterialReset,
  blockedMandatoryStep, canonicalStepKey, REC_INVALID_LINK_MESSAGE, isRecRevisionTimestamp, type RecData,
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
  if (!data) throw new Error(REC_INVALID_LINK_MESSAGE);
  return { db, app: data };
}

// Loose schema: drafts may be partial; strict checks happen in stepErrors on submit.
const s = (m: number) => z.string().max(m).optional();
const n = z.number().finite().min(0).max(1_000_000_000).nullable().optional();
const latitude = z.number().finite().min(-90).max(90).nullable().optional();
const longitude = z.number().finite().min(-180).max(180).nullable().optional();
const address = z.object({ label: z.string().max(300), street: s(300).nullable(), suburb: s(100).nullable(), postcode: s(10).nullable(), state: s(30).nullable(), country: z.literal("AU"), latitude, longitude, provider: z.literal("google_places_au") });
const dataSchema = z.object({
  how_it_works_acknowledged: z.boolean().optional(),
  works_under_rec: z.boolean().nullable().optional(), host_rec_name: s(200), host_rec_number: s(50),
  legal_entity_name: s(200), trading_name: s(200), abn: s(20), rec_registration_number: s(50),
  business_address: s(300), business_address_details: address.nullable().optional(), primary_contact_name: s(200), business_phone: s(30), business_email: s(320), authorised_to_register: z.boolean().optional(),
  insurer: s(200), insurance_policy_number: s(100), public_liability_cover_amount: n, public_liability_expiry: s(10),
  electricians: z.array(z.object({ full_legal_name: s(200), licence_number: s(50), licence_expiry: s(10), mobile: s(30), email: s(320) })).max(30).optional(),
  service_piesa: z.boolean().optional(), service_rectification: z.boolean().optional(), service_installation_isolation: z.boolean().optional(), services_all_confirmed: z.boolean().optional(), contact_is_licensed_electrician: z.boolean().nullable().optional(), licence_number: s(50), licence_expiry: s(10),
  service_origin: s(300), service_origin_details: address.nullable().optional(), travel_radius_km: n, excluded_areas: s(2000),
  typical_days: z.array(z.string().max(3)).max(7).optional(), normal_attendance_speed: s(50),
  capacity_band: s(10), accepting_jobs: z.boolean().optional(),
  gst_registered: z.boolean().nullable().optional(), assessment_rate: n, installation_attendance_rate: n,
  rectification_rates: z.record(z.string().max(40), n).optional(),
  custom_rectification_rates: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{6,64}$/), description: z.string().max(120), unit: z.string().max(30), price: n })).max(20).optional(),
  coes_fee_choice: z.enum(["included", "separate", ""]).optional(), coes_fee: n,
  bank_account_name: s(200), bank_bsb: s(7), bank_account_number: s(10),
  agreement_reviewed: z.boolean().optional(),
}).strict();

function publicView(app: { status: string; step_key: string | null; data: unknown; insurance_certificate_path: string | null; signed_at: string | null; agreement_version: string | null; test_mode?: boolean; updated_at?: string | null }) {
  const relaxed = mayRelaxRequiredSteps({ test_mode: !!app.test_mode, allow_incomplete_sign: (app as { allow_incomplete_sign?: boolean | null }).allow_incomplete_sign ?? null });
  return { status: app.status, step_key: app.step_key, data: { ...(app.data as RecData), insurance_uploaded: !!app.insurance_certificate_path }, signed_at: app.signed_at, agreement_version: app.agreement_version, test_mode: !!app.test_mode, relaxed, updated_at: "updated_at" in app ? String(app.updated_at) : null };
}

// Public start. The browser supplies its own random resume token (so a replay returns the same draft)
// and, optionally, a staff-issued link token. It can never choose test mode itself (.strict()).
export const startRecOnboarding = createServerFn({ method: "POST" })
  .middleware([withRequestMeta, withVisitorId, withStartLimitStatus])
  .inputValidator((d) => z.object({ token: tokenSchema, staff_link: tokenSchema.optional() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const hash = await sha256(data.token);
    const { data: existing } = await db.from("rec_onboarding_applications").select("id, partner_type, status").eq("resume_token_hash", hash).maybeSingle();
    if (existing) {
      if (existing.partner_type !== "rec") throw new Error("Could not start onboarding. Please try again.");
      return { token: data.token, test_mode: false, relaxed: false };
    }
    const sec = await import("./onboarding-security.server");
    const auth = await sec.consumeAuthorisation(db as never, data.staff_link, "rec");
    if (!auth) await sec.consumeStart(db as never, context.visitorId, context.edgeIp, "rec");
    const qa = auth?.purpose === "qa_test";
    const { error } = await db.from("rec_onboarding_applications").insert({
      resume_token_hash: hash, step_key: "about", test_mode: qa,
      ...(auth ? { authorisation_id: auth.id, allow_incomplete_sign: qa && auth.allow_incomplete_sign } : {}),
    } as never);
    if (error) {
      if ((error as { code?: string }).code === "23505") return { token: data.token, test_mode: false, relaxed: false }; // parallel replay of the same start
      throw new Error("Could not start onboarding. Please try again.");
    }
    return { token: data.token, test_mode: qa, relaxed: qa && !!auth?.allow_incomplete_sign };
  });

export const loadRecOnboarding = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema }).parse(d))
  .handler(async ({ data }) => publicView((await findApp(data.token)).app));

export const saveRecOnboarding = createServerFn({ method: "POST" })
  .middleware([withStartLimitStatus])
  .inputValidator((d) => z.object({ token: tokenSchema, step_key: z.string().max(40), data: dataSchema, base_updated_at: z.string().refine(isRecRevisionTimestamp, "Invalid draft revision.").nullable().optional() }).parse(d))
  .handler(async ({ data }) => {
    const { db, app } = await findApp(data.token);
    if (app.status !== "draft") throw new Error("This application has already been signed and submitted.");
    const next = applyMaterialReset(app.data as RecData, data.data as RecData);
    if (blockedMandatoryStep(data.step_key, next)) throw new Error("Confirm your REC can provide all three electrical services.");
    const sec = await import("./onboarding-security.server");
    const contact = app.test_mode ? null : await sec.contactHash(next, "rec");
    if (!(app as { authorisation_id?: string | null }).authorisation_id) await sec.enforceContactCap(db as never, app.id, "rec", contact); // office/test links are staff-cleared
    let update = db.from("rec_onboarding_applications").update({ data: next as never, step_key: canonicalStepKey(data.step_key), ...(contact ? { contact_hash: contact } : {}) } as never).eq("id", app.id).eq("status", "draft");
    if (data.base_updated_at) update = update.eq("updated_at", data.base_updated_at);
    const { data: row, error } = await update.select("*").maybeSingle();
    if (!row && !error) throw new Error("Your application changed in another tab. Reload before saving again.");
    if (error) throw new Error("Could not save your progress. Please try again.");
    if (!row) throw new Error("Could not save your progress. Please try again.");
    return publicView(row);
  });

// Insurance certificate: upload lands in private quarantine; only server-verified bytes are promoted.
export const insuranceUploadUrl = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema, content_type: z.enum(["application/pdf", "image/jpeg", "image/png"]), size: z.number().int().min(1).max(10 * 1024 * 1024), filename: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { db, app } = await findApp(data.token);
    if (app.status !== "draft") throw new Error("Already submitted.");
    const { safeOriginalName } = await import("./onboarding-security.core");
    if (!safeOriginalName(data.filename)) throw new Error("Please upload a single PDF, PNG or JPEG file (for example certificate.pdf).");
    const sec = await import("./onboarding-security.server");
    return sec.quarantineSlot(db as never, "rec-onboarding", app.id);
  });

export const confirmInsuranceUpload = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema, path: z.string().max(300), content_type: z.enum(["application/pdf", "image/jpeg", "image/png"]) }).parse(d))
  .handler(async ({ data }) => {
    const { db, app } = await findApp(data.token);
    if (app.status !== "draft") throw new Error("Already submitted.");
    const sec = await import("./onboarding-security.server");
    const done = await sec.verifyAndPromote(db as never, "rec-onboarding", app.id, data.path, data.content_type);
    return { ok: true, updated_at: done.updated_at };
  });

export const getRecAgreement = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema }).parse(d))
  .handler(async ({ data }) => {
    const { app } = await findApp(data.token);
    const d = { ...(app.data as RecData), insurance_uploaded: !!app.insurance_certificate_path };
    const text = app.agreement_text ?? agreementText(d);
    return { title: REC_AGREEMENT_TITLE, version: REC_AGREEMENT_VERSION, text, sha256: await sha256(text), updated_at: String(app.updated_at) };
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
    expected_updated_at: z.string().refine(isRecRevisionTimestamp, "Invalid draft revision."),
    agreement_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { db, app } = await findApp(data.token);
    if (app.status === "draft") await (await import("./onboarding-security.server")).purgeQuarantine(db as never, "rec-onboarding", app.id);
    const { performRecSign } = await import("./rec-sign.core");
    const same = Date.parse(data.expected_updated_at) === Date.parse(app.updated_at);
    const { token: _token, ...input } = data;
    return performRecSign(app as never, { ...input, expected_updated_at: same ? app.updated_at : data.expected_updated_at }, { ip: context.ip, userAgent: context.userAgent }, {
      sha256,
      signAtomic: async ({ appId, expectedUpdatedAt, agreementSha256, enquiry, signed }) => {
        const { data: rows, error } = await db.rpc("sign_rec_application" as never, { _app_id: appId, _expected_updated_at: expectedUpdatedAt, _agreement_sha256: agreementSha256, _enquiry: enquiry, _signed: signed } as never);
        if (error) throw new Error((error as { message?: string }).message ?? "sign failed");
        const row = (rows as unknown as { outcome: "signed" | "already_signed_same"; partner_enquiry_id: string; signed_at: string }[] | null)?.[0];
        if (!row) throw new Error("sign failed");
        return row;
      },
    });
  });
