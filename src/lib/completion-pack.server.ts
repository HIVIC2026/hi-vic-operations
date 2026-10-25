// Completion pack (O47, decision 103) — the one workflow sender. Jo 25 Oct 2026 (VEU checklist G1): the pack carries the
// manufacturer warranty PDF for the product(s) actually installed and files the copy on the job (documents kind
// `product_warranty`). Decision 321: the SAME PDF now goes first with the "All done" email (O44) at install complete and
// `warranty_copy_provided` is recorded at THAT send (`recordWarrantyCopyProvided`, via all_done_email), so the AP
// auto-signature (decision 271) no longer waits for full payment; the pack still attaches it but only records it when no
// earlier send did (never twice). When a product's PDF is not on file the email still sends, nothing is recorded and the AP
// signature keeps holding with "Warranty copy for <product> not on file".
// Decision 322: the Certificate of Electrical Safety file(s) kept from the electrician's A5 fixes form (fixes-day.server.ts,
// documents titled FIXES_COES_DOC_TITLE) are attached to the pack when present (pure plan: completion-pack.core).
// When: install recorded complete AND the installation invoice paid in full (O45 wording: "Once it's paid, we'll send your
// completion pack"). Once per job (`completion_pack_sent` event, written only after a confirmed send). Delivery stays behind
// COMPLETION_EMAILS_APPROVED + customer_comms_enabled + consent through sendOwnerTemplateEmail; TEST jobs use test-send.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { WARRANTY_COPY_PROVIDED_EVENT, warrantyProvidedSummary, type ProductWarranty, type WarrantyAttachDecision } from "./product-warranty.core";
import { WARRANTY_VIA_LABEL, coesAttachmentPlan, ownerEmailSent, shouldRecordWarrantyProvided, type WarrantyRecordVia } from "./completion-pack.core";
import type { EmailAttachment } from "./email-kit.core";

export const COMPLETION_PACK_SENT_EVENT = "completion_pack_sent";
export const COMPLETION_PACK_NOT_SENT_EVENT = "completion_pack_email_not_sent";
/** Only jobs completed this recently are swept (older completions were handled before this sender existed). */
const SWEEP_WINDOW_MS = 60 * 86400_000;

async function alreadySent(jobId: string): Promise<boolean> {
  const { data } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", COMPLETION_PACK_SENT_EVENT).limit(1);
  return (data ?? []).length > 0;
}

/** Fully paid = cumulative payments on the installation invoice reach its total (decision 139 ledger; `total_paid` never drops). */
async function invoicePaidInFull(jobId: string): Promise<boolean> {
  const { data: inv } = await admin.from("invoices").select("total_inc_gst, total_paid").eq("job_id", jobId).eq("kind", "installation").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!inv) return false;
  const total = Number(inv.total_inc_gst ?? 0), paid = Number(inv.total_paid ?? 0);
  return total > 0 && paid + 0.005 >= total;
}

async function warrantyAlreadyRecorded(jobId: string): Promise<boolean> {
  const { data } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", WARRANTY_COPY_PROVIDED_EVENT).limit(1);
  return (data ?? []).length > 0;
}

/**
 * Decision 321: the ONE place `warranty_copy_provided` is written — after a confirmed owner send (O44 at install complete, or
 * O47 if O44 did not carry it) that attached every installed product's warranty, and only once per job. Then the AP
 * auto-signature is tried at once (best-effort). Returns whether it was recorded now.
 */
export async function recordWarrantyCopyProvided(jobId: string, actorId: string | null, x: { via: WarrantyRecordVia; result: string; decision: WarrantyAttachDecision & { products: string[] }; attached: ProductWarranty[]; missing: unknown[] }): Promise<boolean> {
  const recordProvided = x.decision.products.length > 0 && x.missing.length === 0 && x.attached.length > 0;
  if (!shouldRecordWarrantyProvided({ sent: ownerEmailSent(x.result), recordProvided, alreadyRecorded: await warrantyAlreadyRecorded(jobId) })) return false;
  await logEvent(jobId, actorId, WARRANTY_COPY_PROVIDED_EVENT, `${warrantyProvidedSummary(x.attached)} (${WARRANTY_VIA_LABEL[x.via]})`, { via: x.via, products: x.decision.products, documents: x.attached.map((w) => ({ family: w.family, manufacturer: w.manufacturer, attachment: w.attachmentName })) });
  // Decision 271: the AP signature may now be applied at once rather than on the next tick. Best-effort.
  try { await (await import("./veec-ap-auto.server")).tryAutoApSignature(jobId); } catch (e) { console.error(`${x.via}: AP auto signature check skipped`, (e as Error).message); }
  return true;
}

