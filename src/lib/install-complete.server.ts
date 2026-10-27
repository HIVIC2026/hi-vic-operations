// ONE guarded, idempotent path that records an installation as complete (decision 213, Jo 24 Oct 2026). The office /
// installer "Complete installation" button and the Mitti Install day Complete sync both come here; nothing else writes
// `installation_completed_at`. Every existing guard stays: confirmed install booking, the A5 ruler photos (decision 396), the
// guarded stage transition. On a refusal nothing is recorded.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, confirmedInstallBooking, logEvent, transition } from "./workflow.server";
import { ASSIGNMENT_EVENTS } from "./assignment.core";
import { autoAdvanceJob } from "./autoadvance.server";

export type InstallCompleteSource = "office_button" | "installer_button" | "mitti_complete";
export type InstallCompleteResult = { ok: true; already: boolean };

/** Already recorded = no second write, no second email, no second event. */
export async function installationAlreadyComplete(jobId: string): Promise<boolean> {
  const { data, error } = await admin.from("jobs").select("installation_completed_at").eq("id", jobId).maybeSingle();
  if (error) throw new WorkflowError("The job could not be read.");
  return !!data?.installation_completed_at;
}

export async function recordInstallationComplete(jobId: string, actorId: string | null, source: InstallCompleteSource): Promise<InstallCompleteResult> {
  if (await installationAlreadyComplete(jobId)) return { ok: true, already: true };
  // P0: no confirmed installation booking = no completion (checked BEFORE any stage change; fails closed).
  const { booking: unlockBooking, blocker } = await confirmedInstallBooking(jobId);
  if (blocker || !unlockBooking) throw new WorkflowError(blocker ?? "No confirmed installation booking.");
  // Decision 396: the old "missing Ready Check photos become install-day photos" lock is gone (its rows are ignored). The
  // legally required ruler photos come from the A5 itself: every area's existing-depth (areas that had insulation) and
  // new-depth photo, geotagged and timed. The Mitti path already holds on them (installCompletionDecision); the office /
  // installer button refuses here too, naming the area. Fails closed on a read error.
  {
    const { latestInstallEvidenceRecord } = await import("./install-evidence.server");
    const { rulerPhotoBlockersOf, RULER_LOCK } = await import("./install-evidence.core");
    let lines: string[];
    try {
      const evidence = await latestInstallEvidenceRecord(jobId);
      const { data: current, error } = await admin.from("workflow_events").select("details, created_at").eq("job_id", jobId).eq("event_type", "mitti_piisa_audit_created").order("created_at", { ascending: false }).limit(1).maybeSingle();
      const auditId = (current?.details as { audit_id?: string } | null)?.audit_id;
      if (error || !auditId || evidence?.audit_id !== auditId || evidence.summary?.jobId !== jobId || evidence.summary?.auditId !== auditId) throw new Error("Current A5 summary missing");
      const { data: failed, error: fe } = await admin.from("workflow_events").select("created_at").eq("job_id", jobId).eq("event_type", "install_evidence_sync_failed").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (fe || (failed && (!evidence.createdAt || failed.created_at >= evidence.createdAt))) throw new Error("A5 refresh failed");
      // Even the same audit cannot reuse a summary after its answers change.
      const { mittiApi, realMittiCall } = await import("./mitti.server");
      const audit = await mittiApi(realMittiCall).getAudit(auditId);
      const fingerprint = await (await import("./mitti-create-claim.core")).stableUuid(JSON.stringify(audit));
      if (!evidence.summary?.auditFingerprint || evidence.summary.auditFingerprint !== fingerprint) throw new Error("A5 changed since evidence was checked");
      lines = rulerPhotoBlockersOf(evidence.summary);
    }
    catch { throw new WorkflowError("The install day form's ruler photos could not be checked — please try again."); }
    if (lines.length) throw new WorkflowError(`${RULER_LOCK}: ${lines.join("; ")}.`);
  }
  const who = source === "mitti_complete" ? "Installation marked complete in the Mitti Install day form (every evidence check passed)" : "Installation marked complete by installer";
  await transition(jobId, "evidence_outstanding", actorId, who);
  await admin.from("jobs").update({ installation_completed_at: new Date().toISOString() }).eq("id", jobId);
  await admin.from("bookings").update({ status: "completed" }).eq("job_id", jobId).eq("kind", "installation").eq("status", "confirmed");
  // Gap 4: record exactly which confirmed install booking unlocked installation (AP review requires it completed).
  await logEvent(jobId, actorId, "install_unlocked_by_booking", "Installation recorded against the confirmed install booking", { booking_id: unlockBooking.id, scheduled_start: unlockBooking.scheduled_start, source }, { internal: true });
  await logEvent(jobId, actorId, ASSIGNMENT_EVENTS.INSTALLATION_COMPLETED, "Eligible installation undertaken", { source });
  // Decision 211: the final installation plan is generated from the recorded areas — the install-day per-zone
  // confirmations (name, m², product) when the Install day form has been read, else the Ready Check areas. Never blocks.
  try {
    const { latestInstallEvidence } = await import("./install-evidence.server");
    const { installZoneConfirmations } = await import("./install-evidence.core");
    const zones = installZoneConfirmations(await latestInstallEvidence(jobId));
    await (await import("./area-diagram.server")).fileFinalAreaDiagram(jobId, actorId, zones.length ? zones : null);
  } catch (e) { console.error("Final area diagram failed", (e as Error).message); }
  await autoAdvanceJob(jobId, actorId, "installation completed");
  // Decision 120/169: the owner is asked to sign the VEEC assignment form at completion — the approved All done email (O44,
  // once per job) plus the approved text, from veec-reminders.server.ts. Best-effort, never blocks.
  try { await (await import("./veec-reminders.server")).sendVeecSignStep(jobId, "request"); } catch (e) { console.error("VEEC sign request failed", (e as Error).message); }
  // Decision 334: O45 final invoice (balance due, bank transfer only), once per invoice through the guarded owner path.
  await (await import("./owner-email-triggers.server")).onFinalInvoiceDue(jobId).catch((e) => console.error("final invoice email skipped", (e as Error).message));
  return { ok: true, already: false };
}
