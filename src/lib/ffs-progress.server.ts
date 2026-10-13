// P1-S23B — server side of the FFS (approved partner businessAdmin) minimum field progress record.
//
// Authorisation is derived from trusted server-side data only — never from the browser:
//   1. the caller is authenticated (the server fn's requireSupabaseAuth middleware supplies userId),
//   2. the caller is an ACTIVE member of a business            -> tradeContext()/ctxOrThrow(),
//   3. the caller is that business's business_admin ("boss")   -> c.boss,
//   4. that business holds an ACTIVE assignment on this job    -> requireTradeJob(),
//   5. the operation is only the informational FFS write below (no stage, no completion, no email).
// Because it reuses requireTradeJob(), an FFS member can only ever write to a job their own
// business is actively assigned to — never to another business's job.

import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { ctxOrThrow, requireTradeJob } from "./trade-view.server";
import {
  FFS_PROGRESS_EVENT,
  ffsSummary,
  parseFfsProgress,
  toFfsRecord,
  type FfsRecord,
} from "./ffs-progress.core";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_COLUMNS = "id, created_at, actor_id, event_type, details";

/** Any signed-in member of a business actively assigned to this job (read side). */
async function ffsJobContext(userId: string, jobId: string) {
  if (!UUID.test(jobId)) throw new WorkflowError("This job isn't available to you.");
  const c = await ctxOrThrow(userId); // authenticated + ACTIVE business member + business exists
  await requireTradeJob(userId, jobId); // ACTIVE assignment for this job AND this business
  return c;
}

/** The narrow FFS write rule: business_admin of the assigned business, nothing more. */
export async function requireFfsWriter(userId: string, jobId: string) {
  const c = await ffsJobContext(userId, jobId);
  if (!c.boss) throw new WorkflowError("Only the business admin can record a field update.");
  return c;
}

/** Records one basic, non-regulated progress/result line for the assigned business. */
export async function recordFfsProgress(
  userId: string,
  jobId: string,
  input: { result?: unknown; note?: unknown },
): Promise<{ ok: true; record: FfsRecord }> {
  const c = await requireFfsWriter(userId, jobId);
  let clean: { result: ReturnType<typeof parseFfsProgress>["result"]; note: string };
  try {
    clean = parseFfsProgress(input);
  } catch (e) {
    throw new WorkflowError((e as Error).message);
  }
  // Informational only: no from/to stage, internal so it reaches the office but never the
  // homeowner, the installer or the electrician, and matches no completion/automation rule.
  await logEvent(
    jobId,
    userId,
    FFS_PROGRESS_EVENT,
    ffsSummary(clean.result, clean.note),
    {
      result: clean.result,
      note: clean.note,
      business_id: c.biz.id,
      business_name: c.biz.name,
      source: "ffs_field",
    },
    { internal: true },
  );
  const { data } = await admin
    .from("workflow_events")
    .select(LIST_COLUMNS)
    .eq("job_id", jobId)
    .eq("event_type", FFS_PROGRESS_EVENT)
    .order("created_at", { ascending: false })
    .limit(1);
  const row = (data ?? [])[0] as Parameters<typeof toFfsRecord>[0] | undefined;
  const record = row ? toFfsRecord(row) : null;
  if (!record)
    throw new WorkflowError("The update was saved but could not be read back. Refresh the page.");
  return { ok: true, record };
}

/** What this business may see on the job. Only its own records — never another business's. */
export async function listFfsProgress(
  userId: string,
  jobId: string,
): Promise<{ canRecord: boolean; items: FfsRecord[] }> {
  const c = await ffsJobContext(userId, jobId);
  const { data } = await admin
    .from("workflow_events")
    .select(LIST_COLUMNS)
    .eq("job_id", jobId)
    .eq("event_type", FFS_PROGRESS_EVENT)
    .order("created_at", { ascending: false })
    .limit(50);
  const items = ((data ?? []) as Parameters<typeof toFfsRecord>[0][])
    .map(toFfsRecord)
    .filter((r): r is FfsRecord => !!r)
    .filter((r) => r.businessId === c.biz.id); // no cross-business exposure
  return { canRecord: c.boss, items };
}
