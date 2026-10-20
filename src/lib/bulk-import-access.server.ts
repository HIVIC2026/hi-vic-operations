import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import { partnerWorkBlocker, type BusinessLike, type Credential } from "./pilot.core";
import { resolveBulkFile } from "./bulk-import.core";
import type { Database } from "@/integrations/supabase/types";
type BulkRowRecord = Database["public"]["Tables"]["bulk_import_rows"]["Row"];

export function checkedBulk<T>(result: { data: T; error: { message: string } | null }, operation: string): T {
  if (result.error) throw new WorkflowError(`${operation}: ${result.error.message}`);
  return result.data;
}

/** Read access requires a current Office role or active business-admin membership. Work also rechecks approval. */
export async function bulkBusinessAccess(actorId: string, businessId: string, work = false) {
  const isAdmin = checkedBulk(await admin.rpc("has_role", { _user_id: actorId, _role: "admin" }), "Could not verify Office access") === true;
  if (!isAdmin) {
    const member = checkedBulk(await admin.from("business_members").select("user_id").eq("business_id", businessId).eq("user_id", actorId).eq("active", true).eq("member_role", "business_admin").maybeSingle(), "Could not verify business-admin access");
    if (!member) throw new WorkflowError("Only an active business admin can manage this upload.");
  }
  if (work) {
    const business = checkedBulk(await admin.from("businesses").select("*").eq("id", businessId).maybeSingle(), "Could not check the current partner approval");
    const credentialsRead = await admin.from("business_credentials").select("kind,label,expires_at,critical,verification", { count: "exact" }).eq("business_id", businessId);
    const credentials = checkedBulk(credentialsRead, "Could not check the current partner credentials") ?? [];
    if (credentialsRead.count == null || credentialsRead.count !== credentials.length) throw new WorkflowError("The complete partner credential check was not available. Please try again.");
    const blocker = partnerWorkBlocker(business as BusinessLike | null, credentials as Credential[]);
    if (blocker) throw new WorkflowError(blocker);
    if (business?.business_type !== "eec_installer") throw new WorkflowError("Bulk uploads are available only for an approved installer business.");
  }
  return { isAdmin };
}

export async function bulkBatchAccess(batchId: string, actorId: string, work = false) {
  const batch = checkedBulk(await admin.from("bulk_import_batches").select("*").eq("id", batchId).maybeSingle(), "Could not read this upload");
  if (!batch) throw new WorkflowError("Upload not found.");
  const access = await bulkBusinessAccess(actorId, batch.business_id, work);
  return { batch, ...access };
}

export async function bulkRowAccess(rowId: string, actorId: string, work = false) {
  const row = checkedBulk(await admin.from("bulk_import_rows").select("*").eq("id", rowId).maybeSingle(), "Could not read this customer");
  if (!row) throw new WorkflowError("Customer not found.");
  return { row, ...await bulkBatchAccess(row.batch_id, actorId, work) };
}

/** Query all rows explicitly: PostgREST's default result cap must not turn a large upload into partial history. */
export async function allBulkRows(batchId: string) {
  const rows: BulkRowRecord[] = [];
  for (let from = 0; from < 5000; from += 500) {
    const result = await admin.from("bulk_import_rows").select("*", { count: "exact" }).eq("batch_id", batchId).order("row_index").range(from, from + 499);
    const page = checkedBulk(result, "Could not read the upload's customers") ?? [];
    rows.push(...page);
    if (result.count == null || result.count > 5000) throw new WorkflowError("The complete upload history could not be verified.");
    if (rows.length === result.count) return rows;
    if (page.length !== 500) throw new WorkflowError("The complete upload history could not be verified.");
  }
  throw new WorkflowError("The complete upload history could not be verified.");
}

/** Resolve the original manifest identity only after business/row access; never sign an arbitrary client path. */
export async function bulkFilePreview(rowId: string, originalPath: string, actorId: string) {
  const { row, batch } = await bulkRowAccess(rowId, actorId);
  const file = resolveBulkFile(batch.business_id, batch.file_manifest, row.matched_files, originalPath);
  const result = await admin.storage.from("job-files").createSignedUrl(file.storedPath, 300);
  const signed = checkedBulk(result, "This upload file could not be opened");
  if (!signed?.signedUrl) throw new WorkflowError("This upload file could not be opened.");
  return { url: signed.signedUrl };
}

/** Checked RPC boundary: new migration functions remain service-role only. */
export async function bulkRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const call = admin.rpc as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: T; error: { message: string } | null }>;
  return checkedBulk(await call.call(admin, name, args), "Could not save the upload");
}
