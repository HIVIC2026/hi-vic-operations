// RPC for the slim bulk installer import. Installer members upload for their own approved business;
// the office can upload on behalf of any approved installer business. Nothing is sent to customers.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { myBusinesses, requireApprovedPartner, requireMember } from "./pilot.server";
import { WorkflowError } from "./workflow.server";
import { CONTACT_PERMISSION_WORDING } from "./bulk-import.core";
import type { Json } from "@/integrations/supabase/types";
import { hashToken, newToken } from "./worker-links.core";

const uuid = z.string().uuid();
const rawRow = z.record(z.string(), z.string());
const manifestFile = z.object({
  path: z.string().max(1000), name: z.string().max(300), folder: z.string().max(500).nullable().optional(),
  type: z.string().max(100).nullable().optional(),
  gps_lat: z.number().nullable().optional(), gps_lng: z.number().nullable().optional(),
  taken_at: z.string().max(60).nullable().optional(),
  geo_address: z.string().max(300).nullable().optional(),
});
const fileRead = z.object({ name: z.string().max(1000), status: z.enum(["ok", "warn", "error"]), message: z.string().max(500) });

async function canUseBulkImport(userId: string, businessId: string, onBehalf: boolean) {
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (onBehalf) {
    if (!isAdmin) throw new WorkflowError("Only the office can upload on behalf of an installer.");
  } else {
    await requireMember(userId, businessId, true); // boss only (matches route-guards INSTALLER_BOSS_ONLY)
  }
  await requireApprovedPartner(businessId);
  return !!isAdmin;
}

export const createBulkBatch = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    businessId: uuid,
    onBehalf: z.boolean().default(false),
    listFilename: z.string().min(1).max(300),
    rawRows: z.array(rawRow).max(5000).default([]),
    documents: z.array(z.object({ name: z.string().max(300), text: z.string().max(200_000) })).max(500).default([]),
    permissionConfirmed: z.literal(true, { errorMap: () => ({ message: "Please tick to confirm these customers are happy for Home Insulation Victoria to contact them." }) }),
    manifest: z.array(manifestFile).max(5000).default([]),
    fileReads: z.array(fileRead).max(5000).default([]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await canUseBulkImport(context.userId, data.businessId, data.onBehalf);
    const { data: batch, error } = await admin.from("bulk_import_batches").insert({
      business_id: data.businessId, created_by: context.userId, on_behalf: data.onBehalf,
      list_filename: data.listFilename, file_manifest: data.manifest as unknown as Json,
      summary: {
        raw_rows: data.rawRows, documents: data.documents, file_reads: data.fileReads,
        permission: { confirmed_by: context.userId, confirmed_at: new Date().toISOString(), wording: CONTACT_PERMISSION_WORDING },
      } as unknown as Json,
    }).select("id").single();
    if (error || !batch) throw new WorkflowError(error?.message ?? "Upload could not be saved.");
    const { logPartner } = await import("./pilot.server");
    await logPartner(null, context.userId, "bulk_import_permission", CONTACT_PERMISSION_WORDING, { batch_id: batch.id, confirmed_by: context.userId });
    const { analyseBatch } = await import("./bulk-import.server");
    const summary = await analyseBatch(batch.id, context.userId);
    return { batchId: batch.id, summary };
  });

export const bulkBatchReview = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ batchId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: batch } = await admin.from("bulk_import_batches").select("*").eq("id", data.batchId).single();
    if (!batch) throw new WorkflowError("Upload not found.");
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) await requireMember(context.userId, batch.business_id, true);
    const { data: rows } = await admin.from("bulk_import_rows").select("*").eq("batch_id", data.batchId).order("row_index");
    const { data: biz } = await admin.from("businesses").select("name").eq("id", batch.business_id).single();
    return { batch, rows: rows ?? [], businessName: biz?.name ?? "" };
  });

export const confirmBulkBatch = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    batchId: uuid, skipRowIds: z.array(uuid).default([]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: batch } = await admin.from("bulk_import_batches").select("*").eq("id", data.batchId).single();
    if (!batch) throw new WorkflowError("Upload not found.");
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) await requireMember(context.userId, batch.business_id, true);
    const { confirmBatch } = await import("./bulk-import.server");
    return confirmBatch(data.batchId, context.userId, data.skipRowIds);
  });

