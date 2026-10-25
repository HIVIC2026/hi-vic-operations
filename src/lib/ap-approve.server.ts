// AP approves ONE job on the Final check (decision 372): its own permanent record (who, when, note, flags shown), never bulk,
// never automatic, refused unless every Final check item passes; `transition` re-runs every guard. Moved verbatim from the
// office `approveApJob` server function, which still checks the caller is office before calling this; the live full-journey
// runner (TEST jobs) records the office's AP approval through the same path.
import { WorkflowError, getStage, logEvent, transition } from "./workflow.server";

/** The caller must already be confirmed as office. */
export async function approveApJobAs(jobId: string, actorId: string, note?: string | undefined) {
  if ((await getStage(jobId)) !== "ap_review") throw new WorkflowError("This job is no longer waiting for Final check.");
  const { jobApFlags } = await import("./ap-queue.server");
  const { approvalNoteBlocker } = await import("./ap-flags.core");
  const flags = (await jobApFlags([jobId])).get(jobId) ?? [];
  const block = approvalNoteBlocker(flags, note);
  if (block) throw new WorkflowError(block);
  const { finalCheckScreen } = await import("./final-check.server");
  const fc = await finalCheckScreen(jobId, actorId);
  if (!fc.ready) throw new WorkflowError(`Final check not passed: ${fc.reasons.join(" · ")}`);
  await transition(jobId, "ready_for_veec", actorId, "AP approved – Ready for VEEC");
  await logEvent(jobId, actorId, "ap_approved", flags.length ? `AP approved a flagged job: ${note!.trim()}` : `AP approved${note?.trim() ? `: ${note.trim()}` : ""}`, { note: note?.trim() || null, flags, approved_at: new Date().toISOString(), final_check: fc.items.map((i) => ({ key: i.key, state: i.state })) }, { internal: true });
  return { ok: true };
}
