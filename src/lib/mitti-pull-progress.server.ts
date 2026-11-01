import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { pullMittiPages, type PullDeps, type PullRow } from "./mitti-pull-batch.core";
import { logEvent } from "./workflow.server";

/** Append-only internal progress, not workflow settings. No schema or configuration changes. */
export function mittiPullProgress(stream: string) {
  const event = `mitti_pull_cursor_${stream}`;
  return {
    cursor: async () => {
      const { data, error } = await admin.from("admin_config_events").select("details").eq("event_type", event).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error(`Mitti progress could not be read: ${error.message}`);
      const id = (data?.details as { cursor?: unknown } | null)?.cursor;
      return typeof id === "string" ? id : null;
    },
    checkpoint: async (cursor: string) => {
      const { error } = await admin.from("admin_config_events").insert({ event_type: event, summary: "Mitti pull progress", details: { cursor } });
      if (error) throw new Error(`Mitti progress could not be saved: ${error.message}`);
    },
  };
}

/** Reuse the existing office sync-problem list; unchanged success/failure adds no warning event. */
export async function recordMittiPullOutcome(jobId: string, stream: string, ok: boolean, message: string) {
  const { data, error } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "mitti_pull_sync_state").contains("details", { stream }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Mitti result could not be checked: ${error.message}`);
  const previous = data?.details as { ok?: boolean; message?: string } | null;
  if ((!previous && ok) || (previous?.ok === ok && previous?.message === message)) return;
  await logEvent(jobId, null, "mitti_pull_sync_state", ok ? "Mitti sync recovered" : `Mitti sync failed: ${message}`, { stream, ok, message, needs_office: !ok }, { internal: true });
}

export async function runStoredMittiPull<T extends PullRow>(stream: string, deps: Pick<PullDeps<T>, "page" | "sync">, budgetMs = 40_000, maxJobs?: number) {
  return pullMittiPages({ ...deps, ...mittiPullProgress(stream), failure: (jobId, message) => recordMittiPullOutcome(jobId, stream, false, message) }, { budgetMs, maxJobs });
}