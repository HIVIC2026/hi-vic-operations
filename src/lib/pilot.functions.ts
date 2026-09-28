// ReInsulate pilot server functions: partner onboarding, team, import, electrician choice,
// appointment coordination, partner offers, partner pricing, partner dashboard.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { withRequestMeta } from "./request-meta";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, getStage, logEvent, requireAdmin, requireJobRole, transition } from "./workflow.server";
import {
  appointmentSla, bucketFor, confirmBlockers, electricianSelectionBlocker, extractFromCsvRow, extractFromText, mergeExtracted, offerBlocker,
  offerRespondBlocker, offerSummary, onboardingChecklist, parseCsv, partnerLineBlockers, planImportedMeasurement, proposalResponse, rankElectricians,
  relationshipOwnerFor, revisionBlocker, splitInvoicingBlocker, supplierTotal, type BusinessLike, type ConfirmedFacts, type ElecCandidate, type Extracted,
} from "./pilot.core";
import { loadBusiness, myBusinesses, requireApprovedPartner, requireMember, sha, sweepPartnerExpiry } from "./pilot.server";

const uuid = z.string().uuid();
const isAdmin = async (sb: { rpc: (n: "is_admin") => PromiseLike<{ data: unknown }> }) => !!(await sb.rpc("is_admin")).data;
const txt = (n: number) => z.string().trim().max(n).nullish();

// ---------- Business file ----------
const businessInput = z.object({
  id: uuid.optional(),
  name: z.string().trim().min(2).max(200), legal_name: txt(200), trading_name: txt(200), abn: txt(20), acn: txt(20), gst_registered: z.boolean().nullish(),
  business_type: z.enum(["eec_installer", "rec", "other"]).optional(), capabilities: z.array(z.enum(["installer", "electrician"])).max(2).optional(),
  email: txt(320), phone: txt(40), address: txt(300), contact_people: z.array(z.object({ name: z.string().max(200), role: z.string().max(100).optional(), phone: z.string().max(40).optional(), email: z.string().max(320).optional() })).max(20).optional(),
  service_postcodes: z.array(z.string().trim().max(6)).max(500).optional(), service_regions: z.array(z.string().trim().max(100)).max(100).optional(),
  weekly_capacity: z.number().int().min(0).max(1000).nullish(), lead_time_days: z.number().int().min(0).max(180).nullish(), availability_notes: txt(2000),
  rec_number: txt(50), licence_number: txt(50), installer_certification: z.record(z.string(), z.string().max(500)).optional(),
  branding: z.object({ logo_url: z.string().url().max(1000).optional(), colour: z.string().max(20).optional() }).optional(),
  default_comms_owner: z.enum(["installer", "hivic"]).optional(), commercial_route: z.enum(["hivic_full_invoice", "split_invoicing"]).optional(),
});
const CRITICAL_FIELDS = ["legal_name", "abn", "acn", "rec_number", "licence_number", "business_type", "capabilities", "commercial_route"] as const;

export const saveBusiness = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => businessInput.parse(d))
  .handler(async ({ data, context }) => {
    const adminUser = await isAdmin(context.supabase);
    const sb = splitInvoicingBlocker(data.commercial_route);
    if (sb) throw new WorkflowError(sb);
    const { id, ...patch } = data;
    if (!id) {
      if (!adminUser) throw new WorkflowError("Only HI VIC can create a partner business.");
      const { data: row, error } = await admin.from("businesses").insert({ ...patch, business_type: patch.business_type ?? "eec_installer" } as never).select("id").single();
      if (error) throw new WorkflowError(error.message);
      return { id: row.id };
    }
    if (!adminUser) {
      await requireMember(context.userId, id, true);
      delete (patch as Record<string, unknown>)["commercial_route"]; // commercial route is HI VIC-controlled
    }
    const { data: before } = await admin.from("businesses").select("*").eq("id", id).single();
    if (!before) throw new WorkflowError("Business not found");
    const criticalChanged = CRITICAL_FIELDS.some((k) => k in patch && JSON.stringify((patch as Record<string, unknown>)[k]) !== JSON.stringify((before as Record<string, unknown>)[k]));
    const extra = !adminUser && criticalChanged && before.onboarding_status === "approved" ? { onboarding_status: "submitted", onboarding_notes: "Compliance details changed by partner – HI VIC re-approval required" } : {};
    const { error } = await admin.from("businesses").update({ ...patch, ...extra, updated_at: new Date().toISOString() } as never).eq("id", id);
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
    return { ok: true };
  });

