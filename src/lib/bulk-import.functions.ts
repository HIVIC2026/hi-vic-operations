// RPC for the slim bulk installer import. Installer members upload for their own approved business;
// the office can upload on behalf of any approved installer business. Nothing is sent to customers.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { myBusinesses, requireApprovedPartner, requireMember } from "./pilot.server";
import { WorkflowError } from "./workflow.server";
import type { Json } from "@/integrations/supabase/types";

const uuid = z.string().uuid();
const rawRow = z.record(z.string(), z.string());
const manifestFile = z.object({
  path: z.string().max(1000), name: z.string().max(300), folder: z.string().max(500).nullable().optional(),
  type: z.string().max(100).nullable().optional(),
  gps_lat: z.number().nullable().optional(), gps_lng: z.number().nullable().optional(),
  taken_at: z.string().max(60).nullable().optional(),
});

async function canUseBulkImport(userId: string, businessId: string, onBehalf: boolean) {
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (onBehalf) {
    if (!isAdmin) throw new WorkflowError("Only the office can upload on behalf of an installer.");
  } else {
    await requireMember(userId, businessId);
  }
  await requireApprovedPartner(businessId);
  return !!isAdmin;
}

export const createBulkBatch = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    businessId: uuid,
    onBehalf: z.boolean().default(false),
    listFilename: z.string().min(1).max(300),
    rawRows: z.array(rawRow).min(1).max(2000),
    manifest: z.array(manifestFile).max(5000).default([]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await canUseBulkImport(context.userId, data.businessId, data.onBehalf);
    const { data: batch, error } = await admin.from("bulk_import_batches").insert({
      business_id: data.businessId, created_by: context.userId, on_behalf: data.onBehalf,
      list_filename: data.listFilename, file_manifest: data.manifest as unknown as Json,
      summary: { raw_rows: data.rawRows } as unknown as Json,
    }).select("id").single();
    if (error || !batch) throw new WorkflowError(error?.message ?? "Upload could not be saved.");
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
    if (!isAdmin) await requireMember(context.userId, batch.business_id);
    const { data: rows } = await admin.from("bulk_import_rows").select("*").eq("batch_id", data.batchId).order("row_index");
    const { data: biz } = await admin.from("businesses").select("name").eq("id", batch.business_id).single();
    return { batch, rows: rows ?? [], businessName: biz?.name ?? "" };
  });

export const confirmBulkBatch = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    batchId: uuid, skipRowIds: z.array(uuid).default([]),
    permissionConfirmed: z.literal(true, { errorMap: () => ({ message: "You must confirm you have each owner's permission for us to contact them." }) }),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: batch } = await admin.from("bulk_import_batches").select("*").eq("id", data.batchId).single();
    if (!batch) throw new WorkflowError("Upload not found.");
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!isAdmin) await requireMember(context.userId, batch.business_id);
    const { confirmBatch } = await import("./bulk-import.server");
    const res = await confirmBatch(data.batchId, context.userId, data.skipRowIds);
    const { logEvent } = await import("./workflow.server");
    await logEvent(null, context.userId, "bulk_import_permission", "Installer confirmed they have each owner's permission to be contacted", { batch_id: data.batchId, confirmed_by: context.userId });
    return res;
  });

export const listBulkBatches = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ businessId: uuid.optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (data.businessId) {
      if (!isAdmin) await requireMember(context.userId, data.businessId);
      const { data } = await admin.from("bulk_import_batches").select("id, status, list_filename, summary, created_at, on_behalf").eq("business_id", data.businessId).order("created_at", { ascending: false }).limit(50);
      return { batches: data ?? [], isAdmin: !!isAdmin };
    }
    if (isAdmin) {
      const { data } = await admin.from("bulk_import_batches").select("id, business_id, status, list_filename, summary, created_at, on_behalf, businesses(name)").order("created_at", { ascending: false }).limit(50);
      return { batches: data ?? [], isAdmin: true };
    }
    const biz = await myBusinesses(context.userId);
    const ids = [...biz.keys()];
    if (ids.length === 0) return { batches: [], isAdmin: false };
    const { data } = await admin.from("bulk_import_batches").select("id, business_id, status, list_filename, summary, created_at, on_behalf").in("business_id", ids).order("created_at", { ascending: false }).limit(50);
    return { batches: data ?? [], isAdmin: false };
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
    const { data } = await admin.from("businesses").select("id, name").eq("business_type", "eec_installer").eq("onboarding_status", "approved").order("name");
    return { businesses: data ?? [], isAdmin: true };
  });