/** Decision 322: the CoES file(s) the electrician uploaded in the A5 fixes form, as email attachments (none when absent). Never throws. */
export async function coesAttachmentsFor(jobId: string): Promise<{ attachments: EmailAttachment[]; names: string[]; skipped: { path: string; reason: string }[] }> {
  const none = { attachments: [] as EmailAttachment[], names: [] as string[], skipped: [] as { path: string; reason: string }[] };
  try {
    const { FIXES_COES_DOC_KIND, FIXES_COES_DOC_TITLE } = await import("./fixes-day.core");
    const { data: docs } = await admin.from("documents").select("storage_path, mime_type, size_bytes, created_at").eq("job_id", jobId).eq("kind", FIXES_COES_DOC_KIND).eq("source_system", "mitti").eq("title", FIXES_COES_DOC_TITLE);
    const plan = coesAttachmentPlan((docs ?? []) as { storage_path: string; mime_type: string | null; size_bytes: number | null; created_at: string }[]);
    const out = { ...none, skipped: [...plan.skipped] };
    for (const item of plan.attach) {
      const { data: blob } = await admin.storage.from("job-files").download(item.path);
      if (!blob) { out.skipped.push({ path: item.path, reason: "file could not be read" }); continue; }
      out.attachments.push({ filename: item.filename, content: Buffer.from(new Uint8Array(await (blob as Blob).arrayBuffer())).toString("base64"), contentType: item.contentType });
      out.names.push(item.filename);
    }
    return out;
  } catch (e) {
    console.error("completion pack: CoES attachment skipped", jobId, (e as Error).message);
    return none;
  }
}

export type CompletionPackResult = { outcome: "sent" | "skipped" | "not_sent"; detail: string; warranties: { attached: string[]; missing: string[]; recorded: boolean }; coes?: string[] };

/** Sends the completion pack for one job when due. Idempotent. Never throws for a business reason. */
export async function sendCompletionPack(jobId: string, actorId: string | null = null): Promise<CompletionPackResult> {
  const none = { attached: [] as string[], missing: [] as string[], recorded: false };
  const { data: job } = await admin.from("jobs").select("installation_completed_at, deleted_at").eq("id", jobId).maybeSingle();
  if (!job || job.deleted_at) return { outcome: "skipped", detail: "no job", warranties: none };
  if (!job.installation_completed_at) return { outcome: "skipped", detail: "install not recorded complete", warranties: none };
  if (await alreadySent(jobId)) return { outcome: "skipped", detail: "already sent", warranties: none };
  if (!(await invoicePaidInFull(jobId))) return { outcome: "skipped", detail: "invoice not paid in full", warranties: none };

  const { warrantyDecisionFor, prepareWarrantyCopies } = await import("./product-warranty.server");
  const decision = await warrantyDecisionFor(jobId);
  const copies = await prepareWarrantyCopies(jobId, actorId, decision);
  const attachedNames = copies.attached.map((w) => w.productName);
  const missingProducts = copies.missing.map((m) => m.product);
  if (copies.missing.length) await logEvent(jobId, actorId, "product_warranty_missing", `Completion pack: no warranty document on file for ${missingProducts.join(", ")} — sent without it; the AP signature holds until a copy is given and recorded`, { missing: copies.missing, products: decision.products }, { internal: true });

  const { emailOwnerCompletionPack } = await import("./approved-owner-emails.server");
  const link = await (await import("./veec-copy-email.server")).ownerMyJobLink(jobId);
  const downloads = { certificateUrl: null, invoiceUrl: null, warrantiesUrl: link ? `${link}?screen=done` : null, signedFormsUrl: link ? `${link}?screen=done` : null };
  const coes = await coesAttachmentsFor(jobId);
  const r = await emailOwnerCompletionPack(jobId, downloads, undefined, { attachments: [...copies.attachments, ...coes.attachments], attachedWarranties: attachedNames, attachedCoes: coes.names.length > 0 });
  const sent = ownerEmailSent(r);
  const warranties = { attached: attachedNames, missing: missingProducts, recorded: false };
  if (!sent) return { outcome: "not_sent", detail: r, warranties, coes: coes.names };

  await logEvent(jobId, actorId, COMPLETION_PACK_SENT_EVENT, `Completion pack emailed to the owner${attachedNames.length ? ` with the ${attachedNames.join(" and ")} manufacturer warranty attached` : ""}${coes.names.length ? `${attachedNames.length ? " and" : " with"} the Certificate of Electrical Safety attached` : ""}`, { result: r, attached: attachedNames, missing: missingProducts, products: decision.products, coes_attached: coes.names, coes_not_attached: coes.skipped });
  // Decision 321: normally already recorded by the All done email at install complete — recorded here only if it was not.
  warranties.recorded = await recordWarrantyCopyProvided(jobId, actorId, { via: "completion_pack", result: r, decision, attached: copies.attached, missing: copies.missing });
  return { outcome: "sent", detail: r, warranties, coes: coes.names };
}

/** 15-minute tick: every recently completed, fully paid job without a completion pack yet. */
export async function sweepCompletionPacks(): Promise<{ checked: number; sent: number; notSent: number }> {
  const since = new Date(Date.now() - SWEEP_WINDOW_MS).toISOString();
  const { data: jobs } = await admin.from("jobs").select("id").not("installation_completed_at", "is", null).gte("installation_completed_at", since).is("deleted_at", null);
  let sent = 0, notSent = 0;
  for (const j of jobs ?? []) {
    try {
      const r = await sendCompletionPack(j.id);
      if (r.outcome === "sent") sent++;
      else if (r.outcome === "not_sent") notSent++;
    } catch (e) { notSent++; console.error("completion pack failed", j.id, (e as Error).message); }
  }
  return { checked: (jobs ?? []).length, sent, notSent };
}
