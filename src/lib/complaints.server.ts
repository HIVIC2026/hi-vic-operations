// New job flow, Part 9, Task 12: reads the job's complaint events for the office functions (complaints.functions) —
// read-only, no senders. The rules live in complaints.core.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { COMPLAINT_ACKNOWLEDGED_EVENT, COMPLAINT_RECEIVED_EVENT, COMPLAINT_RESOLVED_EVENT, complaintState, type ComplaintEvent, type ComplaintState } from "./complaints.core";

/** The latest complaint on the job and its acknowledgement / resolution (null = none recorded). A read error throws. */
export async function complaintStateFor(jobId: string): Promise<ComplaintState | null> {
  const { data, error } = await admin.from("workflow_events").select("event_type, created_at, details").eq("job_id", jobId)
    .in("event_type", [COMPLAINT_RECEIVED_EVENT, COMPLAINT_ACKNOWLEDGED_EVENT, COMPLAINT_RESOLVED_EVENT]).order("created_at", { ascending: true });
  if (error) throw new Error(`Complaint events could not be read: ${error.message}`);
  return complaintState(((data ?? []) as { event_type: string; created_at: string; details: unknown }[]).map((e): ComplaintEvent => ({ event_type: e.event_type, created_at: e.created_at, details: (e.details ?? null) as Record<string, unknown> | null })));
}
