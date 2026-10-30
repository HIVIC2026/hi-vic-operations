// Records `excluded_area {name, m2}` once per area per job (office-only event). Idempotent: a repeat read of the same
// Ready Check, or a retry, writes nothing new.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { EXCLUDED_AREA_EVENT, newExcludedAreas, type ExcludedArea } from "./excluded-areas.core";
import { logEvent } from "./workflow.server";

export async function recordExcludedAreas(jobId: string, actorId: string | null, found: readonly ExcludedArea[]): Promise<void> {
  if (!found.length) return;
  const { data, error } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", EXCLUDED_AREA_EVENT);
  if (error) throw new Error(`Left-out areas could not be checked: ${error.message}`);
  const have = (data ?? []).map((r) => String((r.details as { name?: unknown } | null)?.name ?? ""));
  for (const a of newExcludedAreas(found, have)) await logEvent(jobId, actorId, EXCLUDED_AREA_EVENT, `${a.name} left out of the eligible area`, { name: a.name, m2: a.m2 }, { internal: true });
}