export const addCredential = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid, profileId: uuid.nullish(), kind: z.enum(["public_liability_insurance", "workers_comp_insurance", "other_insurance", "electrical_licence", "rec_registration", "installer_certification", "business_registration", "other"]), label: z.string().trim().min(2).max(200), number: txt(100), issuer: txt(200), expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), critical: z.boolean().default(true), document_path: txt(500) }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context.supabase))) await requireMember(context.userId, data.businessId);
    if (data.document_path && !data.document_path.startsWith(`partners/${data.businessId}/`)) throw new WorkflowError("Invalid document path");
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
    if (!(await isAdmin(context.supabase))) await requireMember(context.userId, data.businessId);
    const path = `partners/${data.businessId}/${data.folder}/${crypto.randomUUID()}-${data.fileName.replace(/[^\w.\-]+/g, "_")}`;
    const { data: s, error } = await admin.storage.from("job-files").createSignedUploadUrl(path);
    if (error) throw new WorkflowError(error.message);
    return { path, token: s.token };
  });

export const partnerFileUrl = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid, path: z.string().max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context.supabase))) await requireMember(context.userId, data.businessId);
    if (!data.path.startsWith(`partners/${data.businessId}/`)) throw new WorkflowError("Invalid path");
    const { data: s, error } = await admin.storage.from("job-files").createSignedUrl(data.path, 300);
    if (error) throw new WorkflowError(error.message);
    return { url: s.signedUrl };
  });

export const setBankDetails = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid, account_name: z.string().trim().min(2).max(200), bsb: z.string().regex(/^\d{3}-?\d{3}$/), account_number: z.string().regex(/^\d{5,10}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    if (!(await isAdmin(context.supabase))) await requireMember(context.userId, data.businessId, true);
    await admin.from("business_bank_details").upsert({ business_id: data.businessId, account_name: data.account_name, bsb: data.bsb, account_number: data.account_number, updated_by: context.userId, updated_at: new Date().toISOString() });
    return { ok: true };
  });

/** Masked for partners; full only to HI VIC admin. */
export const getBankDetails = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const adminUser = await isAdmin(context.supabase);
    if (!adminUser) await requireMember(context.userId, data.businessId);
    const { data: b } = await admin.from("business_bank_details").select("account_name,bsb,account_number,updated_at").eq("business_id", data.businessId).maybeSingle();
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
    if (!t) throw new WorkflowError("HI VIC has not approved the partner participation agreement yet.");
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
    const { data: p } = await admin.from("profiles").select("id, business_id").ilike("email", data.email).maybeSingle();
    if (!p) throw new WorkflowError("No portal account uses that email yet. Ask them to sign up first, then add them.");
    if (p.business_id && p.business_id !== data.businessId && !adminUser) throw new WorkflowError("That person already belongs to another business.");
    await admin.from("business_members").upsert({ business_id: data.businessId, user_id: p.id, member_role: data.memberRole, active: true, added_by: context.userId }, { onConflict: "business_id,user_id" });
    if (!p.business_id) await admin.from("profiles").update({ business_id: data.businessId }).eq("id", p.id);
    // Trade roles give job access only through assignments. Partners may grant their own staff a trade role; HI VIC approval still gates the business.
    if (data.tradeRole !== "none") await admin.from("user_roles").upsert({ user_id: p.id, role: data.tradeRole }, { onConflict: "user_id,role" });
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
    if (!adminUser && !mine.has(id)) throw new WorkflowError("Not your business.");
    const { business, credentials } = await loadBusiness(id);
    if (!business) return null;
    const [{ data: creds }, { data: members }, { data: rels }, { data: agreements }, { data: cards }, { data: electricians }] = await Promise.all([
      admin.from("business_credentials").select("*").eq("business_id", id).order("created_at"),
      admin.from("business_members").select("user_id, member_role, active, profiles!business_members_user_id_fkey(full_name, email)").eq("business_id", id),
      admin.from("partner_relationships").select("id, electrician_business_id, preferred, active, businesses!partner_relationships_electrician_business_id_fkey(name, onboarding_status)").eq("installer_business_id", id),
      admin.from("partner_agreements").select("version, signer_name, signed_at, snapshot_sha256").eq("business_id", id).order("signed_at", { ascending: false }),
      admin.from("rate_cards").select("id, kind, name, version, effective_from, is_active").eq("business_id", id).order("version", { ascending: false }),
      admin.from("businesses").select("id, name, onboarding_status, business_type, capabilities").or("business_type.eq.rec,capabilities.cs.{electrician}"),
    ]);
    const { data: methods } = await admin.from("partner_measurement_methods").select("*").eq("business_id", id).order("created_at", { ascending: false });
    const checklist = onboardingChecklist(business as BusinessLike, credentials, !!agreements?.length);
    const { xero_contact_id: _x, xero_contact_error: _e, ...safe } = business;
    return { business: adminUser ? business : safe, credentials: creds ?? [], members: members ?? [], relationships: rels ?? [], agreements: agreements ?? [], rateCards: cards ?? [], electricianBusinesses: electricians ?? [], measurementMethods: methods ?? [], checklist, myRole: adminUser ? "hivic_admin" : mine.get(id) };
  });

