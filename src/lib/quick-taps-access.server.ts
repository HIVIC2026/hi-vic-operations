// Quick taps (Jo 2 Nov 2026): who will be at the home to let the installer in, read from the newest
// quick_taps_answered event (details.answers.access). Read-only; nothing is ever sent to the tenant.
// Fails closed: no event, an older event without the answer, an invalid answer or a failed read → nothing shown.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { QUICK_TAPS_ANSWERED_EVENT, accessLine, normaliseAccess } from "./quick-taps.core";

export type JobAccess = { line: string | null };
const NONE: JobAccess = { line: null };

export async function readJobAccess(jobId: string): Promise<JobAccess> {
  try {
    const { data, error } = await admin.from("workflow_events").select("created_at, details").eq("job_id", jobId).eq("event_type", QUICK_TAPS_ANSWERED_EVENT).order("created_at", { ascending: false }).limit(50);
    if (error) { console.error("readJobAccess: read failed", error.code ?? "unknown"); return NONE; }
    // Newest event wins, even when it has no access answer (older events never fill in for it).
    const newest = [...(data ?? [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    const answers = (newest?.details as { answers?: { access?: unknown } } | null)?.answers;
    const a = normaliseAccess(answers?.access);
    const line = accessLine(a);
    return line ? { line } : NONE;
  } catch {
    console.error("readJobAccess: read failed", "exception");
    return NONE;
  }
}
