// Stage 6 (Jo 22 Oct 2026): once a released installation quote exists, tell the owner — by text, and by
// email only when an approved template is on file. Nothing here invents customer wording:
//  • the text uses the `quote_ready` type, whose wording is NOT approved yet, so the real sender refuses it
//    until Jo approves it (sms.core.ts). The draft below is what she would be approving.
//  • the email goes only through an approved `customer_communication_templates` row; with none on file the
//    office is told the quote went out with no email, instead of a made-up one.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";

export const QUOTE_EMAIL_TEMPLATE_KEY = "quote_ready";
/** DRAFT wording (never sent until Jo approves the `quote_ready` SMS type). */
export const quoteReadySmsBody = (jobNumber: string) =>
  `Your ceiling insulation quote is ready — please open your Home Insulation Victoria job page to see it (job ${jobNumber}). Reply STOP to opt out.`;

export type QuoteNotifyResult = { sms: string; email: string };

export async function notifyOwnerQuoteReady(jobId: string, quoteId: string, kind: string): Promise<QuoteNotifyResult> {
  if (kind !== "installation") return { sms: "skipped", email: "skipped" };
  const { assertCustomerDeliveryAllowed } = await import("./comms.server");
  await assertCustomerDeliveryAllowed(jobId, "Office quote notification");
  const { data: job } = await admin.from("jobs").select("owner_id, job_number, source, stage, deleted_at, qa_archived_at").eq("id", jobId).maybeSingle();
  if (!job) return { sms: "skipped", email: "skipped" };
  if ((await import("./mitti.core")).isClosedOrArchivedJob(job)) return { sms: "skipped", email: "skipped" };
  const { data: owner } = await admin.from("owners").select("phone, email").eq("id", job.owner_id).maybeSingle();

  if (job.source === "qa_test") {
    const { data: assigned, error: ae } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
    const { data: partner, error: pe } = assigned?.business_id ? await admin.from("businesses").select("onboarding_notes").eq("id", assigned.business_id).maybeSingle() : { data: null, error: null };
    if (ae || pe) throw new Error("TEST partner could not be checked.");
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestEmail, sendTestSms } = await import("./test-send.server");
    const ctx = { jobId, jobSource: job.source, partnerIsTest: isTestPartner(partner), label: `quote_ready:${quoteId}`, actorId: null };
    const text = `[TEST] ${quoteReadySmsBody(String(job.job_number ?? ""))}`;
    const email = await sendTestEmail(ctx, owner?.email ?? "", `[TEST] Quote ready — ${job.job_number}`, `<p>${text}</p>`, text);
    const sms = await sendTestSms(ctx, owner?.phone ?? "", text);
    return { email: `${email.status}: ${email.detail}`, sms: `${sms.status}: ${sms.detail}` };
  }

  const { sendRealSms } = await import("./sms.server");
  const s = await sendRealSms({
    type: "quote_ready", idempotencyKey: `quote-ready:v1:${quoteId}`, to: owner?.phone ?? null, jobId,
    body: quoteReadySmsBody(String(job.job_number ?? "")),
  }).catch((e) => ({ status: "failed" as const, detail: e instanceof Error ? e.message : "error", sid: null }));

  const { data: tpl } = await admin.from("customer_communication_templates").select("subject, body_markdown")
    .eq("template_key", QUOTE_EMAIL_TEMPLATE_KEY).eq("status", "approved").order("version", { ascending: false }).limit(1).maybeSingle();
  let email = "no approved wording — not sent";
  if (tpl && owner?.email) {
    const [{ data: opt, error: oe }, { data: response, error: re }, { count: suppressed, error: se }] = await Promise.all([
      admin.from("customer_email_optouts").select("opted_out_at").eq("job_id", jobId).maybeSingle(),
      admin.from("lead_campaign_responses").select("opted_out_at").eq("job_id", jobId).maybeSingle(),
      admin.from("customer_engagement_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).in("event_type", (await import("./emailsafety.core")).SUPPRESSING_EVENTS),
    ]);
    const boundary = (await import("./comms-test-recipient.core")).testRecipientBoundary(owner.email, job.source);
    if (oe || re || se || suppressed == null || opt?.opted_out_at || response?.opted_out_at || suppressed > 0 || boundary.status === "blocked") email = "blocked — not sent";
    else {
      const key = `quote-ready-email:v1:${quoteId}`;
      const { data: reserved, error } = await admin.from("customer_email_sends").insert({ job_id: jobId, purpose: "quote_ready", idempotency_key: key }).select("id").single();
      if (error || !reserved) email = "already attempted — not resent";
      else {
        const { unsubscribeUrlForJob } = await import("./emailsafety.server");
        const unsubscribe = await unsubscribeUrlForJob(jobId);
        const { resendSend } = await import("./hot-leads-send.server");
        const d = await resendSend(owner.email, tpl.subject, tpl.body_markdown, tpl.body_markdown, key, unsubscribe).catch(() => null);
        const status = !d || d.outcome === "uncertain" ? "delivered_unrecorded" : d.outcome === "rejected" || d.outcome === "not_attempted" ? "failed" : "sent";
        await admin.from("customer_email_sends").update({ status, provider: "resend", sent_at: status === "sent" ? new Date().toISOString() : null, error: d?.detail ?? "Delivery result unknown", provider_message_id: d && "id" in d ? d.id ?? null : null }).eq("id", reserved.id);
        email = status === "sent" ? "sent" : status === "delivered_unrecorded" ? "delivery uncertain — not retried" : `failed: ${d?.detail ?? "send error"}`;
      }
    }
  }
  if (!tpl) {
    await logEvent(jobId, null, "ready_check_needs_office", "Quote released to the owner — no approved quote email wording on file, so no email was sent",
      { quote_id: quoteId, needs_office: true }, { internal: true });
  }
  return { sms: `${s.status}: ${s.detail}`, email };
}
