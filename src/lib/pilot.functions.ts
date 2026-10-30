import { exactLike } from "./email-match";
// ReInsulate pilot server functions: partner onboarding, team, import, electrician choice,
// appointment coordination, partner offers, partner pricing, partner dashboard.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { withRequestMeta } from "./request-meta";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { electricianCandidates } from "./teaming.server";
import { WorkflowError, getStage, logEvent, requireAdmin, requireJobRole, transition } from "./workflow.server";
import {
  appointmentSla, bucketFor, confirmBlockers, electricianSelectionBlocker, extractFromCsvRow, extractFromText, mergeExtracted, offerBlocker,
  offerRespondBlocker, offerSummary, onboardingChecklist, parseCsv, partnerLineBlockers, planImportedMeasurement, proposalResponse, rankElectricians,
  relationshipOwnerFor, revisionBlocker, splitInvoicingBlocker, supplierTotal, verifiedServiceAreaMatch, type BusinessLike, type ConfirmedFacts, type ElecCandidate, type Extracted,
} from "./pilot.core";
import { loadBusiness, myBusinesses, requireApprovedPartner, requireMember, sha, sweepPartnerExpiry } from "./pilot.server";
import { signFile } from "./file-links.server";
import { inHouseEnableBlockers } from "./in-house.core";

const uuid = z.string().uuid();
const isAdmin = async (sb: { rpc: (n: "is_admin") => PromiseLike<{ data: unknown; error?: { message: string } | null }> }) => {
  const { data, error } = await sb.rpc("is_admin");
  if (error) throw new WorkflowError(`Could not check Office access: ${error.message}`);
  return data === true;
};
const txt = (n: number) => z.string().trim().max(n).nullish();

// ---------- Business file ----------
const businessInput = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(2).max(200), legal_name: txt(200), trading_name: txt(200), abn: txt(20), acn: txt(20), gst_registered: z.boolean().nullish(),
  business_type: z.enum(["eec_installer", "rec", "other"]).optional(), capabilities: z.array(z.enum(["installer", "electrician"])).max(2).optional(),
  email: txt(320), phone: txt(40), address: txt(300), contact_people: z.array(z.object({ name: z.string().max(200), role: z.string().max(100).optional(), phone: z.string().max(40).optional(), email: z.string().max(320).optional() })).max(20).optional(),
  service_postcodes: z.array(z.string().trim().max(6)).max(750).optional(), service_regions: z.array(z.string().trim().max(100)).max(100).optional(),
  verify_coverage: z.boolean().optional(),
  weekly_capacity: z.number().int().min(0).max(1000).nullish(), daily_capacity_m2: z.number().positive().max(10000).nullish(), lead_time_days: z.number().int().min(0).max(180).nullish(), availability_notes: txt(2000),
  daily_job_limit: z.number({ message: "Daily job limit must be a whole number." }).int("Daily job limit must be a whole number.").min(1, "Daily job limit must be 1 or more. Leave it empty for no limit.").max(50, "Daily job limit can be at most 50.").nullish(),
  rec_number: txt(50), licence_number: txt(50), installer_certification: z.record(z.string(), z.string().max(500)).optional(),
  branding: z.object({ logo_url: z.string().url().max(1000).optional(), colour: z.string().max(20).optional() }).optional(),
  default_comms_owner: z.enum(["installer", "hivic"]).optional(), commercial_route: z.enum(["hivic_full_invoice", "split_invoicing"]).optional(),
  in_house: z.boolean().optional(), rectification_billed_by: z.enum(["partner", "hivic"]).optional(),
});
const CRITICAL_FIELDS = ["legal_name", "abn", "acn", "rec_number", "licence_number", "business_type", "capabilities", "commercial_route"] as const;

export const saveBusiness = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => businessInput.parse(d))
  .handler(async ({ data, context }) => {
    const adminUser = await isAdmin(context.supabase);
    const sb = splitInvoicingBlocker(data.commercial_route);
    if (sb) throw new WorkflowError(sb);
    const { id, verify_coverage, ...patch } = data;
    if (patch.service_postcodes) {
      const invalid = patch.service_postcodes.filter((entry) => !/^3\d{3}$/.test(entry) && !/^3\d{0,2}\*$/.test(entry));
      if (invalid.length) throw new WorkflowError(`Invalid Victorian postcode coverage: ${invalid.join(", ")}`);
    }
    if (!id) {
      if (!adminUser) throw new WorkflowError("Only Home Insulation Victoria can create a partner business.");
      if (patch.in_house) throw new WorkflowError(inHouseEnableBlockers({ approvedElectricianWorkers: 0, hasActiveRateCardWithPiesa: false, mittiElectricianLogins: 0 }).join(" • "));
      const { data: row, error } = await admin.from("businesses").insert({ ...patch, business_type: patch.business_type ?? "eec_installer" } as never).select("id").single();
      if (error) throw new WorkflowError(error.message);
      return { id: row.id };
    }
    if (!adminUser) {
      await requireMember(context.userId, id, true);
      delete (patch as Record<string, unknown>)["commercial_route"]; // commercial route is Home Insulation Victoria-controlled
      delete patch.in_house;
      delete patch.rectification_billed_by;
    }
    // Trades manage their own diaries: capacity fields are no longer used or saved.
    delete (patch as Record<string, unknown>)["daily_job_limit"];
    delete (patch as Record<string, unknown>)["daily_capacity_m2"];
    delete (patch as Record<string, unknown>)["weekly_capacity"];
    const { data: before } = await admin.from("businesses").select("*").eq("id", id).single();
    if (!before) throw new WorkflowError("Business not found");
    const prior = before as unknown as { in_house?: boolean; rectification_billed_by?: "partner" | "hivic" };
    const configChanged = (patch.in_house !== undefined && patch.in_house !== (prior.in_house ?? false))
      || (patch.rectification_billed_by !== undefined && patch.rectification_billed_by !== (prior.rectification_billed_by ?? "hivic"));
    if (adminUser && patch.in_house === true && prior.in_house !== true) {
      const facts = await (await import("./installer-paid-electricians.server")).inHouseFactsFor(id);
      const blockers = inHouseEnableBlockers(facts);
      if (blockers.length) throw new WorkflowError(blockers.join(" • "));
    }
    const { in_house, rectification_billed_by, ...ordinaryPatch } = patch;
    const criticalChanged = CRITICAL_FIELDS.some((k) => k in patch && JSON.stringify((patch as Record<string, unknown>)[k]) !== JSON.stringify((before as Record<string, unknown>)[k]));
    const extra = !adminUser && criticalChanged && before.onboarding_status === "approved" ? { onboarding_status: "submitted", onboarding_notes: "Compliance details changed by partner – Home Insulation Victoria re-approval required" } : {};
    const coverageChanged = "service_postcodes" in patch && JSON.stringify(patch.service_postcodes ?? []) !== JSON.stringify(before.service_postcodes ?? []);
    const coverageStamp = adminUser && verify_coverage && (patch.service_postcodes?.length ?? before.service_postcodes?.length ?? 0) > 0
      ? { coverage_verified_at: new Date().toISOString(), coverage_verified_by: context.userId }
      : coverageChanged ? { coverage_verified_at: null, coverage_verified_by: null } : {};
    if (configChanged) {
      // Local RPC overlay for the pending migration; generated clients stay untouched.
      const configDb = admin as unknown as { rpc: (name: "save_in_house_partner", args: { p_business_id: string; p_in_house: boolean | null; p_rectification_billed_by: string | null; p_actor_id: string }) => PromiseLike<{ error: { message: string } | null }> };
      const { error: configError } = await configDb.rpc("save_in_house_partner", { p_business_id: id, p_in_house: in_house ?? null, p_rectification_billed_by: rectification_billed_by ?? null, p_actor_id: context.userId });
      if (configError) throw new WorkflowError(configError.message);
    }
    const { error } = await admin.from("businesses").update({ ...ordinaryPatch, ...extra, ...coverageStamp, updated_at: new Date().toISOString() } as never).eq("id", id);
    if (error) throw new WorkflowError(error.message);
    return { id, reapprovalRequired: !!Object.keys(extra).length };
  });

