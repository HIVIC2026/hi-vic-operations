// Completion pack (O47, decision 103) — the one workflow sender. Jo 25 Oct 2026 (VEU checklist G1): the pack carries the
// manufacturer warranty PDF for the product(s) actually installed, files the copy on the job (documents kind
// `product_warranty`) and records `warranty_copy_provided` at that send, so the AP auto-signature prerequisite (decision 271)
// is met without an office step. When a product's PDF is not on file the pack still sends, nothing is recorded and the AP
// signature keeps holding with "Warranty copy for <product> not on file".
// When: install recorded complete AND the installation invoice paid in full (O45 wording: "Once it's paid, we'll send your
// completion pack"). Once per job (`completion_pack_sent` event, written only after a confirmed send). Delivery stays behind
// COMPLETION_EMAILS_APPROVED + customer_comms_enabled + consent through sendOwnerTemplateEmail; TEST jobs use test-send.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { WARRANTY_COPY_PROVIDED_EVENT, warrantyProvidedSummary } from "./product-warranty.core";

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

export type CompletionPackResult = { outcome: "sent" | "skipped" | "not_sent"; detail: string; warranties: { attached: string[]; missing: string[]; recorded: boolean } };

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
  const recordProvided = decision.products.length > 0 && copies.missing.length === 0 && copies.attached.length > 0;
  if (copies.missing.length) await logEvent(jobId, actorId, "product_warranty_missing", `Completion pack: no warranty document on file for ${missingProducts.join(", ")} — sent without it; the AP signature holds until a copy is given and recorded`, { missing: copies.missing, products: decision.products }, { internal: true });

  const { emailOwnerCompletionPack } = await import("./approved-owner-emails.server");
  const link = await (await import("./veec-copy-email.server")).ownerMyJobLink(jobId);
  const downloads = { certificateUrl: null, invoiceUrl: null, warrantiesUrl: link ? `${link}?screen=done` : null, signedFormsUrl: link ? `${link}?screen=done` : null };
  const r = await emailOwnerCompletionPack(jobId, downloads, undefined, { attachments: copies.attachments, attachedWarranties: attachedNames });
  const sent = r === "sent" || /^sent\b/.test(r);
  const warranties = { attached: attachedNames, missing: missingProducts, recorded: false };
  if (!sent) return { outcome: "not_sent", detail: r, warranties };

  await logEvent(jobId, actorId, COMPLETION_PACK_SENT_EVENT, `Completion pack emailed to the owner${attachedNames.length ? ` with the ${attachedNames.join(" and ")} manufacturer warranty attached` : ""}`, { result: r, attached: attachedNames, missing: missingProducts, products: decision.products });
  if (recordProvided) {
    await logEvent(jobId, actorId, WARRANTY_COPY_PROVIDED_EVENT, warrantyProvidedSummary(copies.attached), { via: "completion_pack", products: decision.products, documents: copies.attached.map((w) => ({ family: w.family, manufacturer: w.manufacturer, attachment: w.attachmentName })) });
    warranties.recorded = true;
    // Decision 271: the AP signature may now be applied at once rather than on the next tick. Best-effort.
    try { await (await import("./veec-ap-auto.server")).tryAutoApSignature(jobId); } catch (e) { console.error("completion pack: AP auto signature check skipped", (e as Error).message); }
  }
  return { outcome: "sent", detail: r, warranties };
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
