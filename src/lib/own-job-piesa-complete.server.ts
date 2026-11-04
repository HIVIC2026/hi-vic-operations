// Part 3 Task 4b (Jo 4 Nov 2026): on an installer's own job (channel installer_sourced, not held by an in-house partner)
// the electrician has no portal login, so nobody presses Complete PIESA. When the A3 sync reads a Complete form at PIESA
// booked, this runs the SAME completion (`completePiesaAssessment`, every check) once per version of the Mitti form: the
// claim is one `piesa_auto_completed` event with a stable id on job + form + the form's modified time. A refusal is ONE
// internal `own_job_piesa_complete_held` office row with the reason (the newest one shows while the PIESA is still booked).
// An edited form (new modified time) is tried again; an unchanged re-sync never is, so there is no loop. The office can
// still press Complete PIESA.
// HIV leads and in-house jobs are left alone: the electrician / office presses Complete PIESA as before.
// Never sends anything and never throws (the sync carries on).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { OWN_JOB_PIESA_COMPLETE_HELD_EVENT, PIESA_AUTO_COMPLETED_EVENT } from "./own-job-piesa.core";
import { isUniqueViolation, stableUuid } from "./mitti-create-claim.core";

export type AutoCompleteOutcome = "completed" | "held" | "already" | "not_own_job" | "not_due" | "unreadable";

export async function autoCompleteOwnJobPiesa(jobId: string, auditId: string, actorId: string | null, modifiedAt: string | null): Promise<AutoCompleteOutcome> {
  try {
    const key = `${jobId}:${auditId}:${modifiedAt ?? "unknown"}`;
    // Fail closed: an unreadable job / in-house state claims nothing, so the next sync tries again.
    const own = await (await import("./own-job-piesa.server")).ownJobCallAndBook(jobId);
    if (own === null) return "unreadable";
    if (!own) return "not_own_job";
    const { getStage } = await import("./workflow.server");
    if ((await getStage(jobId)) !== "piesa_scheduled") return "not_due";
    // Signed off by the job's electrician (their own PIESA), else the person or tick that ran the sync.
    const { data: asg, error: asgError } = await admin.from("job_assignments").select("user_id").eq("job_id", jobId).eq("role", "electrician").eq("active", true).order("assigned_at", { ascending: false }).limit(1);
    if (asgError) return "unreadable";
    const userId = ((asg ?? []) as { user_id: string | null }[])[0]?.user_id ?? actorId;
    const claim = await admin.from("workflow_events").insert({
      id: await stableUuid(`piesa-auto-complete:${key}`), job_id: jobId, actor_id: actorId, event_type: PIESA_AUTO_COMPLETED_EVENT,
      summary: "Safety check (PIESA) done in Mitti — completing it automatically", details: { audit_id: auditId, modified_at: modifiedAt, signed_off_by: userId }, internal: true,
    });
    if (claim.error) return isUniqueViolation(claim.error) ? "already" : "unreadable";
    let reason: string;
    if (!userId) reason = "No electrician on the job to sign it off";
    else {
      try {
        await (await import("./piesa-complete.server")).completePiesaAssessment({ jobId }, userId);
        return "completed";
      } catch (e) { reason = e instanceof Error ? e.message : "Complete PIESA failed"; }
    }
    const { ownJobPiesaCompleteHeldLine } = await import("./own-job-piesa.core");
    const held = await admin.from("workflow_events").insert({
      id: await stableUuid(`own-job-piesa-complete-held:${key}`), job_id: jobId, actor_id: actorId, event_type: OWN_JOB_PIESA_COMPLETE_HELD_EVENT,
      summary: ownJobPiesaCompleteHeldLine(reason), // Internal: the office Needs read doesn't filter on it, and it must never show on the no-login worker job link.
      details: { audit_id: auditId, modified_at: modifiedAt, reason, needs_office: true }, internal: true,
    });
    if (held.error && !isUniqueViolation(held.error)) console.error("own job PIESA hold not recorded", jobId, held.error.message);
    return "held";
  } catch (e) {
    console.error("own job PIESA auto-complete skipped", jobId, e instanceof Error ? e.message : "error");
    return "unreadable";
  }
}
