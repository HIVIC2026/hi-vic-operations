// Decision 363 (Jo 25 Oct 2026): the warranty follow-up sweep on the 15-minute tick. Rules + DRAFT wording O73:
// warranty-followup.core.ts. For a completed job whose completion pack went out without a warranty PDF
// (`product_warranty_missing`) and with no `warranty_copy_provided` yet: once every installed product's PDF is on file,
// ONE owner email with the PDF(s) attached, then `warranty_copy_provided` (via "warranty_followup") through the one
// recorder in completion-pack.server, which also tries the AP auto-signature.
// Real owners: only sendGuardedOwnerEmail behind WARRANTY_FOLLOWUP_APPROVED (false = nothing sent, nothing recorded) +
// customer_comms_enabled + consent (assertCustomerDeliveryAllowed). TEST (qa_test) jobs: test-send only.
// Review R04 (audit F16): reservation, confirmed delivery, definite failure and unknown outcome are separate events
// (warranty-followup.core). Only a CONFIRMED delivery records `warranty_copy_provided`; a definite failure is retried on a
// later tick with the SAME provider idempotency key (real owners: the guarded sender re-claims its failed reservation;
// TEST: test-send's content key); an unknown outcome is never resent and goes to the office (Needs me).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { WARRANTY_COPY_PROVIDED_EVENT } from "./product-warranty.core";
import {
  PRODUCT_WARRANTY_MISSING_EVENT, WARRANTY_FOLLOWUP_APPROVED, WARRANTY_FOLLOWUP_ATTEMPT_EVENT, WARRANTY_FOLLOWUP_EVENTS, WARRANTY_FOLLOWUP_FAILED_EVENT,
  WARRANTY_FOLLOWUP_PURPOSE, WARRANTY_FOLLOWUP_SENT_EVENT, WARRANTY_FOLLOWUP_TEMPLATE_CODE, WARRANTY_FOLLOWUP_UNKNOWN_EVENT,
  renderWarrantyFollowupEmail, warrantyFollowupBlocker, warrantyFollowupDelivery, warrantyFollowupKey, type WarrantyFollowupEvent,
} from "./warranty-followup.core";
import { classifyEmailLogStatus, classifyGuardedSendResult, classifyTestSendResult, retryAfter, type SendOutcome as FollowupSendOutcome } from "./send-outcome.core";

const WINDOW_MS = 120 * 86_400_000;

const hasEvent = async (jobId: string, types: string[]) => {
  const { data, error } = await admin.from("workflow_events").select("id").eq("job_id", jobId).in("event_type", types).limit(1);
  if (error) throw new Error(`Warranty follow-up could not read the job history: ${error.message}`);
  return (data ?? []).length > 0;
};
const followupEvents = async (jobId: string): Promise<WarrantyFollowupEvent[]> => {
  const { data, error } = await admin.from("workflow_events").select("event_type, created_at, details").eq("job_id", jobId).in("event_type", [...WARRANTY_FOLLOWUP_EVENTS]).order("created_at", { ascending: true });
  if (error) throw new Error(`Warranty follow-up could not read its earlier attempts: ${error.message}`);
  return (data ?? []) as WarrantyFollowupEvent[];
};
/** The email log's verdict for the real-owner key (the guarded sender's reservation). */
const emailLogOutcome = async (key: string): Promise<FollowupSendOutcome> => classifyEmailLogStatus(await (await import("./owner-email-send.server")).guardedOwnerEmailStatus(key));

