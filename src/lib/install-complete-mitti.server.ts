// Decision 213: after a Mitti Install day sync, record the installation through the ONE guarded path when every check
// passes; otherwise record why it was held (the installer's Next line) and change nothing. Kept apart from
// install-evidence.server so the autoAdvanceJob import graph never reaches the completion path's O44 sender.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { installCompletionDecision, type InstallEvidenceSummary } from "./install-evidence.core";

// The held event name and the Needs me "no GO" rule live in pure prestart.core (office-needs reads them without this module).
import { INSTALL_COMPLETE_HELD_EVENT } from "./prestart.core";
export { INSTALL_COMPLETE_HELD_EVENT, installNoGoHeldFor } from "./prestart.core";

export async function maybeRecordInstallationFromMitti(jobId: string, actorId: string | null, auditId: string, input: { formCompleted: boolean; declarationSaved: boolean; summary: InstallEvidenceSummary | null; allFilledInTicked?: boolean | null; partB?: { audit: unknown; fetchMedia: import("./mitti.server").MittiMediaFetch } | undefined }): Promise<{ recorded: boolean; reason: string; nextLine: string | null }> {
  const { installationAlreadyComplete, recordInstallationComplete } = await import("./install-complete.server");
  const alreadyCompleted = await installationAlreadyComplete(jobId);
  // Part 9 Task 4: the Q36 signature time against the sent ESC notice and the PIESA date (fail closed on a read error).
  const piisaTiming = alreadyCompleted ? undefined : await piisaTimingFor(jobId, auditId);
  const decision = installCompletionDecision({ ...input, alreadyCompleted, piisaTiming });
  // Part 8 Task 7: the Lead Installer's Mitti Part B signs the VEEC assignment once the installation is recorded (also the retry
  // when it was recorded earlier). Idempotent; a failure is logged and never undoes the recorded installation.
  const applyPartB = async () => {
    if (!input.partB) return;
    try { await (await import("./veec-part-b-mitti.server")).applyMittiPartB(jobId, auditId, input.partB.audit, input.partB.fetchMedia); }
    catch (e) { try { await logEvent(jobId, actorId, "veec_part_b_mitti_failed", "VEEC Part B from Mitti could not be applied — it retries on the next sync", { audit_id: auditId, reason: e instanceof Error ? e.message : "error" }, { internal: true }); } catch { /* best effort */ } }
  };
  const hold = async (reason: string, nextLine: string | null, outstanding: string[], extra: { no_go?: true } = {}) => {
    const { data: prev } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", INSTALL_COMPLETE_HELD_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const details = { audit_id: auditId, reason, next_line: nextLine, outstanding, ...extra };
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
    // Jo 7 Nov 2026: no GO for this start — the synced evidence stays, the job stays where it is, and `no_go` puts the
    // DON'T START row on Needs me / the job page (office-needs.server installNoGoHeldFor) until it is sorted.
    return hold(msg, `Installation complete is held: ${msg}`, [msg], (e as { noGo?: boolean } | null)?.noGo ? { no_go: true } : {});
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

/** Part 9 Task 4: PIISA timing facts for this A5 audit — the stored Q36 signature time (piisa_prestart_captured), the current
 *  notice's sent time (only when it is actually recorded as sent) and the PIESA completion date — through the one pure rule
 *  (esc.core piisaTimingBlockers). A read failure returns its own blocker line: the install is held, never recorded. */
export async function piisaTimingFor(jobId: string, auditId: string): Promise<string[]> {
  try {
    const [{ latestPrestart }, { latestNotices }, { clearanceFacts }, { piisaTimingBlockers }, { noEscFor }] = await Promise.all([
      import("./piisa-prestart.server"), import("./prestart.server"), import("./electrical-clearance.server"), import("./esc.core"), import("./no-esc.server"),
    ]);
    // Part 9 Task 14: a real-run job marked "no ESC" skips the notice lines only (the 30-day PIESA rule still holds); a failed marker read holds.
    const [stored, { current }, cf, noEsc] = await Promise.all([latestPrestart(jobId, auditId), latestNotices(jobId), clearanceFacts(jobId), noEscFor(jobId)]);
    const sentAt = current && (current.status === "sent" || current.status === "accepted") && current.sent_at && current.submission_reference ? current.sent_at : null;
    return piisaTimingBlockers({ piisaSignedAt: stored?.snapshot?.signature?.signed_at ?? null, noticeSentAt: sentAt, piesaCompletedAt: cf.piesaCompletedAt ?? null, noEsc });
  } catch (e) {
    return [`PIISA timing could not be checked (${e instanceof Error ? e.message : "read failed"}) — sync again`];
  }
}
