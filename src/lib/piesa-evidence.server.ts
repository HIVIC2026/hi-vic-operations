// Decision 178: PIESA evidence hold read from the stored onsite-form snapshot. The only I/O is one read of the
// job's assessment row; the rule itself is pure (piesa-evidence.core.ts) and identical to the one the sync applies.
// No network, no writes, no Mitti call — the snapshot already carries the media metadata the sync attached.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { piesaEvidenceBlockersFromSnapshot } from "./piesa-evidence.core";
import { shortAnswersFromEntries } from "./official-short.core";

/** Blockers for a Mitti-based PIESA (empty for a non-Mitti PIESA or when every required evidence item is in). */
export async function piesaEvidenceHold(jobId: string): Promise<string[]> {
  const { data: a } = await admin.from("assessments").select("external_mitti_id,mitti_raw_snapshot").eq("job_id", jobId).maybeSingle();
  if (!a?.external_mitti_id) return [];
  return piesaEvidenceBlockersFromSnapshot(a.mitti_raw_snapshot, (entries) => shortAnswersFromEntries("piesa", entries));
}
