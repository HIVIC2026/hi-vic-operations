// Persistence for customer email safety: suppression facts, unsubscribe tokens and opt-out recording.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { newToken, isWellFormedToken } from "./estimatelink.core";
import { emailSuppression, unsubscribeUrl, SUPPRESSING_EVENTS, type EmailPurpose } from "./emailsafety.core";

// S20-R01: the list now lives in emailsafety.core (pure) so the automatic-reply gate can share it; re-exported unchanged.
export { SUPPRESSING_EVENTS };

export async function suppressionFor(jobId: string, purpose: EmailPurpose, recipient: string | null): Promise<string | null> {
  const [{ data: job }, { data: opt }, { data: bounce }, { data: cfg }] = await Promise.all([
    admin.from("jobs").select("stage, source, created_at").eq("id", jobId).maybeSingle(),
    admin.from("customer_email_optouts").select("opted_out_at").eq("job_id", jobId).maybeSingle(),
    admin.from("customer_engagement_events").select("id").eq("job_id", jobId).in("event_type", SUPPRESSING_EVENTS).limit(1).maybeSingle(),
    admin.from("customer_delivery_settings").select("jobs_created_after").eq("id", 1).maybeSingle(),
  ]);
  if (!job) return "job_not_found";
  return emailSuppression({ purpose, optedOut: !!opt?.opted_out_at, bounced: !!bounce, stage: job.stage, jobSource: job.source, jobCreatedAt: job.created_at, recipient, jobsCreatedAfter: cfg?.jobs_created_after ?? null });
}

/** One opaque unsubscribe token per job. Throws when it cannot be issued — callers must then not send. */
export async function unsubscribeUrlForJob(jobId: string): Promise<string> {
  const { data: ex } = await admin.from("customer_email_optouts").select("token").eq("job_id", jobId).maybeSingle();
  if (ex?.token) return unsubscribeUrl(ex.token);
  const token = newToken();
  const { error } = await admin.from("customer_email_optouts").insert({ job_id: jobId, token });
  if (error) {
    const { data: again } = await admin.from("customer_email_optouts").select("token").eq("job_id", jobId).single();
    if (!again?.token) throw new Error("unsubscribe token unavailable");
    return unsubscribeUrl(again.token);
  }
  return unsubscribeUrl(token);
}

/** Idempotent opt-out. Also stores a withdrawn contact consent so every consent gate closes. Returns false for unknown tokens. */
export async function recordUnsubscribe(token: string): Promise<boolean> {
  if (!isWellFormedToken(token)) return false;
  const { data: row } = await admin.from("customer_email_optouts").select("id, job_id, opted_out_at").eq("token", token).maybeSingle();
  if (!row) return false;
  if (row.opted_out_at) return true;
  const at = new Date().toISOString();
  await admin.from("customer_email_optouts").update({ opted_out_at: at }).eq("id", row.id).is("opted_out_at", null);
  const { data: job } = await admin.from("jobs").select("owner_id").eq("id", row.job_id).maybeSingle();
  if (job?.owner_id) {
    const snapshot = { reason: "email_unsubscribe", at };
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
    const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
    await admin.from("owner_contact_consents").insert({ job_id: row.job_id, owner_id: job.owner_id, source: "unsubscribe", consent_key: `unsubscribe:${row.id}`, consent_status: "not_granted", contact_consent: false, snapshot, sha256 });
  }
  await admin.from("customer_followups").update({ status: "suppressed", suppression_reason: "unsubscribed" }).eq("job_id", row.job_id).in("status", ["pending", "queued"]);
  return true;
}