// ---------- Import ----------
export const createImport = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    businessId: uuid, sourceSystem: z.enum(["easymate", "manual_import", "csv", "email"]).default("manual_import"),
    text: z.string().max(100_000).optional(), csv: z.string().max(500_000).optional(), csvRow: z.number().int().min(0).max(5000).default(0),
    sourceUrl: z.string().trim().url().max(1000).optional(), externalRefs: z.record(z.string(), z.string().max(200)).optional(),
    files: z.array(z.object({ path: z.string().max(500), name: z.string().max(200), type: z.string().max(100) })).max(30).default([]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireMember(context.userId, data.businessId);
    await requireApprovedPartner(data.businessId);
    for (const f of data.files) if (!f.path.startsWith(`partners/${data.businessId}/imports/`)) throw new WorkflowError("Invalid file path");
    const parts: Extracted[] = [];
    if (data.csv) { const rows = parseCsv(data.csv); const r = rows[data.csvRow]; if (!r) throw new WorkflowError("That CSV row was not found."); parts.push(extractFromCsvRow(r)); }
    if (data.text) parts.push(extractFromText(data.text));
    const extracted = mergeExtracted(...parts);
    if (data.externalRefs && !extracted.external_reference?.value) { const v = Object.values(data.externalRefs)[0]; if (v) extracted.external_reference = { value: v, confidence: "found", source: "reference field" }; }
    // URLs are stored as a source reference only – never fetched or scraped.
    const method = data.csv ? "csv" : data.text ? "text" : data.files.length ? "files" : "reference";
    const { data: row, error } = await admin.from("job_imports").insert({
      business_id: data.businessId, created_by: context.userId, source_system: data.csv ? (data.sourceSystem === "manual_import" ? "csv" : data.sourceSystem) : data.sourceSystem, method,
      raw_text: [data.text, data.csv].filter(Boolean).join("\n---\n") || null, source_url: data.sourceUrl ?? null, external_refs: (data.externalRefs ?? {}) as Json,
      files: data.files as unknown as Json, extracted: extracted as unknown as Json,
    }).select("id").single();
    if (error) throw new WorkflowError(error.message);
    return { id: row.id, extracted };
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
  .inputValidator((d) => z.object({ importId: uuid, facts: z.record(z.string(), factValue) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: imp } = await admin.from("job_imports").select("*").eq("id", data.importId).single();
    if (!imp || imp.status !== "draft") throw new WorkflowError("This import was already confirmed or discarded.");
    await requireMember(context.userId, imp.business_id);
    const biz = await requireApprovedPartner(imp.business_id);
    const { data: isInstaller } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "installer" });
    if (!isInstaller) throw new WorkflowError("Only installer team members can confirm imported jobs.");
    const c = data.facts as ConfirmedFacts;
    const blockers = confirmBlockers(c);
    if (blockers.length) throw new WorkflowError(blockers.join(" • "));
    const { upsertEnquiry } = await import("./enquiry.server");
    const s = (k: keyof ConfirmedFacts) => (c[k] == null || c[k] === "" ? null : String(c[k]));
    const res = await upsertEnquiry({
      full_name: s("full_name")!, email: s("email")!, phone: s("phone"), address_line: s("address_line")!, suburb: s("suburb"), postcode: s("postcode"),
      estimated_area_m2: c.measured_area_m2 ? Number(c.measured_area_m2) : null, area_unknown: !c.measured_area_m2,
    }, "installer_import", context.userId, { channel: "installer_sourced", businessId: imp.business_id, userId: context.userId });
    const refs = { ...(imp.external_refs as Record<string, unknown>), ...(s("external_reference") ? { reference: s("external_reference") } : {}), ...(imp.source_url ? { source_url: imp.source_url } : {}), import_id: imp.id };
    const rel = relationshipOwnerFor("installer_sourced", biz.default_comms_owner);
    const pilotInvoice = biz.commercial_route === "hivic_full_invoice";
    await admin.from("jobs").update({ customer_relationship_owner: rel, source_system: imp.source_system, external_refs: refs as Json,
      ...(pilotInvoice ? { commercial_model: "hivic_invoices_owner" as const, commercial_model_set_by: context.userId, commercial_model_set_at: new Date().toISOString() } : {}) }).eq("id", res.job_id);
    await admin.from("job_assignments").insert({ job_id: res.job_id, user_id: context.userId, role: "installer", business_id: imp.business_id, assigned_by: context.userId, first_response_at: new Date().toISOString() });
    const { data: ws } = await admin.from("workflow_settings").select("measurement_standard_approved").limit(1).maybeSingle();
    const { data: pm } = await admin.from("partner_measurement_methods").select("id").eq("business_id", imp.business_id).eq("status", "approved").order("approved_at", { ascending: false }).limit(1).maybeSingle();
    const m = planImportedMeasurement(c, imp.id, { businessId: imp.business_id, standardApproved: !!ws?.measurement_standard_approved && !!pm });
    if (m) {
      await admin.from("ceiling_measurements").update({ is_current: false }).eq("job_id", res.job_id).eq("is_current", true);
      await admin.from("ceiling_measurements").insert({ ...m, supplied_snapshot: m.supplied_snapshot as unknown as Json, partner_method_id: pm?.id ?? null, review_flags: m.review_flags as unknown as Json, job_id: res.job_id, is_current: true, created_by: context.userId, raw_snapshot: { import_id: imp.id, confirmed: c, extracted: imp.extracted } as unknown as Json });
      await admin.from("jobs").update({ measure_up_responsibility: "installer" }).eq("id", res.job_id);
    }
    await admin.from("job_imports").update({ status: "confirmed", confirmed_facts: c as Json, confirmed_by: context.userId, confirmed_at: new Date().toISOString(), job_id: res.job_id, updated_at: new Date().toISOString() }).eq("id", imp.id);
    await logEvent(res.job_id, context.userId, "job_imported", `Imported from ${imp.source_system} by originating installer (confirmed by user)`, { import_id: imp.id, source_system: imp.source_system, external_refs: refs, relationship_owner: rel, measurement_imported: !!m, files: imp.files });
    if (pilotInvoice) await logEvent(res.job_id, context.userId, "commercial_model_set", "Pilot commercial route: full job invoiced by HI VIC (split invoicing disabled)", { route: "hivic_full_invoice" });
    return { jobId: res.job_id, jobNumber: res.job_number };
  });

