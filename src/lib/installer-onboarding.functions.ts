// Public installer onboarding (mirrors rec-onboarding.functions.ts) server functions. Access is by an opaque resume token (only its
// SHA-256 is stored). Drafts are editable; once signed the record is immutable (DB trigger).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withRequestMeta, withStartLimitStatus, withVisitorId } from "./request-meta";
import { mayRelaxRequiredSteps } from "./onboarding-security.core";
import {
  INSTALLER_AGREEMENT_TITLE, INSTALLER_AGREEMENT_VERSION, agreementText, applyMaterialReset, isInstallerRevisionTimestamp, normaliseInstallerDraft, type InstData,
} from "./installer-onboarding.core";
import { performInstallerSign, signedData } from "./installer-sign.core";
import { stampOnboardingNoticeAcks } from "./esc-collection-notice.core";

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
  // Office send-back: the same link opens the reopened draft (answers kept); a decline is shown, never hidden.
  const { resolveReviewedApp } = await import("./application-review.server");
  const r = await resolveReviewedApp(data, async (id) => (await db.from("rec_onboarding_applications").select("*").eq("id", id).maybeSingle()).data);
  return { db, app: r.app, review: r.review, officeMessage: r.officeMessage };
}

// Loose schema: drafts may be partial; strict checks happen in stepErrors on submit.
const s = (m: number) => z.string().max(m).optional();
const n = z.number().finite().min(0).max(1_000_000_000).nullable().optional();
const coord = z.number().finite().min(-90).max(180).nullable().optional();
const address = z.object({ label: z.string().max(300), street: s(300).nullable(), suburb: s(100).nullable(), postcode: s(10).nullable(), state: s(30).nullable(), country: z.literal("AU"), latitude: coord, longitude: coord, provider: z.literal("google_places_au") });
const dataSchema = z.object({
  business_address_details: address.nullable().optional(), service_origin_details: address.nullable().optional(),
  legal_entity_name: s(200), trading_name: s(200), abn: s(20), cii_status: s(20), cii_details: s(1000),
  business_address: s(300), primary_contact_name: s(200), business_phone: s(30), business_email: s(320), authorised_to_register: z.boolean().optional(), works_for_business: z.boolean().nullable().optional(),
  insurer: s(200), insurance_policy_number: s(100), public_liability_cover_amount: n, public_liability_expiry: s(10),
  installers: z.array(z.object({ full_legal_name: s(200), qualification: s(300), mobile: s(30), email: s(320), cii_holds: z.enum(["held", "in_training", "not_held"]).nullable().optional(), cii_certificate_number: s(80), cii_issuer: s(200), cii_issue_date: s(10), cii_level: z.enum(["full", "provisional"]).nullable().optional(), cii_expiry: s(10), is_self: z.boolean().optional(), piisa_done: z.enum(["yes", "no"]).nullable().optional(), piisa_date: s(10), piisa_uploaded: z.boolean().optional(), white_card_uploaded: z.boolean().optional(),
    // ESC collection notice: only the tick is taken from the browser; esc_notice_ack is re-stamped server-side (stampOnboardingNoticeAcks).
    esc_notice_ticked: z.boolean().optional(), esc_notice_ack: z.object({ at: z.string().max(40), by_name: z.string().max(200), kind: z.enum(["acknowledged", "given"]), notice_version: z.string().max(20), notice_sha256: z.string().max(64) }).nullable().optional() })).max(50).optional(),
  self_is_installer: z.boolean().nullable().optional(),
  service_batts_removal: z.boolean().optional(), service_loose_fill_removal: z.boolean().optional(), wants_hivic_leads: z.boolean().nullable().optional(), free_quotes_for_hivic_leads: z.boolean().nullable().optional(), free_measureups_for_hivic_quote_leads: z.boolean().nullable().optional(),
  service_origin: s(300), travel_radius_km: n, excluded_areas: s(2000),
  typical_days: z.array(z.enum(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])).max(7).optional(), normal_attendance_speed: s(50),
  capacity_band: s(10), daily_capacity_m2: z.number().positive().max(10000).nullable().optional(), accepting_jobs: z.boolean().optional(),
  gst_registered: z.boolean().nullable().optional(), r5_rate: n, r6_rate: n, r7_rate: n, topup_r5_rate: n, vacuum_only_rate: n, batts_removal_rate: n, loose_fill_removal_rate: n,
  extra_rates: z.record(z.string().max(40), n).optional(),
  bank_account_name: s(200), bank_bsb: s(7), bank_account_number: s(10),
  agreement_reviewed: z.boolean().optional(),
  how_it_works_acknowledged: z.boolean().optional(),
  electrician_choice: z.enum(["have", "match", "later"]).nullable().optional(),
  preferred_electricians: z.array(z.object({ name: s(200), email: s(320), mobile: s(30), business_name: s(200), licence_number: s(50), rec_number: s(50), is_primary: z.boolean().optional() })).max(5).optional(),
  electrician_contact_consent: z.boolean().optional(),
}).strict();

