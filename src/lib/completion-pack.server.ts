// Completion pack (O47, decision 103) — the one workflow sender. Jo 25 Oct 2026 (VEU checklist G1): the pack carries the
// manufacturer warranty PDF for the product(s) actually installed and files the copy on the job (documents kind
// `product_warranty`). Decision 321: the SAME PDF now goes first with the "All done" email (O44) at install complete and
// `warranty_copy_provided` is recorded at THAT send (`recordWarrantyCopyProvided`, via all_done_email), so the AP
// auto-signature (decision 271) no longer waits for full payment; the pack still attaches it but only records it when no
// earlier send did (never twice). When a product's PDF is not on file the email still sends, nothing is recorded and the AP
// signature keeps holding with "Warranty copy for <product> not on file".
// Decision 322: the Certificate of Electrical Safety file(s) kept from the electrician's A4 fixes form (fixes-day.server.ts,
// documents titled FIXES_COES_DOC_TITLE) are attached to the pack when present (pure plan: completion-pack.core).
// When: install recorded complete AND the installation invoice paid in full (O45 wording: "Once it's paid, we'll send your
// completion pack"). Once per job (`completion_pack_sent` event, written only after a confirmed send). Delivery stays behind
// COMPLETION_EMAILS_APPROVED + customer_comms_enabled + consent through sendOwnerTemplateEmail; TEST jobs use test-send.
// Review R04: the pack shared the "a failed send is consumed for good" defect through the guarded sender's reservation —
// a definite failure now re-claims it and retries with the SAME key after a growing wait (`completion_pack_send_failed`),
// an unknown outcome is never resent and raises one Needs me row (`completion_pack_send_unknown`); send-outcome.core.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { WARRANTY_COPY_PROVIDED_EVENT, warrantyProvidedSummary, type ProductWarranty, type WarrantyAttachDecision } from "./product-warranty.core";
import { COMPLETION_PACK_EMAIL_KEY, COMPLETION_PACK_SENT_EVENT, COMPLETION_PACK_SEND_EVENTS, COMPLETION_PACK_SEND_FAILED_EVENT, COMPLETION_PACK_SEND_UNKNOWN_EVENT, WARRANTY_VIA_LABEL, coesAttachmentPlan, invoiceFullyPaid, ownerEmailSent, shouldRecordWarrantyProvided, type WarrantyRecordVia } from "./completion-pack.core";
import type { EmailAttachment } from "./email-kit.core";
import { classifyEmailLogStatus, classifyTemplateSendResult, deliveryFromEvents, retryWaitBlocker, type SendEvent, type SendOutcome } from "./send-outcome.core";

export { COMPLETION_PACK_SENT_EVENT, COMPLETION_PACK_SEND_FAILED_EVENT, COMPLETION_PACK_SEND_UNKNOWN_EVENT, COMPLETION_PACK_SEND_EVENTS };
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
  return invoiceFullyPaid(inv);
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

/** Decision 322: the CoES file(s) the electrician uploaded in the A4 fixes form, as email attachments (none when absent). Never throws. */
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

async function packSendEvents(jobId: string): Promise<SendEvent[]> {
  const { data, error } = await admin.from("workflow_events").select("event_type, created_at, details").eq("job_id", jobId).in("event_type", [COMPLETION_PACK_SENT_EVENT, COMPLETION_PACK_SEND_FAILED_EVENT, COMPLETION_PACK_SEND_UNKNOWN_EVENT]).order("created_at", { ascending: true });
  if (error) throw new Error(`Completion pack could not read its earlier attempts: ${error.message}`);
  return (data ?? []) as SendEvent[];
}