// ---------- Electrician selection ----------
async function electricianCandidates(jobId: string) {
  const { data: j } = await admin.from("jobs").select("originating_installer_business_id, properties(postcode, suburb)").eq("id", jobId).single();
  const { data: inst } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
  const installerBiz = inst?.business_id ?? j?.originating_installer_business_id ?? null;
  const { data: bizs } = await admin.from("businesses").select("*").or("business_type.eq.rec,capabilities.cs.{electrician}");
  const ids = (bizs ?? []).map((b) => b.id);
  const [{ data: creds }, { data: rels }, { data: cards }, { data: load }] = await Promise.all([
    admin.from("business_credentials").select("business_id,kind,label,expires_at,critical,verification").in("business_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
    installerBiz ? admin.from("partner_relationships").select("electrician_business_id, preferred").eq("installer_business_id", installerBiz).eq("active", true) : Promise.resolve({ data: [] as { electrician_business_id: string; preferred: boolean }[] }),
    admin.from("rate_cards").select("business_id").eq("kind", "electrical").eq("is_active", true),
    admin.from("job_assignments").select("business_id").eq("role", "electrician").eq("active", true),
  ]);
  const cands: ElecCandidate[] = (bizs ?? []).map((b) => ({
    ...(b as unknown as BusinessLike), id: b.id, name: b.trading_name || b.name, weekly_capacity: b.weekly_capacity, lead_time_days: b.lead_time_days,
    credentials: (creds ?? []).filter((c) => c.business_id === b.id), preferred: !!rels?.some((r) => r.electrician_business_id === b.id && r.preferred),
    hasRates: !!cards?.some((c) => c.business_id === b.id), activeJobs: (load ?? []).filter((l) => l.business_id === b.id).length,
  }));
  const p = j?.properties as { postcode: string | null; suburb: string | null } | null;
  return { cands, site: { postcode: p?.postcode ?? null, suburb: p?.suburb ?? null }, installerBiz };
}

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
    await admin.from("jobs").update({ electrician_choice: data.choice }).eq("id", data.jobId);
    if (data.choice === "hivic_organise") { await logEvent(data.jobId, context.userId, "electrician_choice", "HI VIC asked to organise an electrician"); return { ok: true, assigned: false }; }
    if (data.choice === "nominated") {
      if (!data.nomination) throw new WorkflowError("Enter the electrician's details.");
      const { data: inst } = await admin.from("job_assignments").select("business_id").eq("job_id", data.jobId).eq("role", "installer").eq("active", true).maybeSingle();
      // Internal record only: no invitation is sent while customer communications are locked.
      await admin.from("electrician_nominations").insert({ contact_name: data.nomination.contact_name, business_name: data.nomination.business_name ?? null, email: data.nomination.email ?? null, phone: data.nomination.phone ?? null, licence_number: data.nomination.licence_number ?? null, rec_number: data.nomination.rec_number ?? null, nominated_for: data.nomination.nominated_for, job_id: data.jobId, nominated_by: context.userId, nominating_business_id: inst?.business_id ?? null, status: "invite_pending_comms" });
      await logEvent(data.jobId, context.userId, "electrician_nominated", `Electrician nominated: ${data.nomination.contact_name} – waiting for HI VIC onboarding (not yet approved)`);
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
  const now = new Date().toISOString();
  await admin.from("job_assignments").update({ active: false, ended_at: now, end_reason: "reassigned" }).eq("job_id", jobId).eq("role", "electrician").eq("active", true);
  await admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", jobId).eq("kind", "assessment").eq("status", "proposed");
  await admin.from("job_assignments").insert({ job_id: jobId, user_id: userId, role: "electrician", business_id: businessId, assigned_by: actorId });
  await logEvent(jobId, actorId, "contractor_assigned", `Electrician assigned: ${summary}`);
  if ((await getStage(jobId)) === "awaiting_electrician") await transition(jobId, "assessment_booking", actorId, "Electrician assigned – coordinate the site visit");
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
    if (role !== "admin" && !sla.canRequestAnother) throw new WorkflowError("You can request another electrician after 48 hours without a confirmed time, or if the electrician says they cannot attend.");
    const now = new Date().toISOString();
    await admin.from("job_assignments").update({ active: false, ended_at: now, end_reason: `replacement requested by ${role}: ${data.reason}` }).eq("id", a.id);
    await admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", data.jobId).eq("status", "proposed");
    await admin.from("reassignment_requests").insert({ job_id: data.jobId, role: "electrician", requested_by: context.userId, reason: data.reason } as never);
    await admin.from("jobs").update({ electrician_choice: null, next_action: "Choose another electrician" }).eq("id", data.jobId);
    await logEvent(data.jobId, context.userId, "electrician_replacement_requested", `${role} requested another electrician (${sla.message})`, { reason: data.reason, previous_assignment: a.id });
    return { ok: true };
  });