export const setOnboardingStatus = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid, status: z.enum(["draft", "submitted", "needs_info", "approved", "suspended", "expired"]), note: z.string().trim().max(2000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.status === "submitted") await requireMember(context.userId, data.businessId, true).catch(async () => requireAdmin(context.supabase));
    else await requireAdmin(context.supabase);
    const { business, credentials } = await loadBusiness(data.businessId);
    if (!business) throw new WorkflowError("Business not found");
    if (data.status === "approved") {
      const { count } = await admin.from("partner_agreements").select("id", { count: "exact", head: true }).eq("business_id", data.businessId);
      const missing = onboardingChecklist(business as BusinessLike, credentials, !!count).filter((i) => !i.done);
      if (missing.length) throw new WorkflowError(`Cannot approve yet: ${missing.map((m) => m.label).join(" • ")}`);
    }
    await admin.from("businesses").update({
      onboarding_status: data.status, onboarding_notes: data.note ?? null, updated_at: new Date().toISOString(),
      ...(data.status === "approved" ? { approved_by: context.userId, approved_at: new Date().toISOString(), is_active: true, xero_contact_status: business.xero_contact_id ? "synced" : "ready" } : {}),
    }).eq("id", data.businessId);
    // Decision 303: an approved REC is linked to every installer who named that electrician (best-effort; needs an active PIESA rate too).
    // Decision 402: approving the business approves its pending people whose certification is office-verified. Never fails the approval.
    if (data.status === "approved") await import("./worker-approval.server").then((m) => m.autoApproveVerifiedPeople(data.businessId, context.userId)).catch((e) => console.error("Decision 402 auto-approval skipped", (e as Error).message));
    if (data.status === "approved") await (await import("./rec-auto-link.server")).autoLinkApprovedRec(data.businessId, context.userId).catch((e) => console.error("REC auto-link skipped", (e as Error).message));
    // Installer sign-up: the electrician they named becomes their saved usual electrician. Best-effort; skips itself when the business has no installer application.
    if (data.status === "approved") await (await import("./signup-electrician.server")).carrySignupElectrician(data.businessId, context.userId).catch((e) => console.error("Sign-up electrician skipped", (e as Error).message));
    return { ok: true };
  });

export const addCredential = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid, profileId: uuid.nullish(), kind: z.enum(["public_liability_insurance", "workers_comp_insurance", "other_insurance", "electrical_licence", "rec_registration", "installer_certification", "business_registration", "other"]), label: z.string().trim().min(2).max(200), number: txt(100), issuer: txt(200), expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), critical: z.boolean().default(true), document_path: txt(500) }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context.supabase))) await requireMember(context.userId, data.businessId, true);
    if (data.document_path && !data.document_path.startsWith(`partners/${data.businessId}/`)) throw new WorkflowError("Invalid document path");
    if (data.document_path) { const { allowedUpload } = await import("./upload-safety.core"); const m = allowedUpload(data.document_path, null); if (!m) throw new WorkflowError("That file type isn't accepted."); const { verifyStoredUpload } = await import("./upload-safety.server"); await verifyStoredUpload("job-files", data.document_path, m); }
    const { error } = await admin.from("business_credentials").insert({ business_id: data.businessId, profile_id: data.profileId ?? null, kind: data.kind, label: data.label, number: data.number ?? null, issuer: data.issuer ?? null, expires_at: data.expires_at ?? null, critical: data.critical, document_path: data.document_path ?? null, created_by: context.userId });
    if (error) throw new WorkflowError(error.message);
    return { ok: true };
  });

export const verifyCredential = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid, verification: z.enum(["verified", "rejected", "pending"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    await admin.from("business_credentials").update({ verification: data.verification, verified_by: context.userId, verified_at: new Date().toISOString() }).eq("id", data.id);
    return { ok: true };
  });

export const partnerUploadUrl = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid, folder: z.enum(["credentials", "imports", "branding"]), fileName: z.string().trim().min(1).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context.supabase))) await requireMember(context.userId, data.businessId, true);
    { const { allowedUpload } = await import("./upload-safety.core"); if (!allowedUpload(data.fileName, null, { imports: data.folder === "imports" })) throw new WorkflowError("That file type isn't accepted. Please upload a PDF, photo, video, Word, Excel, CSV, text, email or ZIP file."); }
    const path = `partners/${data.businessId}/${data.folder}/${crypto.randomUUID()}-${data.fileName.replace(/[^\w.\-]+/g, "_")}`;
    const { data: s, error } = await admin.storage.from("job-files").createSignedUploadUrl(path);
    if (error) throw new WorkflowError(error.message);
    return { path, token: s.token };
  });

export const partnerFileUrl = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid, path: z.string().max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context.supabase))) await requireMember(context.userId, data.businessId, true);
    const { partnerFileBucket } = await import("./partner-file.core");
    let recorded = false;
    if (!data.path.startsWith(`partners/${data.businessId}/`)) {
      const credential = await admin.from("business_credentials").select("id").eq("business_id", data.businessId).eq("document_path", data.path).limit(1).maybeSingle();
      if (credential.error) throw new WorkflowError("The certificate could not be checked. Please try again.");
      recorded = !!credential.data;
    }
    const bucket = partnerFileBucket(data.businessId, data.path, recorded);
    if (!bucket) throw new WorkflowError("This file isn't available to your business.");
    const { data: s, error } = await signFile(bucket, data.path, 300);
    if (error || !s) throw new WorkflowError("The file could not be opened. Please try again.");
    return { url: s.signedUrl };
  });

export const setBankDetails = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid, account_name: z.string().trim().min(2).max(200), bsb: z.string().regex(/^\d{3}-?\d{3}$/), account_number: z.string().regex(/^\d{5,10}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    const adminUser = await isAdmin(context.supabase);
    if (!adminUser) await requireMember(context.userId, data.businessId, true);
    const { data: business } = await admin.from("businesses").select("onboarding_status").eq("id", data.businessId).single();
    if (business?.onboarding_status !== "approved") throw new WorkflowError("Bank details are collected only after Home Insulation Victoria approves the business.");
    const now = new Date().toISOString();
    const { data: existing } = await admin.from("business_bank_details").select("business_id").eq("business_id", data.businessId).maybeSingle();
    const { error } = await admin.from("business_bank_details").upsert({ business_id: data.businessId, account_name: data.account_name, bsb: data.bsb, account_number: data.account_number, updated_by: context.userId, updated_at: now, supplied_by: context.userId, supplied_at: now, reviewed_by: null, reviewed_at: null, review_status: "pending" });
    if (error) throw new WorkflowError(error.message);
    await admin.from("business_bank_detail_events").insert({ business_id: data.businessId, actor_id: context.userId, event_type: existing ? "changed" : "supplied", details: { bsb_last3: data.bsb.replace(/\D/g, "").slice(-3), account_last3: data.account_number.slice(-3) } as Json });
    return { ok: true };
  });

/** Masked for partners; full only to Home Insulation Victoria admin. */
export const getBankDetails = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const adminUser = await isAdmin(context.supabase);
    if (!adminUser) await requireMember(context.userId, data.businessId, true);
    const { data: b } = await admin.from("business_bank_details").select("account_name,bsb,account_number,updated_at,review_status,reviewed_at").eq("business_id", data.businessId).maybeSingle();
    if (!b) return null;
    return adminUser ? b : { account_name: b.account_name, bsb: `***-${b.bsb.slice(-3)}`, account_number: `****${b.account_number.slice(-3)}`, updated_at: b.updated_at };
  });

export const getPartnerAgreementTemplate = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async () => {
    const { data } = await admin.from("compliance_templates").select("version, body").eq("template_key", "partner_agreement").eq("is_active", true).eq("approved", true).maybeSingle();
    return data ?? null;
  });

export const signPartnerAgreement = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth, withRequestMeta])
  .inputValidator((d) => z.object({ businessId: uuid, signerName: z.string().trim().min(2).max(200), agree: z.literal(true) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireMember(context.userId, data.businessId, true);
    const { data: t } = await admin.from("compliance_templates").select("version, body").eq("template_key", "partner_agreement").eq("is_active", true).eq("approved", true).maybeSingle();
    if (!t) throw new WorkflowError("Home Insulation Victoria has not approved the partner participation agreement yet.");
    const { data: b } = await admin.from("businesses").select("name, legal_name, abn").eq("id", data.businessId).single();
    const signedAt = new Date().toISOString();
    const snapshot = { business: b, template_version: t.version, body: t.body, signer_id: context.userId, signer_name: data.signerName, signed_at: signedAt };
    const { error } = await admin.from("partner_agreements").insert({ business_id: data.businessId, version: t.version, body: t.body, signer_id: context.userId, signer_name: data.signerName, signed_at: signedAt, ip: context.ip ?? null, user_agent: context.userAgent ?? null, snapshot: snapshot as unknown as Json, snapshot_sha256: sha(snapshot) });
    if (error) throw new WorkflowError(error.message);
    return { ok: true };
  });

export const syncXeroSupplier = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { syncSupplierContact } = await import("./xero.server");
    try { return await syncSupplierContact(data.businessId); } catch (e) { throw new WorkflowError((e as Error).message); }
  });