async function recordOutcome(jobId: string, o: FollowupSendOutcome, x: { key: string; attempt: number; via: "send" | "email_log" }) {
  const d = { key: x.key, attempt: x.attempt, detail: o.detail.slice(0, 500), resolved_from: x.via };
  if (o.outcome === "delivered") await logEvent(jobId, null, WARRANTY_FOLLOWUP_SENT_EVENT, `Warranty follow-up ${WARRANTY_FOLLOWUP_TEMPLATE_CODE} accepted by the email service`, { ...d, confirmed: true }, { internal: true });
  else if (o.outcome === "failed") await logEvent(jobId, null, WARRANTY_FOLLOWUP_FAILED_EVENT, `Warranty follow-up ${WARRANTY_FOLLOWUP_TEMPLATE_CODE} not sent (definite failure) — it will be tried again`, d, { internal: true });
  else await logEvent(jobId, null, WARRANTY_FOLLOWUP_UNKNOWN_EVENT, `Warranty follow-up ${WARRANTY_FOLLOWUP_TEMPLATE_CODE}: no clear answer from the email service — not resent; office to check`, { ...d, needs_office: true }, { internal: true });
}

/** One job. Returns what happened (never throws for a business reason). */
export async function sendWarrantyFollowup(jobId: string, now = new Date()): Promise<string> {
  const { data: job } = await admin.from("jobs").select("id, source, installation_completed_at, deleted_at, owners(full_name, email)").eq("id", jobId).maybeSingle();
  if (!job) return "skipped — no job";
  const test = job.source === "qa_test";
  const key = warrantyFollowupKey(jobId);
  const { warrantyDecisionFor, prepareWarrantyCopies } = await import("./product-warranty.server");
  const decision = await warrantyDecisionFor(jobId);
  const provided = await hasEvent(jobId, [WARRANTY_COPY_PROVIDED_EVENT]);
  let delivery = warrantyFollowupDelivery(await followupEvents(jobId));
  // An attempt with no recorded outcome (interrupted, or the pre-R04 marker written before delivery): the email log
  // decides it for real owners; TEST sends have no reservation log, so it is UNKNOWN. Never resent blindly.
  if (delivery.state === "pending" && !provided) {
    const o = test ? { outcome: "unknown" as const, detail: "An earlier TEST attempt has no recorded outcome" } : await emailLogOutcome(key);
    await recordOutcome(jobId, o, { key, attempt: delivery.attempts, via: "email_log" });
    if (o.outcome === "delivered") {
      const copies = await prepareWarrantyCopies(jobId, null, decision);
      const recorded = await (await import("./completion-pack.server")).recordWarrantyCopyProvided(jobId, null, { via: "warranty_followup", result: "sent", decision, attached: copies.attached, missing: copies.missing });
      return `sent (confirmed from the email log)${recorded ? " · warranty copy recorded" : ""}`;
    }
    delivery = warrantyFollowupDelivery(await followupEvents(jobId));
  }
  const blocker = warrantyFollowupBlocker({
    installCompleted: !!job.installation_completed_at, deleted: !!job.deleted_at,
    missingRecorded: await hasEvent(jobId, [PRODUCT_WARRANTY_MISSING_EVENT]),
    provided, alreadySent: false, delivery, now: now.toISOString(),
    products: decision.products, allOnFile: decision.missing.length === 0 && decision.attach.length > 0,
  });
  if (blocker) return blocker.startsWith("follow-up delivery outcome unknown") || blocker.startsWith("follow-up attempt has no") ? `held — ${blocker}` : `skipped — ${blocker}`;
  const owner = (job.owners ?? null) as { full_name: string | null; email: string | null } | null;
  const to = owner?.email?.trim() ?? "";
  if (!test) {
    if (!WARRANTY_FOLLOWUP_APPROVED) return "held — wording awaiting approval";
    try { await (await import("./comms.server")).assertCustomerDeliveryAllowed(jobId, "Warranty follow-up email"); } catch (e) { return `held — ${(e as Error).message}`; }
    if (!to) return "held — no owner email";
  }
  const copies = await prepareWarrantyCopies(jobId, null, decision);
  if (copies.missing.length || !copies.attachments.length) return `skipped — warranty PDF could not be read (${copies.missing.map((m) => m.product).join(", ")})`;
  const names = copies.attached.map((w) => w.productName);
  const attempt = delivery.attempts + 1;
  // Reservation BEFORE the send: an interrupted send is resolved from the email log (above), never repeated blindly.
  await logEvent(jobId, null, WARRANTY_FOLLOWUP_ATTEMPT_EVENT, `Warranty follow-up ${WARRANTY_FOLLOWUP_TEMPLATE_CODE} attempt ${attempt} for the owner with the ${names.join(" and ")} warranty attached`, { key, attempt, template: WARRANTY_FOLLOWUP_TEMPLATE_CODE, products: decision.products, attached: names, retry: delivery.state === "failed" }, { internal: true });
  const render = (unsubscribeUrl: string | null) => renderWarrantyFollowupEmail({ firstName: owner?.full_name ?? null, products: names, unsubscribeUrl, test });
  let o: FollowupSendOutcome;
  if (test) {
    const m = render(null);
    try {
      // Same recipient + subject + body = test-send's same provider idempotency key on a retry.
      const r = await (await import("./test-send.server")).sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: false, label: `${WARRANTY_FOLLOWUP_PURPOSE}:${jobId}`, actorId: null }, to, m.subject, m.html, m.text, { attachments: copies.attachments });
      o = classifyTestSendResult(r, (await import("./save-spot-delivery.core")).classifyProviderStatus);
    } catch (e) {
      // test-send records every provider answer itself (its ledger writes report errors, they do not throw), so an
      // exception escaping it happened before the email service took the email: a definite failure.
      o = { outcome: "failed", detail: `Not sent — failed before the email service was called: ${(e as Error).message}` };
    }
  } else {
    try {
      const result = await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId, jobSource: job.source, to, purpose: WARRANTY_FOLLOWUP_PURPOSE, key, build: (u) => ({ ...render(u), attachments: copies.attachments }), retryAfterDefiniteFailure: true });
      o = classifyGuardedSendResult(result) ?? await emailLogOutcome(key); // "already attempted" → the email log decides
    } catch (e) {
      const log = await emailLogOutcome(key).catch(() => ({ outcome: "unknown" as const, detail: "The email log could not be read" }));
      o = log.outcome === "failed" ? { outcome: "failed", detail: `Not sent — ${(e as Error).message}` } : log;
    }
  }
  await recordOutcome(jobId, o, { key, attempt, via: "send" });
  if (o.outcome === "failed") return `failed: ${o.detail} — next try after ${retryAfter(now.toISOString(), delivery.failures + 1)}`;
  if (o.outcome === "unknown") return "delivery uncertain — not resent; office to check";
  const recorded = await (await import("./completion-pack.server")).recordWarrantyCopyProvided(jobId, null, { via: "warranty_followup", result: "sent", decision, attached: copies.attached, missing: copies.missing });
  return `sent${recorded ? " · warranty copy recorded" : ""}`;
}

/** 15-minute tick: completed jobs (last 120 days) whose pack went without a warranty PDF. Counts only. */
export async function sweepWarrantyFollowups(now = new Date()): Promise<{ checked: number; sent: number; held: number; failed: number }> {
  const out = { checked: 0, sent: 0, held: 0, failed: 0 };
  const { data: ev, error } = await admin.from("workflow_events").select("job_id").eq("event_type", PRODUCT_WARRANTY_MISSING_EVENT).gte("created_at", new Date(now.getTime() - WINDOW_MS).toISOString());
  if (error) throw new Error(`Warranty follow-up could not read missing-warranty events: ${error.message}`);
  for (const jobId of [...new Set((ev ?? []).map((e) => String(e.job_id)))]) {
    out.checked++;
    try {
      const r = await sendWarrantyFollowup(jobId, now);
      if (/^sent\b/.test(r)) out.sent++;
      else if (r.startsWith("held") || r.startsWith("delivery uncertain")) out.held++;
      else if (r.startsWith("failed")) out.failed++;
    } catch (e) { out.failed++; console.error("warranty follow-up failed", jobId, (e as Error).message); }
  }
  return out;
}
