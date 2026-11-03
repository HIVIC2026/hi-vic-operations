// New job flow Part 8 (Jo 2 Nov 2026, answer 16): the Lead Installer's "changes during the job" on the A5 print on the
// SWMS. After each A5 read, when the form carries a change, the signed SWMS is filed again with it — once per distinct set
// of changes. A failure here logs on the job and never blocks the installation record.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { installDaySwmsChanges } from "./install-day.core";
import { swmsChangesKey } from "./swms.core";

export const SWMS_CHANGES_FILED_EVENT = "swms_changes_filed";
export const SWMS_CHANGES_FAILED_EVENT = "swms_changes_refile_failed";

/** none = nothing recorded / old form; unchanged = this set is already filed; waiting = the SWMS is not fully signed yet; */
export type SwmsChangesResult = "none" | "unchanged" | "filed" | "waiting" | "failed";

export async function syncSwmsChanges(jobId: string, actorId: string | null, audit: unknown): Promise<SwmsChangesResult> {
  try {
    const { leadInstallerCert } = await import("./prestart.server");
    const changes = installDaySwmsChanges(audit, (await leadInstallerCert(jobId)).name ?? "Lead Installer");
    const key = swmsChangesKey(changes);
    if (!key) return "none";
    const { data: prev } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", SWMS_CHANGES_FILED_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if ((prev?.details as { key?: string } | null)?.key === key) return "unchanged";
    const { fileSwms } = await import("./swms.server");
    const r = await fileSwms(jobId, actorId, { changes });
    if (!r.filed && !r.path) return "waiting";
    await logEvent(jobId, actorId, SWMS_CHANGES_FILED_EVENT, "Changes during the job added to the safety plan (SWMS)", { key, changes: changes.length, path: r.path }, { internal: true });
    return "filed";
  } catch (e) {
    try { await logEvent(jobId, actorId, SWMS_CHANGES_FAILED_EVENT, "Changes during the job could not be added to the safety plan (SWMS) — it retries on the next sync", { reason: e instanceof Error ? e.message : "error" }, { internal: true }); } catch { /* best effort */ }
    return "failed";
  }
}