export const runPartnerExpirySweep = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => { await requireAdmin(context.supabase); return sweepPartnerExpiry(context.userId); });

// ---------- Team ----------
export const addTeamMember = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid, email: z.string().trim().email(), memberRole: z.enum(["business_admin", "member"]), tradeRole: z.enum(["installer", "electrician", "none"]).default("none") }).parse(d))
  .handler(async ({ data, context }) => {
    const adminUser = await isAdmin(context.supabase);
    if (!adminUser) await requireMember(context.userId, data.businessId, true);
    const { data: p } = await admin.from("profiles").select("id, business_id").ilike("email", exactLike(data.email)).maybeSingle();
    if (!p) throw new WorkflowError("No portal account uses that email yet. Ask them to sign up first, then add them.");
    if (p.business_id && p.business_id !== data.businessId && !adminUser) throw new WorkflowError("That person already belongs to another business.");
    const normalizedEmail = data.email.trim().toLowerCase();
    const { data: worker } = data.tradeRole === "none"
      ? { data: null }
      : await admin.from("partner_workers").select("id, full_legal_name, licence_number, trade_role, account_status, approval_status").eq("business_id", data.businessId).ilike("email", exactLike(normalizedEmail)).eq("trade_role", data.tradeRole).is("removed_at", null).maybeSingle();
    if (data.tradeRole !== "none" && !worker) throw new WorkflowError("That worker is not listed in this business's approved onboarding. Home Insulation Victoria must review additions first.");
    // STEP 80: a partner business admin may only grant a trade role from an APPROVED, still-current listing. Granting
    // 'electrician' also clears the regulated-result guard, so a self-created pending (or removed) listing would let the
    // same business admin record a PIESA result. Office (admin) decides approval itself and keeps the existing ability.
    if (!adminUser && worker && worker.approval_status !== "approved") throw new WorkflowError(data.tradeRole === "electrician"
      ? "Home Insulation Victoria hasn't approved this electrician yet. Add them as an electrician once they're approved."
      : `Home Insulation Victoria hasn't approved this ${data.tradeRole} yet. Add them once they're approved.`);
    await admin.from("business_members").upsert({ business_id: data.businessId, user_id: p.id, member_role: data.memberRole, active: true, added_by: context.userId }, { onConflict: "business_id,user_id" });
    if (!p.business_id) await admin.from("profiles").update({ business_id: data.businessId, ...(worker?.full_legal_name ? { full_name: worker.full_legal_name } : {}), ...(worker?.licence_number ? { licence_number: worker.licence_number } : {}) }).eq("id", p.id);
    // Trade roles give job access only through assignments. Partners may grant their own staff a trade role; Home Insulation Victoria approval still gates the business.
    if (data.tradeRole !== "none") await admin.from("user_roles").upsert({ user_id: p.id, role: data.tradeRole }, { onConflict: "user_id,role" });
    if (worker) await admin.from("partner_workers").update({ profile_id: p.id, account_status: "linked", linked_by: context.userId, linked_at: new Date().toISOString() }).eq("id", worker.id);
    return { ok: true };
  });

export const removeTeamMember = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid, userId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context.supabase))) await requireMember(context.userId, data.businessId, true);
    if (data.userId === context.userId) throw new WorkflowError("You cannot remove yourself.");
    await admin.from("business_members").update({ active: false }).eq("business_id", data.businessId).eq("user_id", data.userId);
    await admin.from("profiles").update({ business_id: null }).eq("id", data.userId).eq("business_id", data.businessId);
    return { ok: true };
  });

export const setPartnerRelationship = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ installerBusinessId: uuid, electricianBusinessId: uuid, preferred: z.boolean(), active: z.boolean().default(true) }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context.supabase))) await requireMember(context.userId, data.installerBusinessId, true);
    await admin.from("partner_relationships").upsert({ installer_business_id: data.installerBusinessId, electrician_business_id: data.electricianBusinessId, preferred: data.preferred, active: data.active, created_by: context.userId }, { onConflict: "installer_business_id,electrician_business_id" });
    return { ok: true };
  });

/** Profile page data for the signed-in partner (or admin viewing a business). */
export const getPartnerProfile = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid.optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const adminUser = await isAdmin(context.supabase);
    const mine = await myBusinesses(context.userId);
    const id = data.businessId ?? [...mine.keys()][0];
    if (!id) return null;
    if (!adminUser && mine.get(id) !== "business_admin") throw new WorkflowError(mine.has(id) ? "Only the business owner can see this." : "Not your business.");
    const { business, credentials } = await loadBusiness(id);
    if (!business) return null;
    const [{ data: creds, error: credsError }, { data: members, error: membersError }, { data: workers, error: workersError }, { data: rels, error: relsError }, { data: agreements, error: agreementsError }, { data: cards, error: cardsError }, { data: electricians, error: electriciansError }] = await Promise.all([
      admin.from("business_credentials").select("*").eq("business_id", id).order("created_at"),
      admin.from("business_members").select("user_id, member_role, active, profiles!business_members_user_id_fkey(full_name, email)").eq("business_id", id),
      admin.from("partner_workers").select("id, profile_id, trade_role, full_legal_name, email, mobile, licence_number, qualification, account_status").eq("business_id", id).order("full_legal_name"),
      admin.from("partner_relationships").select("id, electrician_business_id, preferred, active, businesses!partner_relationships_electrician_business_id_fkey(name, onboarding_status)").eq("installer_business_id", id),
      admin.from("partner_agreements").select("version, signer_name, signed_at, snapshot_sha256").eq("business_id", id).order("signed_at", { ascending: false }),
      admin.from("rate_cards").select("id, kind, name, version, effective_from, is_active").eq("business_id", id).order("version", { ascending: false }),
      admin.from("businesses").select("id, name, onboarding_status, business_type, capabilities").or("business_type.eq.rec,capabilities.cs.{electrician}"),
    ]);
    for (const [label, error] of [["credentials", credsError], ["members", membersError], ["workers", workersError], ["electrician relationships", relsError], ["agreements", agreementsError], ["rate cards", cardsError], ["electrician businesses", electriciansError]] as const) {
      if (error) throw new WorkflowError(`Could not read partner ${label}: ${error.message}`);
    }
    const { data: methods, error: methodsError } = await admin.from("partner_measurement_methods").select("*").eq("business_id", id).order("created_at", { ascending: false });
    if (methodsError) throw new WorkflowError(`Could not read partner measurement methods: ${methodsError.message}`);
    const checklist = onboardingChecklist(business as BusinessLike, credentials, !!agreements?.length);
    // ESC collection notice state per installer worker (office flag "ESC notice not acknowledged"; informs, never blocks).
    const collectionNotice = await (await import("./esc-collection-notice.server")).businessNoticeStatuses(id);
    const inHouseFacts = adminUser ? await (await import("./installer-paid-electricians.server")).inHouseFactsFor(id) : null;
    const { xero_contact_id: _x, xero_contact_error: _e, ...safe } = business;
    return { business: adminUser ? business : safe, inHouseFacts, credentials: creds ?? [], members: members ?? [], workers: workers ?? [], relationships: rels ?? [], agreements: agreements ?? [], rateCards: cards ?? [], electricianBusinesses: adminUser ? (electricians ?? []) : [] /* trades never see HIV's electrician network */, measurementMethods: methods ?? [], checklist, collectionNotice, myRole: adminUser ? "hivic_admin" : mine.get(id) };
  });

// ---------- Import ----------
export const createImport = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    businessId: uuid, sourceSystem: z.enum(["easymate", "manual_import", "csv", "email"]).default("manual_import"),
    text: z.string().max(100_000).optional(), csv: z.string().max(500_000).optional(), csvRow: z.number().int().min(0).max(5000).default(0),
    sourceUrl: z.string().trim().url().max(1000).optional(), externalRefs: z.record(z.string(), z.string().max(200)).optional(),
    files: z.array(z.object({ path: z.string().max(500), name: z.string().max(200), type: z.string().max(100), purpose: z.enum(["quote", "supporting"]).optional() })).max(30).default([]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { createImportFor } = await import("./partner-import.server");
    return createImportFor(context.userId, data);
  });

export const getImportDraft = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ importId: uuid, businessId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { getImportDraftFor } = await import("./partner-import.server");
    return getImportDraftFor(context.userId, data.importId, data.businessId);
  });