const electricianPlan = z.object({ mode: z.enum(["mine", "hivic", "job_by_job"]), nomination_id: uuid.nullable().optional(), business_id: uuid.nullable().optional() });
export const setBulkReviewPlan = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ batchId: uuid, batchPlan: electricianPlan, rows: z.array(z.object({ rowId: uuid, stage: z.enum(["not_visited", "visited", "quoted", "installed"]), plan: electricianPlan.nullable(),
    siteCheck: z.enum(["yes", "no"]).nullable().optional(), siteCheckDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() })).max(5000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: batch } = await admin.from("bulk_import_batches").select("business_id,status").eq("id", data.batchId).single();
    if (!batch || batch.status !== "analysed") throw new WorkflowError("This upload can no longer be changed.");
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) await requireMember(context.userId, batch.business_id, true);
    await admin.from("bulk_import_batches").update({ electrician_plan: data.batchPlan as unknown as Json }).eq("id", data.batchId);
    const { stageForSiteCheck } = await import("./bulk-import.core");
    const { data: existing } = await admin.from("bulk_import_rows").select("id, extracted, import_stage").eq("batch_id", data.batchId);
    const byId = new Map((existing ?? []).map((r) => [r.id, r]));
    for (const row of data.rows) {
      const cur = byId.get(row.rowId);
      if (!cur) continue;
      const e = (cur.extracted ?? {}) as Record<string, unknown>;
      // Site check answered on the review screen (Jo, 7 Oct): Yes skips the Ready Check, No goes to it.
      const answered = row.siteCheck !== undefined && row.siteCheck !== (e["site_check"] ?? null);
      const check = row.siteCheck !== undefined ? row.siteCheck : (e["site_check"] as "yes" | "no" | null) ?? null;
      const date = check === "yes" ? (row.siteCheckDate !== undefined ? row.siteCheckDate : (e["site_check_date"] as string | null) ?? null) : null;
      const priced = Number(e["price_inc_gst"] ?? 0) > 0;
      const stage = row.stage === "installed" ? "installed" : stageForSiteCheck(check, priced, cur.import_stage as never);
      await admin.from("bulk_import_rows").update({
        import_stage: stage, electrician_plan: row.plan as unknown as Json,
        extracted: { ...e, site_check: check, site_check_date: date, site_check_source: answered ? "asked" : e["site_check_source"] ?? null, lead_stage: stage } as unknown as Json,
      }).eq("id", row.rowId).eq("batch_id", data.batchId);
    }
    return { ok: true };
  });

export const bulkElectricianChoices = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) await requireMember(context.userId, data.businessId, true);
    const [{ data: rels }, { data: nominations }] = await Promise.all([
      admin.from("partner_relationships").select("electrician_business_id,is_primary,businesses!partner_relationships_electrician_business_id_fkey(name,trading_name,onboarding_status)").eq("installer_business_id", data.businessId).eq("active", true),
      admin.from("electrician_nominations").select("id,contact_name,business_name,status,business_id").eq("nominating_business_id", data.businessId).is("job_id", null).is("ended_at", null).order("created_at", { ascending: false }),
    ]);
    return { approved: (rels ?? []).map((r) => ({ businessId: r.electrician_business_id, primary: r.is_primary, name: (r.businesses as { trading_name?: string | null; name?: string } | null)?.trading_name || (r.businesses as { name?: string } | null)?.name || "Your electrician", status: "Already signed up ✓" })), pending: (nominations ?? []).filter((n) => !n.business_id).map((n) => ({ nominationId: n.id, name: n.contact_name, business: n.business_name, status: n.status })) };
  });

export const addBulkElectrician = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid, name: z.string().trim().min(2).max(200), mobile: z.string().trim().min(8).max(40), email: z.string().trim().email().max(320).nullable().optional(), business: z.string().trim().max(200).nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireMember(context.userId, data.businessId, true);
    const mobile = data.mobile.replace(/\D/g, "");
    let ownQuery = admin.from("electrician_nominations").select("id,contact_name,business_id,status").eq("nominating_business_id", data.businessId).is("job_id", null).is("ended_at", null);
    ownQuery = data.email ? ownQuery.or(`phone.eq.${mobile},email.ilike.${data.email.replace(/[%_,]/g, "")}`) : ownQuery.eq("phone", mobile);
    const { data: own } = await ownQuery.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (own) return { nominationId: own.id, businessId: own.business_id, name: own.contact_name, status: own.business_id ? "Already signed up ✓" : `Waiting for ${own.contact_name} to sign up` };
    let matchQuery = admin.from("businesses").select("id").eq("onboarding_status", "approved");
    matchQuery = data.email ? matchQuery.or(`phone.eq.${mobile},email.ilike.${data.email.replace(/[%_,]/g, "")}`) : matchQuery.eq("phone", mobile);
    const { data: matched } = await matchQuery.limit(1).maybeSingle();
    const invite = newToken();
    const { data: nomination, error } = await admin.from("electrician_nominations").insert({
      contact_name: data.name, phone: mobile, email: data.email ?? null, business_name: data.business ?? null,
      nominating_business_id: data.businessId, nominated_by: context.userId, nominated_for: "installer",
      business_id: matched?.id ?? null, status: matched?.id ? "teamed" : "invite_pending_comms",
      invite_token_hash: matched?.id ? null : await hashToken(invite), invite_expires_at: matched?.id ? null : new Date(Date.now() + 14 * 86_400_000).toISOString(),
    }).select("id").single();
    if (error || !nomination) throw new WorkflowError("That electrician could not be added.");
    return { nominationId: nomination.id, businessId: matched?.id ?? null, name: data.name, status: matched?.id ? "Already signed up ✓" : `Waiting for ${data.name} to sign up` };
  });