/** Sends the completion pack for one job when due. Idempotent. Never throws for a business reason. */
export async function sendCompletionPack(jobId: string, actorId: string | null = null, now = new Date()): Promise<CompletionPackResult> {
  const none = { attached: [] as string[], missing: [] as string[], recorded: false };
  const { data: job } = await admin.from("jobs").select("installation_completed_at, deleted_at, source").eq("id", jobId).maybeSingle();
  if (!job || job.deleted_at) return { outcome: "skipped", detail: "no job", warranties: none };
  if (!job.installation_completed_at) return { outcome: "skipped", detail: "install not recorded complete", warranties: none };
  if (await alreadySent(jobId)) return { outcome: "skipped", detail: "already sent", warranties: none };
  if (!(await invoicePaidInFull(jobId))) return { outcome: "skipped", detail: "invoice not paid in full", warranties: none };
  // Review R04: an unknown outcome is never resent (office row); a definite failure waits 1h, 2h, 4h … before the retry.
  const delivery = deliveryFromEvents(await packSendEvents(jobId), COMPLETION_PACK_SEND_EVENTS);
  if (delivery.state === "unknown") return { outcome: "skipped", detail: "delivery uncertain — not resent; office to check", warranties: none };
  const wait = retryWaitBlocker(delivery, now.toISOString());
  if (wait) return { outcome: "skipped", detail: wait, warranties: none };

  const { warrantyDecisionFor, prepareWarrantyCopies } = await import("./product-warranty.server");
  const decision = await warrantyDecisionFor(jobId);
  const copies = await prepareWarrantyCopies(jobId, actorId, decision);
  const attachedNames = copies.attached.map((w) => w.productName);
  const missingProducts = copies.missing.map((m) => m.product);
  if (copies.missing.length) await logEvent(jobId, actorId, "product_warranty_missing", `Completion pack: no warranty document on file for ${missingProducts.join(", ")} — sent without it; the AP signature holds until a copy is given and recorded`, { missing: copies.missing, products: decision.products }, { internal: true });

  const { emailOwnerCompletionPack } = await import("./approved-owner-emails.server");
  // Link check (Jo 27 Oct 2026): My job doesn't list documents, so no row links there; warranties are attached, forms were emailed when signed.
  const downloads = { certificateUrl: null, invoiceUrl: null, warrantiesUrl: null, signedFormsUrl: null };
  const coes = await coesAttachmentsFor(jobId);
  const test = job.source === "qa_test";
  const { classifyProviderStatus } = await import("./save-spot-delivery.core");
  const key = COMPLETION_PACK_EMAIL_KEY(jobId);
  const emailLog = async () => classifyEmailLogStatus(await (await import("./owner-email-send.server")).guardedOwnerEmailStatus(key));
  // Review R04: a DEFINITE failure re-claims the guarded sender's reservation and resends with the same key (real owners);
  // TEST sends reuse test-send's content key. Holds (approval, link, consent, no email) are not attempts.
  let r: string;
  let o: SendOutcome | "held";
  try {
    r = await emailOwnerCompletionPack(jobId, downloads, undefined, { attachments: [...copies.attachments, ...coes.attachments], attachedWarranties: attachedNames, attachedCoes: coes.names.length > 0, retryAfterDefiniteFailure: true });
    o = classifyTemplateSendResult(r, test, classifyProviderStatus) ?? await emailLog(); // "already attempted" → the email log decides
  } catch (e) {
    // Real owners: the email log says whether anything reached the email service; TEST sends record every provider answer
    // themselves, so an exception escaping them happened before the provider took the email.
    r = `failed: ${(e as Error).message}`;
    const log = test ? { outcome: "failed" as const, detail: r } : await emailLog().catch(() => ({ outcome: "unknown" as const, detail: "The email log could not be read" }));
    o = log.outcome === "failed" ? { outcome: "failed", detail: r } : log;
  }
  const warranties = { attached: attachedNames, missing: missingProducts, recorded: false };
  if (o !== "held" && o.outcome === "failed") await logEvent(jobId, actorId, COMPLETION_PACK_SEND_FAILED_EVENT, "Completion pack email not sent (definite failure) — it will be tried again", { key, detail: o.detail.slice(0, 500) }, { internal: true });
  if (o !== "held" && o.outcome === "unknown") await logEvent(jobId, actorId, COMPLETION_PACK_SEND_UNKNOWN_EVENT, "Completion pack email: no clear answer from the email service — not resent; office to check", { key, detail: o.detail.slice(0, 500), needs_office: true }, { internal: true });
  if (o === "held" || o.outcome !== "delivered") return { outcome: "not_sent", detail: r, warranties, coes: coes.names };
  if (!ownerEmailSent(r)) r = "sent"; // confirmed from the email log

  await logEvent(jobId, actorId, COMPLETION_PACK_SENT_EVENT, `Completion pack emailed to the owner${attachedNames.length ? ` with the ${attachedNames.join(" and ")} manufacturer warranty attached` : ""}${coes.names.length ? `${attachedNames.length ? " and" : " with"} the Certificate of Electrical Safety attached` : ""}`, { result: r, attached: attachedNames, missing: missingProducts, products: decision.products, coes_attached: coes.names, coes_not_attached: coes.skipped });
  // Decision 321: normally already recorded by the All done email at install complete — recorded here only if it was not.
  warranties.recorded = await recordWarrantyCopyProvided(jobId, actorId, { via: "completion_pack", result: r, decision, attached: copies.attached, missing: copies.missing });
  return { outcome: "sent", detail: r, warranties, coes: coes.names };
}

/** 15-minute tick: every recently completed, fully paid job without a completion pack yet. */
export async function sweepCompletionPacks(): Promise<{ checked: number; sent: number; notSent: number }> {
  const since = new Date(Date.now() - SWEEP_WINDOW_MS).toISOString();
  const { data: jobs, error } = await admin.from("jobs").select("id").not("installation_completed_at", "is", null).gte("installation_completed_at", since).is("deleted_at", null);
  if (error) throw new Error(`Could not read completed jobs: ${error.message}`);
  // Perf 25 Oct 2026: "already sent" and "paid in full" for every candidate at once — sendCompletionPack would skip
  // exactly these jobs after three reads each, every 15 minutes. The send path still re-checks both itself.
  const ids = (jobs ?? []).map((j) => j.id);
  const { readByJobIds } = await import("./sweep-batch.server");
  const { latestPerJob } = await import("./sweep-batch.core");
  const [sentRows, invoices] = await Promise.all([
    readByJobIds<{ job_id: string | null }>("completion packs sent", ids, (c) => admin.from("workflow_events").select("job_id").in("job_id", c).eq("event_type", COMPLETION_PACK_SENT_EVENT)),
    readByJobIds<{ job_id: string | null; created_at: string; total_inc_gst: number | null; total_paid: number | null }>("installation invoices", ids, (c) => admin.from("invoices").select("job_id, created_at, total_inc_gst, total_paid").in("job_id", c).eq("kind", "installation")),
  ]);
  const alreadySentIds = new Set(sentRows.map((r) => String(r.job_id)));
  const latestInvoice = latestPerJob(invoices);
  const due = (jobs ?? []).filter((j) => !alreadySentIds.has(j.id) && invoiceFullyPaid(latestInvoice.get(j.id)));
  let sent = 0, notSent = 0;
  for (const j of due) {
    try {
      const r = await sendCompletionPack(j.id);
      if (r.outcome === "sent") sent++;
      else if (r.outcome === "not_sent") notSent++;
    } catch (e) { notSent++; console.error("completion pack failed", j.id, (e as Error).message); }
  }
  return { checked: (jobs ?? []).length, sent, notSent };
}
