// Fail-closed "is this job deleted?" read used right before any provider call, booking or secure owner link load.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";

export const JOB_DELETED_BLOCK = "This job is deleted; nothing is sent, booked or shown for it.";
export const JOB_STATE_UNREADABLE = "Could not confirm the job is still active; nothing sent.";

/** Returns a blocker (deleted, missing or unreadable) or null when the job is live. No job id = nothing to check. */
export async function jobDeletedBlocker(jobId: string | null | undefined): Promise<string | null> {
  if (!jobId) return null;
  const { data, error } = await admin.from("jobs").select("deleted_at").eq("id", jobId).maybeSingle();
  if (error || !data) return JOB_STATE_UNREADABLE;
  return (data as { deleted_at: string | null }).deleted_at ? JOB_DELETED_BLOCK : null;
}
