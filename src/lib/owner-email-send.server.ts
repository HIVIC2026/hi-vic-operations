// One guarded path for a real owner email: opt-outs, suppression, TEST-recipient boundary, a once-only reservation,
// then Resend. Callers decide wording and approval; this never sends without every check passing.
// Review R04: a caller may opt in to `retryAfterDefiniteFailure` — a reservation whose earlier attempt is recorded as a
// DEFINITE failure ('failed': the email service refused it, or it was never handed over) is claimed again atomically
// (failed → sending, one winner) and resent with the SAME provider idempotency key. Anything else ('sending',
// 'delivered_unrecorded' = no clear answer, 'sent') is never resent. A throw before the provider call marks the
// reservation 'failed' (nothing was handed to the email service) instead of leaving it 'sending' forever.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";

export async function sendGuardedOwnerEmail(p: { jobId: string; jobSource: string | null; to: string; purpose: string; key: string; build: (unsubscribeUrl: string | null) => { subject: string; html: string; text: string; attachments?: import("./email-kit.core").EmailAttachment[] }; retryAfterDefiniteFailure?: boolean; beforeSend?: () => Promise<void> }): Promise<string> {
  const [{ data: opt, error: oe }, { data: response, error: re }, { count: suppressed, error: se }] = await Promise.all([
    admin.from("customer_email_optouts").select("opted_out_at").eq("job_id", p.jobId).maybeSingle(),
    admin.from("lead_campaign_responses").select("opted_out_at").eq("job_id", p.jobId).maybeSingle(),
    admin.from("customer_engagement_events").select("id", { count: "exact", head: true }).eq("job_id", p.jobId).in("event_type", (await import("./emailsafety.core")).SUPPRESSING_EVENTS),
  ]);
  const boundary = (await import("./comms-test-recipient.core")).testRecipientBoundary(p.to, p.jobSource);
  if (oe || re || se || suppressed == null || opt?.opted_out_at || response?.opted_out_at || suppressed > 0 || boundary.status === "blocked") return "blocked — not sent";
  let { data: reserved, error } = await admin.from("customer_email_sends").insert({ job_id: p.jobId, purpose: p.purpose, idempotency_key: p.key }).select("id").single();
  if ((error || !reserved) && p.retryAfterDefiniteFailure) {
    // Conditional claim: only a row whose last attempt definitely failed, and only one caller wins it.
    const again = await admin.from("customer_email_sends").update({ status: "sending", error: null, sent_at: null }).eq("idempotency_key", p.key).eq("job_id", p.jobId).eq("status", "failed").select("id").maybeSingle();
    if (!again.error && again.data) { reserved = again.data; error = null; }
  }
  if (error || !reserved) return "already attempted — not resent";
  let mail: ReturnType<typeof p.build>;
  let unsubscribe: string;
  try {
    const { unsubscribeUrlForJob } = await import("./emailsafety.server");
    unsubscribe = await unsubscribeUrlForJob(p.jobId);
    mail = p.build(unsubscribe);
    if (p.beforeSend) await p.beforeSend();
  } catch (e) {
    await admin.from("customer_email_sends").update({ status: "failed", error: `Not sent — failed before the email service was called: ${(e as Error).message}`.slice(0, 500) }).eq("id", reserved.id);
    throw e;
  }
  const { resendSend } = await import("./hot-leads-send.server");
  const d = await resendSend(p.to, mail.subject, mail.html, mail.text, p.key, unsubscribe, mail.attachments).catch(() => null);
  const status = !d || d.outcome === "uncertain" ? "delivered_unrecorded" : d.outcome === "rejected" || d.outcome === "not_attempted" ? "failed" : "sent";
  await admin.from("customer_email_sends").update({ status, provider: "resend", sent_at: status === "sent" ? new Date().toISOString() : null, error: status === "sent" ? null : d?.detail ?? "Delivery result unknown", provider_message_id: d && "id" in d ? d.id ?? null : null }).eq("id", reserved.id);
  return status === "sent" ? "sent" : status === "delivered_unrecorded" ? "delivery uncertain — not retried" : `failed: ${d?.detail ?? "send error"}`;
}

/** Review R04: the email log's verdict for one idempotency key (null = no reservation was ever made). */
export async function guardedOwnerEmailStatus(key: string): Promise<"sending" | "sent" | "failed" | "delivered_unrecorded" | null> {
  const { data, error } = await admin.from("customer_email_sends").select("status").eq("idempotency_key", key).maybeSingle();
  if (error) throw new Error(`Could not read the email log: ${error.message}`);
  return (data?.status as "sending" | "sent" | "failed" | "delivered_unrecorded" | undefined) ?? null;
}
