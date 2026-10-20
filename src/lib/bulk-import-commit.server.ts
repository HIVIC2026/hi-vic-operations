// The actual confirmation path: read/validate outside locks; all multi-table writes inside fenced row transactions.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { allBulkRows, bulkBatchAccess, bulkRowAccess, bulkRpc, checkedBulk } from "./bulk-import-access.server";
import { customerDetailsReason, outsideVictoria, quotedGap, siteCheckFromFile, resolveBulkFile, type BulkExtracted, type BulkCounts, type FileMatch } from "./bulk-import.core";
import { bulkQuotePlan, stagePlacement } from "./bulk-import.server";
import { QUOTED_ANSWER_NEEDED, QUOTE_NEEDED_LABEL } from "./bulk-import.core";
import { allowedUpload } from "./upload-safety.core";
import { verifyStoredUpload } from "./upload-safety.server";
import { hashToken, newToken } from "./worker-links.core";
import { WorkflowError } from "./workflow.server";

type Row = { id: string; batch_id: string; status: string; job_id: string | null; row_index: number; extracted: BulkExtracted;
  import_stage: keyof typeof stagePlacement; matched_files: FileMatch[]; duplicate_note: string | null; sort_result: string;
  confirm_snapshot?: { extracted: BulkExtracted; electrician_plan: unknown } | null; electrician_plan?: unknown; missing_evidence: unknown };
type VerifiedFile = { originalPath: string; storedPath?: string; name: string; mime?: string; omitted?: "unsupported_type" };

async function sourceForBulk(actorId: string, businessId: string) {
  const [authResult, businessResult] = await Promise.all([
    admin.auth.admin.getUserById(actorId), admin.from("businesses").select("name,onboarding_notes").eq("id", businessId).single(),
  ]);
  const user = checkedBulk(authResult as { data: { user: { email?: string; user_metadata?: Record<string, unknown> } | null }; error: { message: string } | null }, "Could not check the intake identity").user;
  const business = checkedBulk(businessResult, "Could not check the intake business");
  if (!user || !business) throw new WorkflowError("The intake source could not be verified.");
  return user.user_metadata?.["qa_test"] === true || /@hivic-test\.example$/i.test(user.email ?? "") || /^TEST\b/i.test(business.name) || (business.onboarding_notes ?? "").includes("[TEST PARTNER]") ? "qa_test" : "bulk_import";
}

export async function verifyBulkFiles(batch: { business_id: string; file_manifest: unknown }, row: { matched_files: FileMatch[] }, renew?: () => Promise<unknown>) {
  const out: VerifiedFile[] = [];
  const manifest = Array.isArray(batch.file_manifest) ? batch.file_manifest as { path: string; type?: string }[] : [];
  for (const matched of row.matched_files ?? []) {
    if (renew) await renew();
    const entry = manifest.find(f => f.path === matched.path);
    const mime = allowedUpload(matched.name, entry?.type ?? null, { imports: true });
    if (!mime) { out.push({ originalPath: matched.path, name: matched.name, omitted: "unsupported_type" }); continue; }
    // Missing stored paths are retryable errors, never a successfully confirmed omission of a supported file.
    const file = resolveBulkFile(batch.business_id, batch.file_manifest, row.matched_files, matched.path);
    await verifyStoredUpload("job-files", file.storedPath, mime, { deleteInvalid: false });
    out.push({ originalPath: file.originalPath, storedPath: file.storedPath, name: file.name, mime });
  }
  return out;
}

function blocker(row: Row, batchPermission: unknown): string | null {
  const e = row.confirm_snapshot?.extracted ?? row.extracted;
  const details = customerDetailsReason(e); if (details) return details;
  const permission = (e as BulkExtracted & { owner_consent?: unknown }).owner_consent ?? batchPermission;
  if (!permission || permission === false || !(permission as { confirmed_by?: string }).confirmed_by || !(permission as { confirmed_at?: string }).confirmed_at) return "Owner contact permission is not confirmed on this customer.";
  if (e.quoted_answer === "yes") { const gap = quotedGap(e.quoted_answer,e.price_inc_gst); if (gap) return gap; }
  if (siteCheckFromFile(e).check == null && row.import_stage !== "installed") return "Tell us whether you have already done the site check (Yes or No).";
  if (row.sort_result === "office_review" && !row.job_id) return "This customer needs Office review before confirmation.";
  return null;
}