export const discardImport = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ importId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: imp } = await admin.from("job_imports").select("business_id, status").eq("id", data.importId).single();
    if (!imp || imp.status !== "draft") throw new WorkflowError("Draft not found.");
    await requireMember(context.userId, imp.business_id);
    await admin.from("job_imports").update({ status: "discarded", updated_at: new Date().toISOString() }).eq("id", data.importId);
    return { ok: true };
  });

const factValue = z.union([z.string().max(5000), z.number(), z.boolean(), z.null()]);
export const confirmImport = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    importId: uuid, facts: z.record(z.string(), factValue),
    // Staged "Add your own customer" form: where the installer is up to, occupancy and the Ready Check A1 summary.
    progress: z.enum(["not_visited", "measured", "quoted"]).optional(),
    occupancy: z.enum(["owner_occupied", "rental"]).optional(),
    details: z.record(z.string(), z.unknown()).refine((v) => JSON.stringify(v).length < 60_000, "Too much detail").optional(),
    // Add one job (Jo, 7 Oct): same three facts as bulk upload — his quoted price exactly as given, what it includes, site check Y/N.
    installer: z.object({
      site_check: z.enum(["yes", "no"]),
      site_check_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
      quoted_price_inc_gst: z.number().positive().max(1_000_000).nullish(),
      price_includes: z.string().trim().max(1000).nullish(),
      contact_permission: z.boolean().optional(),
      fee_awareness: z.boolean().optional(),
      existing_below_r2: z.boolean().optional(),
      owner_agreed: z.boolean().optional(),
      quoted: z.enum(["yes", "no"]).nullable().optional(),
      // Approved single intake (Jo, 8 Oct 2026).
      intake: z.object({
        existing_insulation: z.enum(["none", "below_r2", "unknown"]),
        evidence_ack: z.boolean(),
        proposed_r_value: z.number().positive().max(10).nullish(),
        removal_quote: z.object({ answer: z.enum(["yes", "no", "unknown"]), areaM2: z.number().positive().max(5000).nullable(), chargeIncGst: z.number().min(0).max(1_000_000).nullable() }).optional(),
        commercial: z.object({ basis: z.enum(["before_discount", "after_discount", "unsure"]).nullable(), gst: z.enum(["inc_gst", "ex_gst", "unsure"]).nullable(), inclusions: z.string().trim().max(1000).nullable(), exclusions: z.string().trim().max(1000).nullable(), originalStatus: z.enum(["prepared", "sent", "accepted_by_customer"]).nullable(), removalPricing: z.enum(["included", "additional", "not_priced"]).nullable(), removalAmountIncGst: z.number().min(0).max(1_000_000).nullable(), extras: z.array(z.object({ description: z.string().trim().min(1).max(300), pricing: z.enum(["included", "additional", "not_priced"]), amountIncGst: z.number().min(0).max(1_000_000).nullable() })).max(20) }).optional(),
        version: z.string().max(60),
        coordination: z.enum(["hivic_managed", "self_managed"]),
        self_managed_ack: z.boolean(),
        measured_required: z.boolean().optional(),
        electrician_payer: z.enum(["hivic", "own", "undecided"]).optional(),
        fee_awareness: z.object({ declared: z.boolean(), payer: z.enum(["hivic", "own", "undecided"]), text: z.string().max(400), version: z.string().max(80) }).optional(),
        // Before visit / before quote (Jo, 8 Oct): optional on older clients = "have_quote" (previous behaviour).
        quote_status: z.enum(["not_quoted", "have_quote"]).optional(),
        attended: z.enum(["attended", "not_attended"]).nullish(),
        attended_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
      }).optional(),
    }).optional(),
    electrician: z.object({ mode: z.enum(["mine", "hivic", "later"]), business_id: uuid.nullish(), nomination_id: uuid.nullish() }).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { confirmImportFor } = await import("./partner-import.server");
    return confirmImportFor(context.userId, data);
  });

const importFile = z.object({ path: z.string().max(500), name: z.string().max(200), type: z.string().max(100), purpose: z.enum(["quote", "supporting"]).optional() });
export const addImportFiles = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ importId: uuid, files: z.array(importFile).min(1).max(20) }).parse(d))
  .handler(async ({ data, context }) => {
    const { addImportFilesFor } = await import("./partner-import.server");
    return addImportFilesFor(context.userId, data.importId, data.files);
  });

export const removeImportFile = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ importId: uuid, path: z.string().max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { removeImportFileFor } = await import("./partner-import.server");
    return removeImportFileFor(context.userId, data.importId, data.path);
  });

// ---------- Electrician selection ----------
export const electricianOptions = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["admin", "installer"]);
    const { cands, site } = await electricianCandidates(data.jobId);
    const ranked = rankElectricians(cands, site);
    const { data: members } = await admin.from("business_members").select("business_id, user_id, profiles!business_members_user_id_fkey(full_name)").in("business_id", ranked.map((r) => r.id).length ? ranked.map((r) => r.id) : ["00000000-0000-0000-0000-000000000000"]).eq("active", true);
    const { data: noms } = await admin.from("electrician_nominations").select("id, contact_name, business_name, status, created_at").eq("job_id", data.jobId);
    const { data: j } = await admin.from("jobs").select("electrician_choice").eq("id", data.jobId).single();
    return { ranked: ranked.map((r) => ({ ...r, preferred: cands.find((c) => c.id === r.id)?.preferred ?? false, people: (members ?? []).filter((m) => m.business_id === r.id).map((m) => ({ id: m.user_id, name: (m.profiles as unknown as { full_name: string | null } | null)?.full_name ?? "Electrician" })) })), nominations: noms ?? [], choice: j?.electrician_choice ?? null };
  });

export const chooseElectrician = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    jobId: uuid, choice: z.enum(["preferred", "approved_other", "nominated", "hivic_organise"]), businessId: uuid.optional(), userId: uuid.optional(),
    nomination: z.object({ contact_name: z.string().trim().min(2).max(200), business_name: txt(200), email: z.string().trim().email().max(320).nullish(), phone: txt(40), licence_number: txt(50), rec_number: txt(50), nominated_for: z.enum(["installer", "customer"]).default("installer") }).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await requireJobRole(context.supabase, data.jobId, ["admin", "installer"]);
    const { cands } = await electricianCandidates(data.jobId);
    const cand = data.businessId ? cands.find((c) => c.id === data.businessId) ?? null : null;
    const blocker = electricianSelectionBlocker(data.choice, cand);
    if (blocker) throw new WorkflowError(blocker);
    { // Same central payer lock as the Add job editor; Add job jobs change payer only through their guarded editor.
      const { isIntakeJob } = await import("./installer-intake.server");
      if (await isIntakeJob(data.jobId)) throw new WorkflowError(role === "admin" ? "This job came through Add job — its electrician arrangement changes through the installer's job details (quotes and fee confirmation update together). Ask the installer to change it." : "Change the electrician in this job's details, so the owner's quote and fee confirmation update together.");
      const lock = await (await import("./job-electrician.server")).payerChangeBlocker(data.jobId);
      if (lock) throw new WorkflowError(lock);
    }
    await admin.from("jobs").update({ electrician_choice: data.choice }).eq("id", data.jobId);
    if (data.choice === "hivic_organise") { await logEvent(data.jobId, context.userId, "electrician_choice", "Home Insulation Victoria asked to organise an electrician"); return { ok: true, assigned: false }; }
    if (data.choice === "nominated") {
      if (!data.nomination) throw new WorkflowError("Enter the electrician's details.");
      const { data: inst } = await admin.from("job_assignments").select("business_id").eq("job_id", data.jobId).eq("role", "installer").eq("active", true).maybeSingle();
      // Internal record only: no invitation is sent while customer communications are locked.
      await admin.from("electrician_nominations").insert({ contact_name: data.nomination.contact_name, business_name: data.nomination.business_name ?? null, email: data.nomination.email ?? null, phone: data.nomination.phone ?? null, licence_number: data.nomination.licence_number ?? null, rec_number: data.nomination.rec_number ?? null, nominated_for: data.nomination.nominated_for, job_id: data.jobId, nominated_by: context.userId, nominating_business_id: inst?.business_id ?? null, status: "invite_pending_comms" });
      await logEvent(data.jobId, context.userId, "electrician_nominated", `Electrician nominated: ${data.nomination.contact_name} – waiting for Home Insulation Victoria onboarding (not yet approved)`);
      await admin.from("jobs").update({ next_action: "Waiting for nominated electrician onboarding" }).eq("id", data.jobId);
      return { ok: true, assigned: false };
    }
    const { data: m } = await admin.from("business_members").select("user_id").eq("business_id", cand!.id).eq("active", true);
    const { data: p } = await admin.from("profiles").select("id").eq("business_id", cand!.id);
    const people = new Set([...(m ?? []).map((x) => x.user_id), ...(p ?? []).map((x) => x.id)]);
    const userId = data.userId ?? (people.size === 1 ? [...people][0] : null);
    if (!userId || !people.has(userId)) throw new WorkflowError("Choose which electrician from this business will attend.");
    const { data: hasRole } = await admin.from("user_roles").select("id").eq("user_id", userId).eq("role", "electrician").maybeSingle();
    if (!hasRole) throw new WorkflowError("That person does not hold the electrician role.");
    await assignElectrician(data.jobId, userId, cand!.id, context.userId, `${role} selected ${cand!.name} (${data.choice.replace("_", " ")})`);
    return { ok: true, assigned: true };
  });