/** Applicants see only "uploaded"; certificate paths stay server-side in data.piisa_files / data.white_card_files (keyed by lower-case email). */
function piisaView(d: InstData & { piisa_files?: Record<string, string>; white_card_files?: Record<string, string> }, insurance: boolean) {
  const { piisa_files: files = {}, white_card_files: cards = {}, ...rest } = d;
  return { ...rest, insurance_uploaded: insurance, installers: (rest.installers ?? []).map((x) => { const k = (x.email ?? "").trim().toLowerCase(); return { ...x, piisa_uploaded: !!files[k], white_card_uploaded: !!cards[k] }; }) } as InstData;
}

function publicView(app: { status: string; step_key: string | null; data: unknown; insurance_certificate_path: string | null; signed_at: string | null; agreement_version: string | null; test_mode?: boolean | null }) {
  const relaxed = mayRelaxRequiredSteps({ test_mode: !!app.test_mode, allow_incomplete_sign: (app as { allow_incomplete_sign?: boolean | null }).allow_incomplete_sign ?? null });
  return { status: app.status, step_key: app.step_key, data: piisaView(app.data as InstData & { piisa_files?: Record<string, string> }, !!app.insurance_certificate_path), signed_at: app.signed_at, agreement_version: app.agreement_version, updated_at: (app as { updated_at?: string }).updated_at ?? null, test_mode: !!app.test_mode, relaxed };
}

// Public start: browser-supplied random resume token (replay-safe) plus optional staff link; never a test flag.
export const startInstallerOnboarding = createServerFn({ method: "POST" })
  .middleware([withRequestMeta, withVisitorId, withStartLimitStatus])
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
    if (!auth) await sec.consumeStart(db as never, context.visitorId, context.edgeIp, "installer");
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
  .handler(async ({ data }) => { const f = await findApp(data.token); return { ...publicView(f.app), review: f.review, office_message: f.officeMessage }; });

