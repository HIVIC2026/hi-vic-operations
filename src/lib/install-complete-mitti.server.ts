// Decision 213: after a Mitti Install day sync, record the installation through the ONE guarded path when every check
// passes; otherwise record why it was held (the installer's Next line) and change nothing. Kept apart from
// install-evidence.server so the autoAdvanceJob import graph never reaches the completion path's O44 sender.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { installCompletionDecision, type InstallEvidenceSummary } from "./install-evidence.core";

export const INSTALL_COMPLETE_HELD_EVENT = "install_complete_auto_held";

export async function maybeRecordInstallationFromMitti(jobId: string, actorId: string | null, auditId: string, input: { formCompleted: boolean; declarationSaved: boolean; summary: InstallEvidenceSummary | null; allFilledInTicked?: boolean | null; partB?: { audit: unknown; fetchMedia: import("./mitti.server").MittiMediaFetch } | undefined }): Promise<{ recorded: boolean; reason: string; nextLine: string | null }> {
  const { installationAlreadyComplete, recordInstallationComplete } = await import("./install-complete.server");
  const alreadyCompleted = await installationAlreadyComplete(jobId);
  const decision = installCompletionDecision({ ...input, alreadyCompleted });
  // Part 8 Task 7: the Lead Installer's Mitti Part B signs the VEEC assignment once the installation is recorded (also the retry
  // when it was recorded earlier). Idempotent; a failure is logged and never undoes the recorded installation.
  const applyPartB = async () => {
    if (!input.partB) return;
    try { await (await import("./veec-part-b-mitti.server")).applyMittiPartB(jobId, auditId, input.partB.audit, input.partB.fetchMedia); }
    catch (e) { try { await logEvent(jobId, actorId, "veec_part_b_mitti_failed", "VEEC Part B from Mitti could not be applied — it retries on the next sync", { audit_id: auditId, reason: e instanceof Error ? e.message : "error" }, { internal: true }); } catch { /* best effort */ } }
  };
  const hold = async (reason: string, nextLine: string | null, outstanding: string[]) => {
    const { data: prev } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", INSTALL_COMPLETE_HELD_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const details = { audit_id: auditId, reason, next_line: nextLine, outstanding };
    if (JSON.stringify(prev?.details ?? null) !== JSON.stringify(details)) await logEvent(jobId, actorId, INSTALL_COMPLETE_HELD_EVENT, `Installation not recorded from Mitti: ${reason}`, details, { internal: true });
    return { recorded: false, reason, nextLine };
  };
  if (!decision.record && alreadyCompleted) { await applyPartB(); return { recorded: false, reason: decision.reason, nextLine: null }; }
  if (!decision.record) return decision.nextLine ? hold(decision.reason, decision.nextLine, decision.outstanding) : { recorded: false, reason: decision.reason, nextLine: null };
  try {
    const r = await recordInstallationComplete(jobId, actorId, "mitti_complete");
    await applyPartB();
    return { recorded: !r.already, reason: r.already ? "Installation already recorded" : decision.reason, nextLine: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Installation could not be recorded.";
    return hold(msg, `Installation complete is held: ${msg}`, [msg]);
  }
}

/** Latest hold reason for the installer's screen (null when none or when the installation was recorded since). */
export async function installCompleteHold(jobId: string): Promise<{ nextLine: string | null; outstanding: string[] } | null> {
  const { data: job } = await admin.from("jobs").select("installation_completed_at").eq("id", jobId).maybeSingle();
  if (job?.installation_completed_at) return null;
  const { data } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", INSTALL_COMPLETE_HELD_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const d = data?.details as { next_line?: string | null; outstanding?: string[] } | null;
  return d ? { nextLine: d.next_line ?? null, outstanding: d.outstanding ?? [] } : null;
}