async function assignElectrician(jobId: string, userId: string, businessId: string, actorId: string, summary: string) {
  // Phase 1 compliance: enforce electrician work eligibility before assignment
  const { electricianWorkEligibility } = await import("./pilot.core");
  const [{ data: business }, { data: creds }, { data: workers }] = await Promise.all([
    admin.from("businesses").select("*").eq("id", businessId).maybeSingle(),
    admin.from("business_credentials").select("kind,label,expires_at,critical,verification").eq("business_id", businessId),
    admin.from("partner_workers").select("trade_role,licence_expires_on,approval_status,removed_at").eq("business_id", businessId).eq("trade_role", "electrician"),
  ]);
  const blocker = electricianWorkEligibility(business as any, creds as any, workers as any);
  if (blocker) throw new WorkflowError(`Electrician assignment blocked: ${blocker}`);
  
  const now = new Date().toISOString();
  await admin.from("job_assignments").update({ active: false, ended_at: now, end_reason: "reassigned" }).eq("job_id", jobId).eq("role", "electrician").eq("active", true);
  await admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "assessment").eq("status", "proposed");
  await admin.from("job_assignments").insert({ job_id: jobId, user_id: userId, role: "electrician", business_id: businessId, assigned_by: actorId });
  await logEvent(jobId, actorId, "contractor_assigned", `Electrician assigned: ${summary}`);
  const { autoAdvanceJob } = await import("./autoadvance.server");
  await autoAdvanceJob(jobId, actorId, "electrician assigned");
}

export const markCannotAttend = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, reason: z.string().trim().min(3).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["electrician"]);
    await admin.from("job_assignments").update({ cannot_attend_at: new Date().toISOString() }).eq("job_id", data.jobId).eq("role", "electrician").eq("active", true).eq("user_id", context.userId);
    await logEvent(data.jobId, context.userId, "electrician_cannot_attend", "Electrician cannot attend in time", { reason: data.reason });
    return { ok: true };
  });

/** Owner/installer/admin: request another electrician (48h SLA or electrician cannot attend). Preserves history. */
export const requestAnotherElectrician = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, reason: z.string().trim().min(3).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await requireJobRole(context.supabase, data.jobId, ["admin", "owner", "installer"]);
    const { data: a } = await admin.from("job_assignments").select("*").eq("job_id", data.jobId).eq("role", "electrician").eq("active", true).maybeSingle();
    if (!a) throw new WorkflowError("No electrician is assigned.");
    const sla = appointmentSla(a);
    if (role !== "admin" && !sla.canRequestAnother) throw new WorkflowError("You can request another electrician after 48 hours without meaningful contact, or if the electrician says they cannot attend.");
    const now = new Date().toISOString();
    await admin.from("job_assignments").update({ active: false, ended_at: now, end_reason: `replacement requested by ${role}: ${data.reason}` }).eq("id", a.id);
    await admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", data.jobId).in("kind", ["assessment", "rectification"]).eq("status", "proposed");
    await admin.from("reassignment_requests").update({ status: "actioned", resolved_by: context.userId, resolved_at: now }).eq("job_id", data.jobId).eq("role", "electrician").eq("status", "open");
    // Replacing the PERSON keeps an Add job job's recorded payer (billing arrangement) — only its guarded editor changes that.
    const keepPayer = await (await import("./installer-intake.server")).isIntakeJob(data.jobId);
    await admin.from("jobs").update(keepPayer ? { next_action: "Choose another electrician" } : { electrician_choice: null, next_action: "Choose another electrician" }).eq("id", data.jobId);
    await logEvent(data.jobId, context.userId, "electrician_replacement_requested", `${role} requested another electrician (${sla.message})`, { reason: data.reason, previous_assignment: a.id });
    return { ok: true };
  });

// ---------- Appointment coordination ----------
export const proposeTime = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, kind: z.enum(["assessment", "ready_check", "rectification", "installation"]).default("assessment"), start: z.string().datetime({ offset: true }), note: txt(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await requireJobRole(context.supabase, data.jobId, ["admin", "owner", "electrician", "installer"]);
    if (data.kind === "assessment") {
      // "assessment" = the PIESA visit. Only once the PIESA gate has been passed and an electrician accepted.
      if (!["piesa_and_install_window_pending", "piesa_scheduled"].includes(await getStage(data.jobId))) throw new WorkflowError("The PIESA can only be arranged after the confirmed quote is approved and the payment option is cleared.");
      const { piesaRequestFacts } = await import("./workflow.server");
      const { piesaRequestBlockers } = await import("./payment-gate.core");
      const gate = piesaRequestBlockers(await piesaRequestFacts(data.jobId));
      if (gate.length) throw new WorkflowError(`The PIESA cannot be arranged yet: ${gate.join(" ")}`);
    }
    if (data.kind === "installation") {
      const { clearanceFacts } = await import("./allocation.server");
      const { electricalClearance, installationCoordinationBlocker } = await import("./allocation.core");
      const b0 = installationCoordinationBlocker(electricalClearance(await clearanceFacts(data.jobId)));
      if (b0) throw new WorkflowError(b0);
    }
    if (Date.parse(data.start) <= Date.now()) throw new WorkflowError("Propose a time in the future.");
    const { data: a } = await admin.from("job_assignments").select("id, user_id, first_response_at").eq("job_id", data.jobId).eq("role", data.kind === "installation" || data.kind === "ready_check" ? "installer" : "electrician").eq("active", true).maybeSingle();
    if (!a) throw new WorkflowError("No trade is assigned yet.");
    if (data.kind === "ready_check" && role !== "installer" && role !== "owner") throw new WorkflowError("The assigned installer contacts the owner to arrange the Ready Check.");
    await admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", data.jobId).eq("kind", data.kind).eq("status", "proposed");
    await admin.from("appointment_proposals").insert({ job_id: data.jobId, kind: data.kind, assignment_id: a.id, proposed_by: context.userId, proposer_role: role, starts_at: data.start, note: data.note ?? null });
    if (a.user_id === context.userId && !a.first_response_at) await admin.from("job_assignments").update({ first_response_at: new Date().toISOString() }).eq("id", a.id);
    await logEvent(data.jobId, context.userId, data.kind === "ready_check" ? "ready_check_contact_recorded" : "appointment_proposed", `${role} proposed ${new Date(data.start).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })} for ${data.kind === "ready_check" ? "the Ready Check" : data.kind}`, { note: data.note, assignment_id: a.id });
    // Decision 325: the electrician offered a safety check (PIESA) time → O26 "Pick a time for your electrical safety check" (best-effort).
    if (data.kind === "assessment" && role === "electrician") await (await import("./owner-email-triggers.server")).onSafetyCheckTimesOffered(data.jobId, [data.start]).catch((e) => console.error("safety check times email skipped", (e as Error).message));
    return { ok: true };
  });

/** Installer records Ready Check contact/follow-up; this stores history and sends nothing. */
export const recordReadyCheckContact = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, outcome: z.enum(["contacted", "no_response", "cannot_reach"]), note: txt(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["installer"]);
    const { data: assignment } = await admin.from("job_assignments").select("id").eq("job_id", data.jobId).eq("role", "installer").eq("user_id", context.userId).eq("active", true).maybeSingle();
    if (!assignment) throw new WorkflowError("Only the assigned installer can record Ready Check contact.");
    const needsFollowUp = data.outcome !== "contacted";
    await logEvent(data.jobId, context.userId, "ready_check_contact_recorded", `Installer Ready Check contact: ${data.outcome.replace("_", " ")}`, { assignment_id: assignment.id, outcome: data.outcome, note: data.note ?? null, follow_up_required: needsFollowUp });
    if (needsFollowUp) {
      const { count } = await admin.from("reassignment_requests").select("id", { count: "exact", head: true }).eq("job_id", data.jobId).eq("role", "installer").eq("status", "open");
      if (!count) await admin.from("reassignment_requests").insert({ job_id: data.jobId, role: "installer", requested_by: context.userId, reason: `Ready Check contact follow-up required: ${data.outcome.replace("_", " ")}${data.note ? ` — ${data.note}` : ""}` });
      await admin.from("jobs").update({ next_action: "Follow up Ready Check contact or reassign installer" }).eq("id", data.jobId);
    }
    return { ok: true, followUpRequired: needsFollowUp };
  });