export const saveInstallerOnboarding = createServerFn({ method: "POST" })
  .middleware([withStartLimitStatus])
  .inputValidator((d) => z.object({ token: tokenSchema, step_key: z.string().max(40), data: dataSchema, base_updated_at: z.string().max(40).refine(isInstallerRevisionTimestamp) }).parse(d))
  .handler(async ({ data }) => {
    const { db, app } = await findApp(data.token);
    if (app.status !== "draft") throw new Error("This application has already been signed and submitted.");
    // Compare-and-swap: a save from a tab holding an older revision never overwrites newer answers.
    if (Date.parse(data.base_updated_at) !== Date.parse(app.updated_at)) throw new Error("Your application changed in another tab. Reload to continue.");
    const prevFiles = (app.data as { piisa_files?: Record<string, string> } | null)?.piisa_files;
    const prevCards = (app.data as { white_card_files?: Record<string, string> } | null)?.white_card_files;
    // The ESC notice record is stamped here (never trusted from the browser) before the material-change check, so an unchanged
    // echo of the stamp does not reset the agreement review.
    const prevData = app.data as InstData;
    const incoming = { ...(data.data as InstData), installers: stampOnboardingNoticeAcks(prevData.installers, (data.data as InstData).installers) };
    const next = { ...normaliseInstallerDraft(applyMaterialReset(prevData, incoming)), piisa_files: prevFiles ?? {}, ...(prevCards ? { white_card_files: prevCards } : {}) } as InstData;
    // The "uploaded" ticks are never trusted from the browser; they are derived from piisa_files / white_card_files.
    next.installers = (next.installers ?? []).map(({ piisa_uploaded: _p, white_card_uploaded: _w, ...x }) => x);
    const sec = await import("./onboarding-security.server");
    const contact = app.test_mode ? null : await sec.contactHash(next, "installer");
    if (!(app as { authorisation_id?: string | null }).authorisation_id) await sec.enforceContactCap(db as never, app.id, "installer", contact); // office/test links are staff-cleared
    const { data: row, error } = await db.from("rec_onboarding_applications").update({ data: next as never, step_key: data.step_key, ...(contact ? { contact_hash: contact } : {}) } as never).eq("id", app.id).eq("status", "draft").eq("updated_at", app.updated_at).select("*").maybeSingle();
    if (error) throw new Error("Could not save your progress. Please try again.");
    if (!row) throw new Error("Your application changed in another tab. Reload to continue.");
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
  .inputValidator((d) => z.object({ token: tokenSchema, path: z.string().max(300), content_type: z.enum(["application/pdf", "image/jpeg", "image/png"]), base_updated_at: z.string().max(40).refine(isInstallerRevisionTimestamp) }).parse(d))
  .handler(async ({ data }) => {
    const { db, app } = await findApp(data.token);
    if (app.status !== "draft") throw new Error("Already submitted.");
    const sec = await import("./onboarding-security.server");
    // Revision-aware: the tab's own upload advances the revision it holds; another tab's edit is still refused.
    if (Date.parse(data.base_updated_at) !== Date.parse(app.updated_at)) throw new Error(sec.UPLOAD_STALE_MESSAGE);
    const done = await sec.verifyAndPromote(db as never, "installer-onboarding", app.id, data.path, data.content_type, app.updated_at);
    return { ok: true, updated_at: done.updated_at };
  });

// PIISA certificate (per installer): same quarantine + byte checks as insurance; path kept server-side.
export const installerPiisaUploadUrl = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema, content_type: z.enum(["application/pdf", "image/jpeg", "image/png"]), size: z.number().int().min(1).max(10 * 1024 * 1024), filename: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { db, app } = await findApp(data.token);
    if (app.status !== "draft") throw new Error("Already submitted.");
    const { safeOriginalName } = await import("./onboarding-security.core");
    if (!safeOriginalName(data.filename)) throw new Error("Please upload a single PDF, PNG or JPEG file.");
    const sec = await import("./onboarding-security.server");
    return sec.quarantineSlot(db as never, "installer-onboarding", app.id);
  });

export const confirmInstallerPiisaUpload = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema, path: z.string().max(300), content_type: z.enum(["application/pdf", "image/jpeg", "image/png"]), email: z.string().trim().toLowerCase().email().max(320), base_updated_at: z.string().max(40).refine(isInstallerRevisionTimestamp) }).parse(d))
  .handler(async ({ data }) => {
    const { db, app } = await findApp(data.token);
    if (app.status !== "draft") throw new Error("Already submitted.");
    const sec = await import("./onboarding-security.server");
    if (Date.parse(data.base_updated_at) !== Date.parse(app.updated_at)) throw new Error(sec.UPLOAD_STALE_MESSAGE);
    const d = app.data as InstData & { piisa_files?: Record<string, string> };
    // Keyed by the installer's email (validated above) within this token's own draft, so it can be uploaded before the page is saved;
    // page validation only accepts it once a saved installer row carries that same email.
    const { finalPath } = await sec.verifyAndStoreDoc(db as never, "installer-onboarding", app.id, data.path, data.content_type, "piisa");
    const next = { ...d, piisa_files: { ...(d.piisa_files ?? {}), [data.email]: finalPath } };
    const { data: row } = await db.from("rec_onboarding_applications").update({ data: next as never } as never).eq("id", app.id).eq("status", "draft").eq("updated_at", app.updated_at).select("updated_at").maybeSingle();
    if (!row) { await db.storage.from("partner-files").remove([finalPath]); throw new Error(sec.UPLOAD_STALE_MESSAGE); }
    return { ok: true, updated_at: String((row as { updated_at: string }).updated_at) };
  });

// White Card (decision 319, per installer person, optional at onboarding): same quarantine + byte checks as PIISA; path kept
// server-side in data.white_card_files and carried onto the person's staff row at activation for the office to verify.
export const installerWhiteCardUploadUrl = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema, content_type: z.enum(["application/pdf", "image/jpeg", "image/png"]), size: z.number().int().min(1).max(10 * 1024 * 1024), filename: z.string().max(200) }).parse(d))
  .handler(async ({ data }) => {
    const { db, app } = await findApp(data.token);
    if (app.status !== "draft") throw new Error("Already submitted.");
    const { safeOriginalName } = await import("./onboarding-security.core");
    if (!safeOriginalName(data.filename)) throw new Error("Please upload a single PDF, PNG or JPEG file.");
    const sec = await import("./onboarding-security.server");
    return sec.quarantineSlot(db as never, "installer-onboarding", app.id);
  });

