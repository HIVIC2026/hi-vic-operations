// Part 9 Task 14: readers and the one writer for the per-job "no ESC" marker (no-esc.core). Fails closed: a read error
// throws, so every ESC boundary that asks refuses instead of going ahead.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { logEvent, WorkflowError } from "./workflow.server";
import { escWithdrawalNeeded } from "./esc.core";
import { NO_ESC_MARKER_SET_EVENT, NO_ESC_NOTICE_ALREADY_SENT, NO_ESC_REFUSAL, noEscMarked, withNoEscMarker } from "./no-esc.core";

/** Is this job marked "no ESC"? Read error or missing job → throws (never "not marked"). */
export async function noEscFor(jobId: string): Promise<boolean> {
  const { data, error } = await admin.from("jobs").select("external_refs").eq("id", jobId).maybeSingle();
  if (error) throw new Error(`Couldn't read the job's no-ESC marker: ${error.message}`);
  if (!data) throw new Error("Couldn't read the job's no-ESC marker: job not found");
  return noEscMarked(data.external_refs);
}

/** Marked jobs among `jobIds` (one read). Read error → throws. */
export async function noEscJobIds(jobIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < jobIds.length; i += 150) {
    const { data, error } = await admin.from("jobs").select("id, external_refs").in("id", jobIds.slice(i, i + 150));
    if (error) throw new Error(`Couldn't read the no-ESC markers: ${error.message}`);
    for (const j of data ?? []) if (noEscMarked(j.external_refs)) out.add(String(j.id));
  }
  return out;
}

/** Throws NO_ESC_REFUSAL when the job is marked; a read failure throws too (fail closed). Call BEFORE any write. */
export async function assertNotNoEsc(jobId: string): Promise<void> {
  if (await noEscFor(jobId)) throw new WorkflowError(NO_ESC_REFUSAL);
}

/** Office only (the caller checks). One-way: there is no clear. Refused while a sent, un-withdrawn notice exists. A
 *  second call on a marked job changes nothing and writes no second event. */
export async function setNoEscMarker(jobId: string, actorId: string | null, reason: string): Promise<{ marked: boolean; already: boolean }> {
  const { data: job, error } = await admin.from("jobs").select("id, external_refs").eq("id", jobId).maybeSingle();
  if (error) throw new WorkflowError(`Couldn't read the job: ${error.message}`);
  if (!job) throw new WorkflowError("Job not found");
  if (noEscMarked(job.external_refs)) return { marked: true, already: true };
  const { data: notices, error: nErr } = await admin.from("esc_notifications").select("id, status, sent_at, submission_reference, response").eq("job_id", jobId).not("sent_at", "is", null);
  if (nErr) throw new WorkflowError(`Couldn't read the ESC notices: ${nErr.message}`);
  if (escWithdrawalNeeded(notices ?? []).length) throw new WorkflowError(NO_ESC_NOTICE_ALREADY_SENT);
  const { error: wErr } = await admin.from("jobs").update({ external_refs: withNoEscMarker(job.external_refs) as Json }).eq("id", jobId);
  if (wErr) throw new WorkflowError(`Couldn't set the no-ESC marker: ${wErr.message}`);
  await logEvent(jobId, actorId, NO_ESC_MARKER_SET_EVENT, `Marked "no ESC" (real run): nothing goes to the ESC Registry and no certificates are created. ${reason}`.trim(), { reason }, { internal: true });
  return { marked: true, already: false };
}
