// Office sets or clears "Do not contact" on a job. Append-only workflow_events (internal); no-op if already in that state.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent, WorkflowError } from "./workflow.server";
import { DO_NOT_CONTACT_SET_EVENT, DO_NOT_CONTACT_CLEARED_EVENT, doNotContactOn } from "./do-not-contact.core";

export async function readDoNotContact(jobId: string): Promise<{ on: boolean; source: string | null }> {
  const { data, error } = await admin.from("workflow_events").select("event_type, created_at, details").eq("job_id", jobId).in("event_type", [DO_NOT_CONTACT_SET_EVENT, DO_NOT_CONTACT_CLEARED_EVENT]).order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error(`Do not contact could not be read: ${error.message}`);
  const rows = (data ?? []) as { event_type: string; created_at: string; details: { source?: string } | null }[];
  const on = doNotContactOn(rows);
  const latestSet = rows.filter((r) => r.event_type === DO_NOT_CONTACT_SET_EVENT).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  return { on, source: on ? latestSet?.details?.source ?? null : null };
}

export async function setDoNotContact(jobId: string, actorId: string, on: boolean, note: string | null): Promise<{ on: boolean }> {
  const { data: isAdmin, error } = await admin.rpc("has_role", { _user_id: actorId, _role: "admin" });
  if (error || isAdmin !== true) throw new WorkflowError("Only the office can change this.");
  const current = await readDoNotContact(jobId);
  if (current.on === on) return { on };
  await logEvent(jobId, actorId, on ? DO_NOT_CONTACT_SET_EVENT : DO_NOT_CONTACT_CLEARED_EVENT,
    on ? "Office marked: do not contact" : "Office allowed contact again", { note: note?.trim() || null, source: "office" }, { internal: true });
  return { on };
}
