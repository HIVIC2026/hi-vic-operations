// Decision 363 (Jo 25 Oct 2026): the warranty follow-up sweep on the 15-minute tick. Rules + DRAFT wording O73:
// warranty-followup.core.ts. For a completed job whose completion pack went out without a warranty PDF
// (`product_warranty_missing`) and with no `warranty_copy_provided` yet: once every installed product's PDF is on file,
// ONE owner email with the PDF(s) attached, then `warranty_copy_provided` (via "warranty_followup") through the one
// recorder in completion-pack.server, which also tries the AP auto-signature.
// Real owners: only sendGuardedOwnerEmail behind WARRANTY_FOLLOWUP_APPROVED (false = nothing sent, nothing recorded) +
// customer_comms_enabled + consent (assertCustomerDeliveryAllowed). TEST (qa_test) jobs: test-send only.
// The step is recorded once (`warranty_followup_sent`, before sending) so a tick never sends twice.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { WARRANTY_COPY_PROVIDED_EVENT } from "./product-warranty.core";
import {
  PRODUCT_WARRANTY_MISSING_EVENT, WARRANTY_FOLLOWUP_APPROVED, WARRANTY_FOLLOWUP_PURPOSE, WARRANTY_FOLLOWUP_SENT_EVENT, WARRANTY_FOLLOWUP_TEMPLATE_CODE,
  renderWarrantyFollowupEmail, warrantyFollowupBlocker, warrantyFollowupKey,
} from "./warranty-followup.core";

const WINDOW_MS = 120 * 86_400_000;

const hasEvent = async (jobId: string, types: string[]) => {
  const { data, error } = await admin.from("workflow_events").select("id").eq("job_id", jobId).in("event_type", types).limit(1);
  if (error) throw new Error(`Warranty follow-up could not read the job history: ${error.message}`);
  return (data ?? []).length > 0;
};

/** One job. Returns what happened (never throws for a business reason). */
export async function sendWarrantyFollowup(jobId: string): Promise<string> {
  const { data: job } = await admin.from("jobs").select("id, source, installation_completed_at, deleted_at, owners(full_name, email)").eq("id", jobId).maybeSingle();
  if (!job) return "skipped — no job";
  const { warrantyDecisionFor, prepareWarrantyCopies } = await import("./product-warranty.server");
  const decision = await warrantyDecisionFor(jobId);
  const blocker = warrantyFollowupBlocker({
    installCompleted: !!job.installation_completed_at, deleted: !!job.deleted_at,
    missingRecorded: await hasEvent(jobId, [PRODUCT_WARRANTY_MISSING_EVENT]),
    provided: await hasEvent(jobId, [WARRANTY_COPY_PROVIDED_EVENT]),
    alreadySent: await hasEvent(jobId, [WARRANTY_FOLLOWUP_SENT_EVENT]),
    products: decision.products, allOnFile: decision.missing.length === 0 && decision.attach.length > 0,
  });
  if (blocker) return `skipped — ${blocker}`;
  const test = job.source === "qa_test";
  const owner = (job.owners ?? null) as { full_name: string | null; email: string | null } | null;
  const to = owner?.email?.trim() ?? "";
  if (!test) {
    if (!WARRANTY_FOLLOWUP_APPROVED) return "held — wording awaiting approval";
    try { await (await import("./comms.server")).assertCustomerDeliveryAllowed(jobId, "Warranty follow-up email"); } catch (e) { return `held — ${(e as Error).message}`; }
    if (!to) return "held — no owner email";
  }
  const copies = await prepareWarrantyCopies(jobId, null, decision);
  if (copies.missing.length || !copies.attachments.length) return `skipped — warranty PDF could not be read (${copies.missing.map((m) => m.product).join(", ")})`;
  const key = warrantyFollowupKey(jobId);
  const names = copies.attached.map((w) => w.productName);
  await logEvent(jobId, null, WARRANTY_FOLLOWUP_SENT_EVENT, `Warranty follow-up ${WARRANTY_FOLLOWUP_TEMPLATE_CODE} prepared for the owner with the ${names.join(" and ")} warranty attached`, { key, template: WARRANTY_FOLLOWUP_TEMPLATE_CODE, products: decision.products, attached: names }, { internal: true });
  const render = (unsubscribeUrl: string | null) => renderWarrantyFollowupEmail({ firstName: owner?.full_name ?? null, products: names, unsubscribeUrl, test });
  let result: string;
  if (test) {
    const m = render(null);
    const r = await (await import("./test-send.server")).sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: false, label: `${WARRANTY_FOLLOWUP_PURPOSE}:${jobId}`, actorId: null }, to, m.subject, m.html, m.text, { attachments: copies.attachments });
    result = r.status === "sent" ? "sent" : `${r.status}: ${r.detail}`;
  } else {
    result = await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId, jobSource: job.source, to, purpose: WARRANTY_FOLLOWUP_PURPOSE, key, build: (u) => ({ ...render(u), attachments: copies.attachments }) });
  }
  const recorded = await (await import("./completion-pack.server")).recordWarrantyCopyProvided(jobId, null, { via: "warranty_followup", result, decision, attached: copies.attached, missing: copies.missing });
  return `${result}${recorded ? " · warranty copy recorded" : ""}`;
}

/** 15-minute tick: completed jobs (last 120 days) whose pack went without a warranty PDF. Counts only. */
export async function sweepWarrantyFollowups(now = new Date()): Promise<{ checked: number; sent: number; held: number; failed: number }> {
  const out = { checked: 0, sent: 0, held: 0, failed: 0 };
  const { data: ev, error } = await admin.from("workflow_events").select("job_id").eq("event_type", PRODUCT_WARRANTY_MISSING_EVENT).gte("created_at", new Date(now.getTime() - WINDOW_MS).toISOString());
  if (error) throw new Error(`Warranty follow-up could not read missing-warranty events: ${error.message}`);
  for (const jobId of [...new Set((ev ?? []).map((e) => String(e.job_id)))]) {
    out.checked++;
    try {
      const r = await sendWarrantyFollowup(jobId);
      if (/^sent\b/.test(r)) out.sent++; else if (r.startsWith("held")) out.held++;
    } catch (e) { out.failed++; console.error("warranty follow-up failed", jobId, (e as Error).message); }
  }
  return out;
}
