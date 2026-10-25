// Pure rules shared by the install-complete "All done" email (O44) and the completion pack (O47).
// Decision 321 (Jo 25 Oct 2026): the manufacturer warranty PDF goes with O44 at install complete and
// `warranty_copy_provided` is recorded THEN (so the automatic AP signature no longer waits for full payment); the
// completion pack still attaches it after full payment but never records it a second time.
// Decision 322: the Certificate of Electrical Safety file the electrician uploaded in the A4 fixes form (kept on the job by
// fixes-day.server.ts) is attached to the completion pack when present. No I/O here.
import type { SendEventNames } from "./send-outcome.core";

/** The completion pack email's provider idempotency key (also the guarded sender's reservation key). */
export const COMPLETION_PACK_EMAIL_KEY = (jobId: string) => `completion-pack:v1:${jobId}`;
/** Written only after a confirmed send (completion-pack.server). */
export const COMPLETION_PACK_SENT_EVENT = "completion_pack_sent";
/** Review R04: a definite delivery failure (retried later, same key) and an unknown outcome (never resent; Needs me). */
export const COMPLETION_PACK_SEND_FAILED_EVENT = "completion_pack_send_failed";
export const COMPLETION_PACK_SEND_UNKNOWN_EVENT = "completion_pack_send_unknown";
/** The pack's reservation is the guarded sender's own (no separate attempt event), so it has no "pending" state. */
export const COMPLETION_PACK_SEND_EVENTS: SendEventNames = { attempt: null, sent: COMPLETION_PACK_SENT_EVENT, failed: COMPLETION_PACK_SEND_FAILED_EVENT, unknown: COMPLETION_PACK_SEND_UNKNOWN_EVENT };
export const COMPLETION_PACK_UNKNOWN_LINE = "Completion pack email · no clear answer from the email service · not resent · check the email service and the owner";

/** A guarded owner send (sendOwnerTemplateEmail / test-send) went out. */
export const ownerEmailSent = (result: string) => result === "sent" || /^sent\b/.test(result);

export type WarrantyRecordVia = "all_done_email" | "completion_pack" | "warranty_followup";
export const WARRANTY_VIA_LABEL: Record<WarrantyRecordVia, string> = { all_done_email: "the All done email", completion_pack: "the completion pack", warranty_followup: "the warranty follow-up email (decision 363)" };

/** Record `warranty_copy_provided` only for a real send that carried every installed product's warranty, and only once per job. */
export function shouldRecordWarrantyProvided(x: { sent: boolean; recordProvided: boolean; alreadyRecorded: boolean }): boolean {
  return x.sent && x.recordProvided && !x.alreadyRecorded;
}

// ---------- CoES with the completion pack (decision 322) ----------
/** Email attachment budget for CoES files (the warranty PDFs come first; providers cap total size around 40 MB). */
export const COES_ATTACH_MAX_BYTES = 10 * 1024 * 1024;
export type CoesDoc = { storage_path: string; mime_type: string | null; size_bytes: number | null; created_at: string };
export type CoesPlanItem = { path: string; filename: string; contentType: string };

const extOf = (mime: string) => (mime.includes("pdf") ? "pdf" : mime.includes("png") ? "png" : mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : null);

/** Which kept CoES files go with the pack: PDF/JPG/PNG only, oldest first, within the size budget; the rest are listed as skipped. */
export function coesAttachmentPlan(docs: readonly CoesDoc[], maxBytes = COES_ATTACH_MAX_BYTES): { attach: CoesPlanItem[]; skipped: { path: string; reason: string }[] } {
  const attach: CoesPlanItem[] = [];
  const skipped: { path: string; reason: string }[] = [];
  let used = 0;
  const sorted = [...docs].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.storage_path.localeCompare(b.storage_path));
  for (const d of sorted) {
    const mime = (d.mime_type ?? "").toLowerCase();
    const ext = extOf(mime);
    if (!ext) { skipped.push({ path: d.storage_path, reason: `not a PDF or photo (${d.mime_type ?? "unknown type"})` }); continue; }
    const size = d.size_bytes ?? 0;
    if (used + size > maxBytes) { skipped.push({ path: d.storage_path, reason: "too large to email — it stays on the job page" }); continue; }
    used += size;
    const n = attach.length + 1;
    attach.push({ path: d.storage_path, filename: `Certificate-of-Electrical-Safety${sorted.length > 1 ? `-${n}` : ""}.${ext}`, contentType: ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "image/jpeg" });
  }
  return { attach, skipped };
}

/** Fully paid = cumulative payments on the installation invoice reach its total (decision 139 ledger; `total_paid` never drops). */
export function invoiceFullyPaid(inv: { total_inc_gst: number | string | null; total_paid: number | string | null } | null | undefined): boolean {
  if (!inv) return false;
  const total = Number(inv.total_inc_gst ?? 0), paid = Number(inv.total_paid ?? 0);
  return total > 0 && paid + 0.005 >= total;
}