export const respondToProposal = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ proposalId: uuid, action: z.enum(["accept", "decline"]), note: txt(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: p } = await admin.from("appointment_proposals").select("*").eq("id", data.proposalId).single();
    if (!p) throw new WorkflowError("Proposal not found.");
    if (p.electrician_window) throw new WorkflowError("Pick electrical fixes times when approving the electrical fixes quote.");
    const role = await requireJobRole(context.supabase, p.job_id, ["admin", "owner", "electrician", "installer"]);
    const b = proposalResponse(p, role, data.action);
    if (b) throw new WorkflowError(b);
    const now = new Date().toISOString();
    if (p.assignment_id) { const { data: a } = await admin.from("job_assignments").select("user_id, first_response_at").eq("id", p.assignment_id).single(); if (a?.user_id === context.userId && !a.first_response_at) await admin.from("job_assignments").update({ first_response_at: now }).eq("id", p.assignment_id); }
    if (data.action === "accept") {
      const { confirmBooking } = await import("./booking.server");
      await confirmBooking(p.job_id, p.kind, p.starts_at, context.userId, role, p.note);
    }
    await admin.from("appointment_proposals").update({ status: data.action === "accept" ? "accepted" : "declined", responded_by: context.userId, responded_at: now, response_note: data.note ?? null }).eq("id", p.id);
    if (data.action === "decline") await logEvent(p.job_id, context.userId, "appointment_declined", `${role} declined the proposed time`, { note: data.note });
    return { ok: true };
  });

export const coordinationState = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await requireJobRole(context.supabase, data.jobId, ["admin", "owner", "electrician", "installer"]);
    const [{ data: a }, { data: props }] = await Promise.all([
      admin.from("job_assignments").select("id, assigned_at, first_response_at, booking_confirmed_at, cannot_attend_at, profiles!job_assignments_user_id_fkey(full_name)").eq("job_id", data.jobId).eq("role", "electrician").eq("active", true).maybeSingle(),
      admin.from("appointment_proposals").select("id, kind, proposer_role, starts_at, note, status, response_note, created_at").eq("job_id", data.jobId).eq("electrician_window", false).order("created_at", { ascending: false }).limit(30),
    ]);
    const [{ data: bk }, { data: rr }] = await Promise.all([
      admin.from("bookings").select("kind, scheduled_start, status").eq("job_id", data.jobId).eq("status", "confirmed"),
      admin.from("reassignment_requests").select("id, reason, created_at").eq("job_id", data.jobId).eq("role", "electrician").eq("status", "open"),
    ]);
    return { role, electrician: a ? { name: (a.profiles as { full_name: string | null } | null)?.full_name ?? "Electrician", sla: appointmentSla(a) } : null, proposals: props ?? [], confirmed: bk ?? [], openRequests: rr ?? [] };
  });

// ---------- Offers of Home Insulation Victoria jobs to partners ----------
export const offerToPartner = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, businessId: uuid, expiresInDays: z.number().int().min(1).max(30).default(3) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const biz = await requireApprovedPartner(data.businessId);
    const { data: j } = await admin.from("jobs").select("job_number, stage, channel, estimated_area_m2, eligibility_outcome, properties(suburb, postcode)").eq("id", data.jobId).single();
    if (!j) throw new WorkflowError("Job not found");
    const [{ count: inst }, { count: pend }, { data: m }] = await Promise.all([
      admin.from("job_assignments").select("id", { count: "exact", head: true }).eq("job_id", data.jobId).eq("role", "installer").eq("active", true),
      admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", data.jobId).eq("kind", "installer").eq("status", "pending"),
      admin.from("ceiling_measurements").select("measured_area_m2, status").eq("job_id", data.jobId).eq("is_current", true).maybeSingle(),
    ]);
    // Preference columns arrive with pending migration 0082; until then they are undefined and do not block.
    const prefs = biz as unknown as { receives_hivic_leads?: boolean | null; accepting_new_jobs?: boolean | null };
    const b = offerBlocker({ channel: j.channel, stage: j.stage, hasActiveInstaller: !!inst, hasPendingOffer: !!pend }, { receives_hivic_leads: prefs.receives_hivic_leads, accepting_new_jobs: prefs.accepting_new_jobs });
    if (b) throw new WorkflowError(b);
    const p = j.properties as { suburb: string | null; postcode: string | null } | null;
    if (!verifiedServiceAreaMatch(biz, p?.postcode ?? null)) throw new WorkflowError(`${biz.name} does not have office-verified coverage for postcode ${p?.postcode ?? "unknown"}. Confirm the partner's service postcodes before offering this job.`);
    if (biz.free_measureups_for_hivic_quote_leads !== true) throw new WorkflowError(`${biz.name} has not agreed to free Home Insulation Victoria quote-lead Ready Checks.`);
    const summary = offerSummary({ job_number: j.job_number, stage: j.stage, suburb: p?.suburb ?? null, postcode: p?.postcode ?? null, estimated_area_m2: j.estimated_area_m2, measured_area_m2: m?.status === "complete" ? m.measured_area_m2 : null, eligibility_outcome: j.eligibility_outcome });
    await (await import("./offer-guard.server")).assertOfferPairsAllowed(data.jobId, [data.businessId]);
    await admin.from("partner_offers").insert({ job_id: data.jobId, business_id: data.businessId, summary: summary as unknown as Json, offered_by: context.userId, expires_at: new Date(Date.now() + data.expiresInDays * 86_400_000).toISOString() });
    await logEvent(data.jobId, context.userId, "partner_offer_made", `Job offered to ${biz.name} (acquisition channel stays Home Insulation Victoria-sourced)`);
    return { ok: true };
  });

export const withdrawOffer = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ offerId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { data: o } = await admin.from("partner_offers").update({ status: "withdrawn", responded_by: context.userId, responded_at: new Date().toISOString() }).eq("id", data.offerId).eq("status", "pending").select("job_id").maybeSingle();
    if (o) await logEvent(o.job_id, context.userId, "partner_offer_withdrawn", "Partner offer withdrawn");
    return { ok: true };
  });

export const respondToOffer = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ offerId: uuid, accept: z.boolean(), reason: txt(1000), proposalId: uuid.optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: o } = await admin.from("partner_offers").select("*").eq("id", data.offerId).single();
    if (!o) throw new WorkflowError("Offer not found.");
    await requireMember(context.userId, o.business_id);
    const b = offerRespondBlocker(o);
    if (b) { if (b.includes("expired")) await admin.from("partner_offers").update({ status: "expired" }).eq("id", o.id); throw new WorkflowError(b); }
    if (o.kind === "ready_check") {
      const { respondToReadyCheckOffer } = await import("./readycheck-booking.server");
      return respondToReadyCheckOffer(o.id, context.userId, data.accept, data.reason ?? null, data.proposalId ?? null);
    }
    if (o.kind !== "installer") {
      // PIESA / rectification offers go through the atomic electrician allocation path.
      const { respondToRecOffer } = await import("./allocation.server");
      return respondToRecOffer(o.id, context.userId, data.accept, data.reason ?? null, data.proposalId ?? null);
    }
    const now = new Date().toISOString();
    if (!data.accept) {
      await admin.from("partner_offers").update({ status: "declined", responded_by: context.userId, responded_at: now, decline_reason: data.reason ?? null }).eq("id", o.id);
      await logEvent(o.job_id, context.userId, "partner_offer_declined", "Partner declined the job – back to matching", { reason: data.reason });
      return { ok: true };
    }
    await requireApprovedPartner(o.business_id);
    const { data: isInstaller } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "installer" });
    if (!isInstaller) throw new WorkflowError("Only an installer team member can accept a job.");
    await admin.from("partner_offers").update({ status: "accepted", responded_by: context.userId, responded_at: now }).eq("id", o.id);
    await admin.from("job_assignments").insert({ job_id: o.job_id, user_id: context.userId, role: "installer", business_id: o.business_id, assigned_by: context.userId, first_response_at: now });
    // Channel and relationship owner are NOT changed: Home Insulation Victoria acquired this customer.
    await logEvent(o.job_id, context.userId, "partner_offer_accepted", "Partner accepted the job – installer assigned (still Home Insulation Victoria-sourced, Home Insulation Victoria relationship owner)");
    return { ok: true };
  });