// ---------- Appointment coordination ----------
export const proposeTime = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, kind: z.enum(["assessment", "rectification", "installation"]).default("assessment"), start: z.string().datetime({ offset: true }), note: txt(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await requireJobRole(context.supabase, data.jobId, ["admin", "owner", "electrician", "installer"]);
    if (Date.parse(data.start) <= Date.now()) throw new WorkflowError("Propose a time in the future.");
    const { data: a } = await admin.from("job_assignments").select("id, user_id, first_response_at").eq("job_id", data.jobId).eq("role", data.kind === "installation" ? "installer" : "electrician").eq("active", true).maybeSingle();
    if (!a) throw new WorkflowError("No trade is assigned yet.");
    await admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", data.jobId).eq("kind", data.kind).eq("status", "proposed");
    await admin.from("appointment_proposals").insert({ job_id: data.jobId, kind: data.kind, assignment_id: a.id, proposed_by: context.userId, proposer_role: role, starts_at: data.start, note: data.note ?? null });
    if (a.user_id === context.userId && !a.first_response_at) await admin.from("job_assignments").update({ first_response_at: new Date().toISOString() }).eq("id", a.id);
    await logEvent(data.jobId, context.userId, "appointment_proposed", `${role} proposed ${new Date(data.start).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })} for ${data.kind}`, { note: data.note });
    return { ok: true };
  });