export const setBulkRowAddress = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    rowId: uuid,
    address_line: z.string().trim().min(3).max(200),
    suburb: z.string().trim().max(100).nullable(),
    postcode: z.string().trim().regex(/^3\d{3}$/, "Enter a 4-digit Victorian postcode"),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await admin.from("bulk_import_rows").select("batch_id").eq("id", data.rowId).single();
    if (!row) throw new WorkflowError("Row not found.");
    const { data: batch } = await admin.from("bulk_import_batches").select("business_id").eq("id", row.batch_id).single();
    if (!batch) throw new WorkflowError("Upload not found.");
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) await requireMember(context.userId, batch.business_id, true);
    const { setRowAddress } = await import("./bulk-import.server");
    return setRowAddress(data.rowId, { address_line: data.address_line, suburb: data.suburb || null, postcode: data.postcode });
  });

export const listBulkBatches = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid.optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (data.businessId) {
      if (!isAdmin) await requireMember(context.userId, data.businessId, true);
      const { data: rows } = await admin.from("bulk_import_batches").select("id, status, list_filename, summary, created_at, on_behalf").eq("business_id", data.businessId).order("created_at", { ascending: false }).limit(50);
      return { batches: rows ?? [], isAdmin: !!isAdmin };
    }
    if (isAdmin) {
      const { data: rows } = await admin.from("bulk_import_batches").select("id, business_id, status, list_filename, summary, created_at, on_behalf, businesses(name)").order("created_at", { ascending: false }).limit(50);
      return { batches: rows ?? [], isAdmin: true };
    }
    const biz = await myBusinesses(context.userId);
    const ids = [...biz.keys()];
    if (ids.length === 0) return { batches: [], isAdmin: false };
    const { data: rows } = await admin.from("bulk_import_batches").select("id, business_id, status, list_filename, summary, created_at, on_behalf").in("business_id", ids).order("created_at", { ascending: false }).limit(50);
    return { batches: rows ?? [], isAdmin: false };
  });

/** Approved installer businesses for the office "on behalf" picker. */
export const bulkImportBusinesses = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) {
      const biz = await myBusinesses(context.userId);
      const out = [];
      for (const [id] of biz) {
        const { data: b } = await admin.from("businesses").select("id, name").eq("id", id).single();
        if (b) out.push(b);
      }
      return { businesses: out, isAdmin: false };
    }
    const { data: bizList } = await admin.from("businesses").select("id, name").eq("business_type", "eec_installer").eq("onboarding_status", "approved").order("name");
    return { businesses: bizList ?? [], isAdmin: true };
  });

/** AI reading of one uploaded PDF/photo (text or scanned) for the bulk upload. Nothing is stored or sent. */
export const readBulkFile = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    businessId: uuid, onBehalf: z.boolean().default(false), name: z.string().min(1).max(1000),
    mime: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
    base64: z.string().min(1).max(14_000_000),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await canUseBulkImport(context.userId, data.businessId, data.onBehalf);
    const { aiReadMedia } = await import("./bulk-import.server");
    const text = await aiReadMedia(data.name, data.mime, data.base64);
    return { text: /^NONE\b/i.test(text) ? "" : text, description: /^NONE\b/i.test(text) ? text.replace(/^NONE\W*/i, "").slice(0, 120) : "" };
  });

/** Approximate street address for photo GPS points (matching only, never evidence). */
export const geocodeBulkPhotos = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    businessId: uuid, onBehalf: z.boolean().default(false),
    points: z.array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })).max(40),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await canUseBulkImport(context.userId, data.businessId, data.onBehalf);
    const { reverseGeocode } = await import("./bulk-import.server");
    return { addresses: await reverseGeocode(data.points) };
  });
