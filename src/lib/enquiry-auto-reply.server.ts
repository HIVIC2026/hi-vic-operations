// S20-R01: reads the facts for the new-enquiry automatic reply gate (enquiry-auto-reply.core.ts). Read-only; fails closed.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { AUTO_REPLY_OFF, AUTO_REPLY_UNREADABLE, newEnquiryAutoReplyBlocker } from "./enquiry-auto-reply.core";
import { SUPPRESSING_EVENTS } from "./emailsafety.core";

export type AutoReplyGate = { allowed: true } | { allowed: false; reason: string };

/** May this ONE enquiry get its automatic decision email now (with the master switch off)? Re-read on every call, so
 *  switching automatic enquiry emails off stops the next send immediately. */
export async function newEnquiryAutoReplyGate(jobId: string): Promise<AutoReplyGate> {
  const { data: cfg, error: ce } = await admin.from("customer_delivery_settings").select("enabled, jobs_created_after").eq("id", 1).maybeSingle();
  if (ce || !cfg) return { allowed: false, reason: AUTO_REPLY_UNREADABLE };
  if ((cfg as { enabled: boolean | null }).enabled !== true) return { allowed: false, reason: AUTO_REPLY_OFF };
  const [{ data: job, error: je }, { data: bad, error: be }, { data: opt, error: oe }] = await Promise.all([
    admin.from("jobs").select("created_at, source, deleted_at, owners(email)").eq("id", jobId).maybeSingle(),
    admin.from("customer_engagement_events").select("id").eq("job_id", jobId).in("event_type", SUPPRESSING_EVENTS).limit(1).maybeSingle(),
    admin.from("customer_email_optouts").select("opted_out_at").eq("job_id", jobId).maybeSingle(),
  ]);
  if (je || be || oe || !job) return { allowed: false, reason: AUTO_REPLY_UNREADABLE };
  const owner = job.owners as { email: string | null } | { email: string | null }[] | null;
  const blocker = newEnquiryAutoReplyBlocker({
    enabled: (cfg as { enabled: boolean | null }).enabled, startsAt: (cfg as { jobs_created_after: string | null }).jobs_created_after,
    jobCreatedAt: job.created_at, jobSource: job.source, jobDeleted: !!(job as { deleted_at?: string | null }).deleted_at,
    recipient: (Array.isArray(owner) ? owner[0]?.email : owner?.email) ?? null,
    suppressed: !!bad || !!opt?.opted_out_at,
  });
  return blocker ? { allowed: false, reason: blocker } : { allowed: true };
}
