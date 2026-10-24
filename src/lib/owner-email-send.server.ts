// One guarded path for a real owner email: opt-outs, suppression, TEST-recipient boundary, a once-only reservation,
// then Resend. Callers decide wording and approval; this never sends without every check passing.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";

export async function sendGuardedOwnerEmail(p: { jobId: string; jobSource: string | null; to: string; purpose: string; key: string; build: (unsubscribeUrl: string | null) => { subject: string; html: string; text: string; attachments?: import("./email-kit.core").EmailAttachment[] } }): Promise<string> {
  const [{ data: opt, error: oe }, { data: response, error: re }, { count: suppressed, error: se }] = await Promise.all([
    admin.from("customer_email_optouts").select("opted_out_at").eq("job_id", p.jobId).maybeSingle(),
    admin.from("lead_campaign_responses").select("opted_out_at").eq("job_id", p.jobId).maybeSingle(),
    admin.from("customer_engagement_events").select("id", { count: "exact", head: true }).eq("job_id", p.jobId).in("event_type", (await import("./emailsafety.core")).SUPPRESSING_EVENTS),
  ]);
  const boundary = (await import("./comms-test-recipient.core")).testRecipientBoundary(p.to, p.jobSource);
  if (oe || re || se || suppressed == null || opt?.opted_out_at || response?.opted_out_at || suppressed > 0 || boundary.status === "blocked") return "blocked — not sent";
  const { data: reserved, error } = await admin.from("customer_email_sends").insert({ job_id: p.jobId, purpose: p.purpose, idempotency_key: p.key }).select("id").single();
  if (error || !reserved) return "already attempted — not resent";
  const { unsubscribeUrlForJob } = await import("./emailsafety.server");
  const unsubscribe = await unsubscribeUrlForJob(p.jobId);
  const mail = p.build(unsubscribe);
  const { resendSend } = await import("./hot-leads-send.server");
  const d = await resendSend(p.to, mail.subject, mail.html, mail.text, p.key, unsubscribe, mail.attachments).catch(() => null);
  const status = !d || d.outcome === "uncertain" ? "delivered_unrecorded" : d.outcome === "rejected" || d.outcome === "not_attempted" ? "failed" : "sent";
  await admin.from("customer_email_sends").update({ status, provider: "resend", sent_at: status === "sent" ? new Date().toISOString() : null, error: d?.detail ?? "Delivery result unknown", provider_message_id: d && "id" in d ? d.id ?? null : null }).eq("id", reserved.id);
  return status === "sent" ? "sent" : status === "delivered_unrecorded" ? "delivery uncertain — not retried" : `failed: ${d?.detail ?? "send error"}`;
}