export const confirmInstallerWhiteCardUpload = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema, path: z.string().max(300), content_type: z.enum(["application/pdf", "image/jpeg", "image/png"]), email: z.string().trim().toLowerCase().email().max(320), base_updated_at: z.string().max(40).refine(isInstallerRevisionTimestamp) }).parse(d))
  .handler(async ({ data }) => {
    const { db, app } = await findApp(data.token);
    if (app.status !== "draft") throw new Error("Already submitted.");
    const sec = await import("./onboarding-security.server");
    if (Date.parse(data.base_updated_at) !== Date.parse(app.updated_at)) throw new Error(sec.UPLOAD_STALE_MESSAGE);
    const d = app.data as InstData & { white_card_files?: Record<string, string> };
    const { finalPath } = await sec.verifyAndStoreDoc(db as never, "installer-onboarding", app.id, data.path, data.content_type, "white-card");
    const next = { ...d, white_card_files: { ...(d.white_card_files ?? {}), [data.email]: finalPath } };
    const { data: row } = await db.from("rec_onboarding_applications").update({ data: next as never } as never).eq("id", app.id).eq("status", "draft").eq("updated_at", app.updated_at).select("updated_at").maybeSingle();
    if (!row) { await db.storage.from("partner-files").remove([finalPath]); throw new Error(sec.UPLOAD_STALE_MESSAGE); }
    return { ok: true, updated_at: String((row as { updated_at: string }).updated_at) };
  });

export const getInstallerAgreement = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: tokenSchema }).parse(d))
  .handler(async ({ data }) => {
    const { app } = await findApp(data.token);
    const text = app.agreement_text ?? agreementText(signedData(app as never));
    // The tab keeps this exact revision + hash; signing is refused if either has moved on.
    return { title: INSTALLER_AGREEMENT_TITLE, version: INSTALLER_AGREEMENT_VERSION, text, sha256: await sha256(text), updated_at: app.updated_at };
  });

export const signInstallerAgreement = createServerFn({ method: "POST" })
  .middleware([withRequestMeta])
  .inputValidator((d) => z.object({
    token: tokenSchema,
    signer_name: z.string().trim().min(2).max(200),
    signer_position: z.string().trim().min(2).max(100),
    signer_email: z.string().trim().max(320),
    acknowledgements: z.record(z.string(), z.boolean()),
    agreement_version: z.string().max(80),
    expected_updated_at: z.string().max(40).refine(isInstallerRevisionTimestamp),
    agreement_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const { db, app } = await findApp(data.token);
    if (app.status === "draft") await (await import("./onboarding-security.server")).purgeQuarantine(db as never, "installer-onboarding", app.id);
    // Compare revisions as instants (PostgREST and the tab may format the same timestamp differently).
    const same = Date.parse(data.expected_updated_at) === Date.parse(app.updated_at);
    const { token: _t, ...input } = data;
    const signed = await performInstallerSign(app as never, { ...input, expected_updated_at: same ? app.updated_at : data.expected_updated_at }, { ip: context.ip, userAgent: context.userAgent }, {
      sha256,
      signAtomic: async (a) => {
        const { data: rows, error } = await db.rpc("sign_installer_application" as never, {
          _app_id: a.appId, _expected_updated_at: a.expectedUpdatedAt, _agreement_sha256: a.agreementSha256,
          _enquiry: a.enquiry, _signed: a.signed, _nominations: a.nominations,
        } as never);
        if (error) throw new Error(error.message);
        const r = (rows as unknown as { outcome: "signed" | "already_signed_same"; partner_enquiry_id: string; signed_at: string }[])[0];
        if (!r) throw new Error("installer_sign:no_result");
        return r;
      },
    });
    // I53 (decision 326): "We've got your application", once per application (best-effort; the 15-minute tick catches up a miss).
    if (signed.ok) await (await import("./trade-messages.server")).emailApplicationReceived((app as { id: string }).id).catch((e) => console.error("application received email skipped", (e as Error).message));
    return signed;
  });