export const respondToProposal = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ proposalId: uuid, action: z.enum(["accept", "decline"]), note: txt(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: p } = await admin.from("appointment_proposals").select("*").eq("id", data.proposalId).single();
    if (!p) throw new WorkflowError("Proposal not found.");
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
      admin.from("appointment_proposals").select("id, kind, proposer_role, starts_at, note, status, response_note, created_at").eq("job_id", data.jobId).order("created_at", { ascending: false }).limit(30),
    ]);
    return { role, electrician: a ? { name: (a.profiles as { full_name: string | null } | null)?.full_name ?? "Electrician", sla: appointmentSla(a) } : null, proposals: props ?? [] };
  });

// ---------- Offers of HI VIC jobs to partners ----------
export const offerToPartner = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, businessId: uuid, expiresInDays: z.number().int().min(1).max(30).default(3) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const biz = await requireApprovedPartner(data.businessId);
    const { data: j } = await admin.from("jobs").select("job_number, stage, channel, estimated_area_m2, eligibility_outcome, properties(suburb, postcode)").eq("id", data.jobId).single();
    if (!j) throw new WorkflowError("Job not found");
    const [{ count: inst }, { count: pend }, { data: m }] = await Promise.all([
      admin.from("job_assignments").select("id", { count: "exact", head: true }).eq("job_id", data.jobId).eq("role", "installer").eq("active", true),
      admin.from("partner_offers").select("id", { count: "exact", head: true }).eq("job_id", data.jobId).eq("status", "pending"),
      admin.from("ceiling_measurements").select("measured_area_m2, status").eq("job_id", data.jobId).eq("is_current", true).maybeSingle(),
    ]);
    const b = offerBlocker({ channel: j.channel, stage: j.stage, hasActiveInstaller: !!inst, hasPendingOffer: !!pend });
    if (b) throw new WorkflowError(b);
    const p = j.properties as { suburb: string | null; postcode: string | null } | null;
    const summary = offerSummary({ job_number: j.job_number, stage: j.stage, suburb: p?.suburb ?? null, postcode: p?.postcode ?? null, estimated_area_m2: j.estimated_area_m2, measured_area_m2: m?.status === "complete" ? m.measured_area_m2 : null, eligibility_outcome: j.eligibility_outcome });
    await admin.from("partner_offers").insert({ job_id: data.jobId, business_id: data.businessId, summary: summary as unknown as Json, offered_by: context.userId, expires_at: new Date(Date.now() + data.expiresInDays * 86_400_000).toISOString() });
    await logEvent(data.jobId, context.userId, "partner_offer_made", `Job offered to ${biz.name} (acquisition channel stays HI VIC-sourced)`);
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
  .inputValidator((d) => z.object({ offerId: uuid, accept: z.boolean(), reason: txt(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: o } = await admin.from("partner_offers").select("*").eq("id", data.offerId).single();
    if (!o) throw new WorkflowError("Offer not found.");
    await requireMember(context.userId, o.business_id);
    const b = offerRespondBlocker(o);
    if (b) { if (b.includes("expired")) await admin.from("partner_offers").update({ status: "expired" }).eq("id", o.id); throw new WorkflowError(b); }
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
    // Channel and relationship owner are NOT changed: HI VIC acquired this customer.
    await logEvent(o.job_id, context.userId, "partner_offer_accepted", "Partner accepted the job – installer assigned (still HI VIC-sourced, HI VIC relationship owner)");
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
    const { data: offers } = await admin.from("partner_offers").select("id, status, summary, offered_at, expires_at").eq("business_id", bizId).eq("status", "pending");
    let q = admin.from("job_assignments").select("job_id, user_id, role").eq("business_id", bizId).eq("active", true);
    if (!isBizAdmin) q = q.eq("user_id", context.userId);
    const { data: asg } = await q;
    const jobIds = [...new Set((asg ?? []).map((a) => a.job_id))];
    const none = ["00000000-0000-0000-0000-000000000000"];
    const [{ data: jobs }, { data: elec }, { data: bookings }, { data: inv }] = await Promise.all([
      admin.from("jobs").select("id, job_number, stage, next_action, last_activity_at, channel, customer_relationship_owner, owners(full_name), properties(address_line, suburb, postcode)").in("id", jobIds.length ? jobIds : none),
      admin.from("job_assignments").select("job_id, assigned_at, first_response_at, booking_confirmed_at, cannot_attend_at, profiles!job_assignments_user_id_fkey(full_name)").eq("role", "electrician").eq("active", true).in("job_id", jobIds.length ? jobIds : none),
      admin.from("bookings").select("job_id, kind, scheduled_start").eq("status", "confirmed").in("job_id", jobIds.length ? jobIds : none),
      admin.from("invoice_status" as never).select("job_id, deposit_cleared" as never).in("job_id" as never, (jobIds.length ? jobIds : none) as never),
    ]);
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
        owner: (j.owners as { full_name: string } | null)?.full_name ?? null, property: j.properties,
        electrician: e ? (e.profiles as { full_name: string | null } | null)?.full_name ?? "Assigned" : null, sla: e ? appointmentSla(e) : null,
        bookings: (bookings ?? []).filter((b) => b.job_id === j.id), deposit_cleared: deposit?.deposit_cleared ?? null, blockers: blockers.slice(0, 3),
      };
    }));
    const { xero_contact_id: _x, xero_contact_error: _e, ...safeBiz } = business ?? ({} as never);
    return { business: safeBiz, isBizAdmin, blocker: (await import("./pilot.core")).partnerWorkBlocker(business as BusinessLike, credentials), offers: offers ?? [], jobs: cards, jobIds };
  });