export const setRelationshipOwner = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, owner: z.enum(["hivic", "installer"]), reason: z.string().trim().min(5).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { data: j } = await admin.from("jobs").select("customer_relationship_owner").eq("id", data.jobId).single();
    await admin.from("jobs").update({ customer_relationship_owner: data.owner }).eq("id", data.jobId);
    await logEvent(data.jobId, context.userId, "relationship_owner_changed", `Customer relationship owner: ${j?.customer_relationship_owner} → ${data.owner}`, { reason: data.reason });
    return { ok: true };
  });

// ---------- Partner pricing (supplier cost layer) ----------
const partnerLine = z.object({ code: txt(50), description: z.string().trim().min(2).max(300), category: z.string().max(40), unit: z.string().max(20), quantity: z.number().min(0).max(100000), supplier_unit_ex_gst: z.number().min(0).max(1_000_000), justification: txt(1000) });
export const submitPartnerProposal = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, lines: z.array(partnerLine).max(60), notes: txt(3000), reason: txt(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["installer"]);
    const { data: a } = await admin.from("job_assignments").select("business_id").eq("job_id", data.jobId).eq("role", "installer").eq("active", true).eq("user_id", context.userId).maybeSingle();
    if (!a?.business_id) throw new WorkflowError("You are not the assigned installer.");
    const bl = partnerLineBlockers(data.lines);
    if (bl.length) throw new WorkflowError(bl.join(" • "));
    const { data: prev } = await admin.from("partner_quote_proposals").select("id, version").eq("job_id", data.jobId).eq("business_id", a.business_id).order("version", { ascending: false }).limit(1).maybeSingle();
    const version = (prev?.version ?? 0) + 1;
    const rb = revisionBlocker(version, data.reason);
    if (rb) throw new WorkflowError(rb);
    const { data: card } = await admin.from("rate_cards").select("id").eq("business_id", a.business_id).eq("kind", "installer").eq("is_active", true).order("version", { ascending: false }).limit(1).maybeSingle();
    const total = supplierTotal(data.lines);
    const snap = { job_id: data.jobId, business_id: a.business_id, version, lines: data.lines, total, actor: context.userId, at: new Date().toISOString(), reason: data.reason ?? null };
    if (prev) await admin.from("partner_quote_proposals").update({ status: "superseded" }).eq("id", prev.id);
    await admin.from("partner_quote_proposals").insert({ job_id: data.jobId, business_id: a.business_id, version, rate_card_id: card?.id ?? null, lines: data.lines as unknown as Json, supplier_total_ex_gst: total, notes: data.notes ?? null, change_reason: data.reason ?? null, snapshot_sha256: sha(snap), created_by: context.userId });
    // Internal event: supplier pricing must never appear in owner-visible history.
    await logEvent(data.jobId, context.userId, "partner_price_proposed", `Installer proposed scope/price v${version}`, { version, reason: data.reason ?? null }, { internal: true });
    return { ok: true, version, total };
  });

// ---------- Partner dashboard ----------
export const partnerDashboard = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const mine = await myBusinesses(context.userId);
    const ids = [...mine.keys()];
    if (!ids.length) return null;
    const bizId = ids[0]!;
    const isBizAdmin = mine.get(bizId) === "business_admin";
    const { business, credentials } = await loadBusiness(bizId);
    const { data: offers } = await admin.from("partner_offers").select("id, job_id, kind, status, summary, offered_at, expires_at").eq("business_id", bizId).eq("status", "pending");
    // Owner-picked PIESA windows for open PIESA offers: times only, never owner details.
    const piesaJobs = (offers ?? []).filter((o) => o.kind === "piesa").map((o) => (o as { job_id?: string }).job_id).filter(Boolean) as string[];
    const { data: winRows } = piesaJobs.length
      ? await admin.from("appointment_proposals").select("id, job_id, starts_at, ends_at").in("job_id", piesaJobs).not("piesa_window_round", "is", null).eq("status", "proposed").gt("starts_at", new Date().toISOString()).order("starts_at")
      : { data: [] as { id: string; job_id: string; starts_at: string; ends_at: string | null }[] };
    const rcJobs = (offers ?? []).filter((o) => o.kind === "ready_check").map((o) => o.job_id);
    const rcWins = await (await import("./readycheck-booking.server")).readyCheckOfferWindows(rcJobs);
    let q = admin.from("job_assignments").select("job_id, user_id, role").eq("business_id", bizId).eq("active", true);
    if (!isBizAdmin) {
      // Staff see jobs assigned to them, plus jobs their boss sent them a current link for.
      const { data: mineW } = await admin.from("partner_workers").select("id").eq("profile_id", context.userId).eq("business_id", bizId).eq("approval_status", "approved").is("removed_at", null);
      const wIds = (mineW ?? []).map((w) => w.id);
      const { data: linked } = wIds.length ? await admin.from("worker_job_links").select("job_id").in("worker_id", wIds).is("revoked_at", null).gt("expires_at", new Date().toISOString()) : { data: [] as { job_id: string }[] };
      const linkedIds = (linked ?? []).map((l) => l.job_id);
      q = linkedIds.length ? q.or(`user_id.eq.${context.userId},job_id.in.(${linkedIds.join(",")})`) : q.eq("user_id", context.userId);
    }
    const { data: asgAll } = await q;
    // TEST sign-ins only see active TEST journeys; old or archived TEST jobs stay hidden.
    const { data: authU } = await context.supabase.auth.getUser();
    const qaUser = authU.user?.user_metadata?.["qa_test"] === true;
    const asgIds = [...new Set((asgAll ?? []).map((a) => a.job_id))];
    const { data: srcRows } = asgIds.length ? await admin.from("jobs").select("id, source, qa_archived_at, stage").in("id", asgIds) : { data: [] as { id: string; source: string | null; qa_archived_at: string | null; stage: string }[] };
    const keep = new Set((srcRows ?? []).filter((j) => (qaUser ? j.source === "qa_test" && !j.qa_archived_at : !j.qa_archived_at) && !["complete", "cancelled"].includes(j.stage)).map((j) => j.id));
    const asg = (asgAll ?? []).filter((a) => keep.has(a.job_id));
    const jobIds = [...new Set(asg.map((a) => a.job_id))];
    const none = ["00000000-0000-0000-0000-000000000000"];
    const [{ data: jobs }, { data: elec }, { data: bookings }, { data: inv }] = await Promise.all([
      admin.from("jobs").select("id, job_number, stage, next_action, last_activity_at, channel, customer_relationship_owner, owners(full_name), properties(address_line, suburb, postcode)").in("id", jobIds.length ? jobIds : none),
      admin.from("job_assignments").select("job_id, assigned_at, first_response_at, booking_confirmed_at, cannot_attend_at, profiles!job_assignments_user_id_fkey(full_name)").eq("role", "electrician").eq("active", true).in("job_id", jobIds.length ? jobIds : none),
      admin.from("bookings").select("job_id, kind, scheduled_start").eq("status", "confirmed").in("job_id", jobIds.length ? jobIds : none),
      // Batch 3b: the install invoice only (a fixes / repeat safety check invoice never clears the install deposit); newest first.
      admin.from("invoice_status" as never).select("job_id, deposit_cleared" as never).in("job_id" as never, (jobIds.length ? jobIds : none) as never).eq("kind" as never, "installation" as never).order("created_at" as never, { ascending: false }),
    ]);
    // Owner name / exact address only while this business holds a current, unrevoked visit release (same rule as SQL visit_is_current).
    const { data: rels } = await admin.from("contact_releases").select("job_id, visit_kind, job_assignments!inner(business_id, active)").is("revoked_at", null).in("job_id", jobIds.length ? jobIds : none).eq("job_assignments.business_id", bizId);
    const { data: props } = await admin.from("appointment_proposals").select("job_id").eq("status", "proposed").in("job_id", jobIds.length ? jobIds : none);
    const { visitIsCurrent } = await import("./allocation.core");
    const canSeeContact = (jobId: string, stage: string, channel: string | null) => channel === "installer_sourced" ||
      (rels ?? []).some((r) => r.job_id === jobId && (r.job_assignments as { active: boolean }).active && visitIsCurrent(r.visit_kind, stage));
    const { stageEntryBlockers } = await import("./workflow.server");
    const cards = await Promise.all((jobs ?? []).map(async (j) => {
      const e = elec?.find((x) => x.job_id === j.id);
      const deposit = (inv as unknown as { job_id: string; deposit_cleared: boolean | null }[] | null)?.find((x) => x.job_id === j.id);
      const { TRANSITIONS } = await import("./workflow.server");
      const next = TRANSITIONS[j.stage as keyof typeof TRANSITIONS]?.[0];
      const blockers = next ? await stageEntryBlockers(j.id, next).catch(() => []) : [];
      return {
        id: j.id, job_number: j.job_number, stage: j.stage, bucket: bucketFor(j.stage), next_action: j.next_action, last_activity_at: j.last_activity_at,
        channel: j.channel, relationship_owner: j.customer_relationship_owner,
        ...(canSeeContact(j.id, j.stage, j.channel)
          ? { owner: (j.owners as { full_name: string } | null)?.full_name ?? null, property: j.properties }
          : { owner: null, property: { address_line: null, suburb: (j.properties as { suburb: string | null } | null)?.suburb ?? null, postcode: (j.properties as { postcode: string | null } | null)?.postcode ?? null } }),
        electrician: e ? (e.profiles as { full_name: string | null } | null)?.full_name ?? "Assigned" : null, sla: e ? appointmentSla(e) : null,
        bookings: (bookings ?? []).filter((b) => b.job_id === j.id), proposal_pending: (props ?? []).some((x) => x.job_id === j.id), deposit_cleared: deposit?.deposit_cleared ?? null, blockers: blockers.slice(0, 3),
      };
    }));
    // Owner install days for jobs where this business is the quoted installer: days only, never owner details.
    const instJobs = [...new Set((asg ?? []).filter((a) => a.role === "installer").map((a) => a.job_id))];
    const { installerOpenDays } = await import("./install-days.server");
    const dayRows = await installerOpenDays(instJobs);
    const installDays = instJobs.map((id) => {
      const c = cards.find((x) => x.id === id);
      return { job_id: id, job_number: c?.job_number ?? null, suburb: (c?.property as { suburb?: string | null } | undefined)?.suburb ?? null, postcode: (c?.property as { postcode?: string | null } | undefined)?.postcode ?? null, days: dayRows.filter((d) => d.job_id === id).map((d) => ({ id: d.id, starts_at: d.starts_at })) };
    }).filter((x) => x.days.length);
    const { xero_contact_id: _x, xero_contact_error: _e, ...safeBiz } = business ?? ({} as never);
    return { business: safeBiz, isBizAdmin, blocker: (await import("./pilot.core")).partnerWorkBlocker(business as BusinessLike, credentials), offers: (offers ?? []).map(({ job_id, ...o }) => ({ ...o, windows: o.kind === "piesa" ? (winRows ?? []).filter((w) => w.job_id === job_id).map((w) => ({ id: w.id, starts_at: w.starts_at, ends_at: w.ends_at })) : o.kind === "ready_check" ? rcWins.filter((w) => w.job_id === job_id).map((w) => ({ id: w.id, starts_at: w.starts_at, ends_at: w.ends_at })) : [] })), jobs: cards, jobIds, installDays };
  });