export async function confirmBulkWithClaims(batchId: string, actorId: string, skipRowIds: string[]) {
  const { batch } = await bulkBatchAccess(batchId, actorId, true);
  if (batch.status !== "analysed") throw new WorkflowError("This upload is finished or is not ready to confirm.");
  const rows = (await allBulkRows(batchId) as unknown as Row[]).filter(r => r.status === "pending");
  const batchPermission = (batch.summary as { permission?: unknown } | null)?.permission;
  let created = 0, skipped = 0, failed = 0, alreadyTaken = 0;
  const incomplete: { row: number; jobNumber?: string | null; reason: string }[] = [];
  const results: { row: number; jobNumber: string; quote: "draft_saved" | "office_quotes" | "not_quoted"; attached: string[]; notAttached: string[] }[] = [];
  const ownerLinks: { jobNumber: string; owner: string; path: string }[] = [];
  for (const listed of rows) {
    const token = crypto.randomUUID();
    const row = await bulkRpc<Row | null>("claim_bulk_import_row", { _row: listed.id, _actor: actorId, _token: token });
    if (!row) { alreadyTaken++; continue; }
    let job: { id: string; job_number: string } | null = null;
    try {
      const e = row.confirm_snapshot?.extracted ?? row.extracted;
      // Claim first: another tab cannot skip a row while its job is being created. Partial jobs are never duplicates of themselves.
      if (!row.job_id && (skipRowIds.includes(row.id) || row.duplicate_note || outsideVictoria(e.postcode))) {
        await bulkRpc("release_bulk_import_row", { _row: row.id, _actor: actorId, _token: token, _error: null, _skip: true });
        skipped++; continue;
      }
      const reason = blocker(row,batchPermission); if (reason) throw new WorkflowError(reason);
      const placement = stagePlacement[row.import_stage];
      if (!placement) throw new WorkflowError("This customer's import stage is not recognised.");
      const prepared = await bulkRpc<{ job: { id: string; job_number: string }; resumed: boolean }>("prepare_bulk_import_job", {
        _row: row.id, _actor: actorId, _token: token, _job_input: {
          stage: placement.stage, source: await sourceForBulk(actorId,batch.business_id),
          installer_site_check: siteCheckFromFile(e).check, installer_site_check_date: siteCheckFromFile(e).date,
          installer_quoted: e.quoted_answer ?? null, installer_quoted_price_inc_gst: e.quoted_answer === "yes" ? e.price_inc_gst ?? null : null,
          installer_price_includes: e.quoted_answer === "yes" ? e.price_includes ?? null : null,
          next_action: row.import_stage === "installed" ? placement.next : e.quoted_answer == null ? `${placement.next} · ${QUOTED_ANSWER_NEEDED}` : e.quoted_answer === "no" ? `${placement.next} · ${QUOTE_NEEDED_LABEL}` : placement.next,
        },
      });
      job = prepared.job;
      const files = await verifyBulkFiles(batch,row,() => bulkRpc("renew_bulk_import_row", { _row: row.id, _actor: actorId, _token: token }));
      const quote = row.import_stage === "quoted" ? await bulkQuotePlan(job.id,e,actorId,batch.business_id) : null;
      const ownerToken = newToken();
      const finished = await bulkRpc<{ quoted: boolean; ownerLinkCreated: boolean; attached: string[]; notAttached: string[] }>("finish_bulk_import_row", {
        _row: row.id, _actor: actorId, _token: token, _quote: quote, _files: files,
        _owner_link: { token_hash: await hashToken(ownerToken), expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString() },
        _audit: { sort_result: row.sort_result, missing_evidence: row.missing_evidence, import_stage: row.import_stage, electrician_plan: row.confirm_snapshot?.electrician_plan ?? row.electrician_plan ?? batch.electrician_plan, resumed: prepared.resumed },
      });
      created++;
      if (finished.ownerLinkCreated) ownerLinks.push({ jobNumber: job.job_number, owner: e.full_name ?? "Customer", path: `/eligibility/${ownerToken}` });
      results.push({ row: row.row_index + 1, jobNumber: job.job_number, quote: row.import_stage === "quoted" ? finished.quoted ? "draft_saved" : "office_quotes" : "not_quoted", attached: finished.attached, notAttached: finished.notAttached });
    } catch (error) {
      failed++;
      let reason = error instanceof Error ? error.message : "This customer could not be finished.";
      try { await bulkRpc("release_bulk_import_row", { _row: row.id, _actor: actorId, _token: token, _error: reason, _skip: false }); }
      catch (releaseError) {
        // A stale worker cannot clear a successor. A failed reason write is reported, never silently discarded.
        reason += ` The confirmation claim or failure record could not be updated: ${releaseError instanceof Error ? releaseError.message : "refresh this upload"}.`;
      }
      incomplete.push({ row: row.row_index + 1, jobNumber: job?.job_number ?? null, reason });
    }
  }
  // Atomic server-side count/close. An unavailable count remains unknown and leaves a visible retry instruction.
  try {
    const counts = await bulkRpc<BulkCounts>("close_bulk_import_batch", { _batch: batchId, _actor: actorId });
    return { created, skipped, failed, alreadyTaken, remaining: counts.pending, remainingUnknown: false, counts, ownerLinks, incomplete, results };
  } catch (error) {
    return { created, skipped, failed, alreadyTaken, remaining: null, remainingUnknown: true, counts: null, ownerLinks, incomplete, results,
      closeError: error instanceof Error ? error.message : "The upload completion count could not be checked." };
  }
}

export async function repairConfirmedBulkFiles(rowId: string, actorId: string) {
  const { row, batch, isAdmin } = await bulkRowAccess(rowId,actorId,true);
  if (!isAdmin) throw new WorkflowError("Only Office can repair completed upload files.");
  if (batch.status !== "confirmed" || row.status !== "confirmed" || !row.job_id) throw new WorkflowError("This customer is not a completed upload job.");
  const files = await verifyBulkFiles(batch,{ matched_files: row.matched_files as unknown as FileMatch[] });
  const repairs: string[] = [];
  for (const file of files) if (!file.omitted) repairs.push(await bulkRpc<string>("repair_bulk_import_attachment", { _row: rowId, _actor: actorId, _file: file }));
  return { checked: files.length, repairRecords: repairs.length, unsupported: files.filter(f => f.omitted).map(f => f.originalPath) };
}