export const listDraftImports = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ids = [...(await myBusinesses(context.userId)).keys()];
    if (!ids.length) return [];
    const { data } = await admin.from("job_imports").select("id, source_system, method, extracted, files, source_url, external_refs, created_at, status, job_id").in("business_id", ids).order("created_at", { ascending: false }).limit(50);
    return data ?? [];
  });

// ---------- Measurement standard + partner measurement methods ----------
/** Partner documents its measurement process (draft). Only HI VIC admin can approve it. */
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
    const { data } = await admin.from("workflow_settings").select("measurement_standard_version, measurement_standard_approved, measurement_standard_approved_at, measurement_variance_tolerance_pct").limit(1).single();
    return data;
  });

/** Admin-only: AP measurement standard approval and the (optional) pilot variance tolerance. */
export const setMeasurementStandard = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ version: txt(60), approved: z.boolean(), tolerancePct: z.number().min(0).max(50).nullable(), reason: z.string().trim().min(5).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    if (data.approved && !data.version) throw new WorkflowError("Give the approved measurement standard a version.");
    const { data: ws } = await admin.from("workflow_settings").select("id").limit(1).single();
    if (!ws) throw new WorkflowError("Workflow settings missing.");
    await admin.from("workflow_settings").update({
      measurement_standard_version: data.version ?? null, measurement_standard_approved: data.approved, measurement_variance_tolerance_pct: data.tolerancePct,
      measurement_standard_approved_by: data.approved ? context.userId : null, measurement_standard_approved_at: data.approved ? new Date().toISOString() : null,
    }).eq("id", ws.id);
    await admin.from("admin_config_events").insert({ actor_id: context.userId, event_type: "measurement_standard_updated", summary: `Measurement standard ${data.version ?? "(none)"} ${data.approved ? "approved" : "not approved"}; tolerance ${data.tolerancePct ?? "not set"}: ${data.reason}`, details: data as unknown as Json });
    return { ok: true };
  });