export const listDraftImports = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ids = [...(await myBusinesses(context.userId)).entries()].filter(([, r]) => r === "business_admin").map(([id]) => id); // business owner only
    if (!ids.length) return [];
    const { data } = await admin.from("job_imports").select("id, source_system, method, extracted, files, source_url, external_refs, created_at, status, job_id").in("business_id", ids).order("created_at", { ascending: false }).limit(50);
    return data ?? [];
  });

// ---------- Measurement standard + partner measurement methods ----------
/** Partner documents its measurement process (draft). Only Home Insulation Victoria admin can approve it. */
export const savePartnerMethod = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    businessId: uuid, version: z.string().trim().min(1).max(40), method: z.enum(["laser", "tape", "floorplan", "other"]),
    description: z.string().trim().min(10).max(4000), tools: txt(500), zone_breakdown: z.boolean(), evidence_expected: txt(2000), exclusions_rule: txt(2000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context.supabase))) await requireMember(context.userId, data.businessId, true);
    const { businessId, ...rest } = data;
    const { error } = await admin.from("partner_measurement_methods").insert({ ...rest, tools: rest.tools ?? null, evidence_expected: rest.evidence_expected ?? null, exclusions_rule: rest.exclusions_rule ?? null, business_id: businessId, status: "draft", created_by: context.userId });
    if (error) throw new WorkflowError(error.code === "23505" ? "That version already exists – use a new version number." : error.message);
    return { ok: true };
  });

export const reviewPartnerMethod = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid, action: z.enum(["approve", "retire"]), reason: z.string().trim().min(5).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const at = new Date().toISOString();
    const patch = data.action === "approve" ? { status: "approved", approved_by: context.userId, approved_at: at, approval_reason: data.reason } : { status: "retired", approval_reason: data.reason };
    const { data: row } = await admin.from("partner_measurement_methods").update(patch).eq("id", data.id).select("business_id, version").single();
    await admin.from("admin_config_events").insert({ actor_id: context.userId, event_type: "partner_measurement_method_" + data.action, summary: `Partner measurement method ${row?.version} ${data.action}d: ${data.reason}`, details: { method_id: data.id, business_id: row?.business_id } as Json });
    return { ok: true };
  });

export const getMeasurementStandard = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { data, error } = await admin.from("workflow_settings").select("measurement_standard_version, measurement_standard_approved, measurement_standard_approved_at, measurement_variance_tolerance_pct").limit(1).single();
    if (error || !data) throw new WorkflowError(`Could not read the AP measurement standard: ${error?.message ?? "settings are missing"}`);
    return data;
  });

/** Admin-only: AP measurement standard approval and the (optional) pilot variance tolerance. */
export const setMeasurementStandard = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ version: txt(60), approved: z.boolean(), tolerancePct: z.number().min(0).max(50).nullable(), reason: z.string().trim().min(5).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    if (data.approved && !data.version) throw new WorkflowError("Give the approved measurement standard a version.");
    const { data: ws, error: settingsError } = await admin.from("workflow_settings").select("id").limit(1).single();
    if (settingsError || !ws) throw new WorkflowError(`Could not read workflow settings: ${settingsError?.message ?? "settings are missing"}`);
    const { data: saved, error: saveError } = await admin.from("workflow_settings").update({
      measurement_standard_version: data.version ?? null, measurement_standard_approved: data.approved, measurement_variance_tolerance_pct: data.tolerancePct,
      measurement_standard_approved_by: data.approved ? context.userId : null, measurement_standard_approved_at: data.approved ? new Date().toISOString() : null,
    }).eq("id", ws.id).select("id").single();
    if (saveError || saved?.id !== ws.id) throw new WorkflowError(`The AP measurement standard was not confirmed saved: ${saveError?.message ?? "settings row was not updated"}`);
    const { error: auditError } = await admin.from("admin_config_events").insert({ actor_id: context.userId, event_type: "measurement_standard_updated", summary: `Measurement standard ${data.version ?? "(none)"} ${data.approved ? "approved" : "not approved"}; tolerance ${data.tolerancePct ?? "not set"}: ${data.reason}`, details: data as unknown as Json });
    if (auditError) throw new WorkflowError(`The AP measurement standard was saved, but its audit record failed: ${auditError.message}. Review the current setting before making further changes.`);
    return { ok: true };
  });

/** Installer's own approved rate card lines (inc GST) for pricing their own customer. Never another business's rates. */
export const myInstallerRateItems = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ids = [...(await myBusinesses(context.userId)).entries()].filter(([, r]) => r === "business_admin").map(([id]) => id); // business owner only
    if (!ids.length) return { businessId: null, items: [] as { code: string; description: string; unit: string; price_inc_gst: number }[] };
    const bizId = ids[0]!;
    const [{ data: card }, { data: biz }] = await Promise.all([
      admin.from("rate_cards").select("id").eq("business_id", bizId).eq("kind", "installer").eq("is_active", true).order("version", { ascending: false }).limit(1).maybeSingle(),
      admin.from("businesses").select("gst_registered").eq("id", bizId).maybeSingle(),
    ]);
    const { data: rows } = card ? await admin.from("rate_card_items").select("code, description, unit, unit_price_ex_gst").eq("rate_card_id", card.id) : { data: [] as { code: string; description: string; unit: string; unit_price_ex_gst: number }[] };
    const gst = biz?.gst_registered !== false ? 1.1 : 1;
    return { businessId: bizId, items: (rows ?? []).map((r) => ({ code: r.code, description: r.description, unit: r.unit, price_inc_gst: Math.round(Number(r.unit_price_ex_gst) * gst * 100) / 100 })) };
  });
