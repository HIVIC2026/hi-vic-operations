// ONE write path for "electrical fixes done + PIESA Section C signed" (the post_rectification PIESA record).
// Used by the portal "record fixes done" page (portal.functions recordPiesa) and, since decision 293 (Jo 25 Oct 2026),
// by the Mitti "A4 – Electrical fixes" form completion (fixes-day.server.ts). Callers validate first (role, stage,
// evidence, Section C dates); this module only writes the same records the portal page always wrote, in the same order:
// rectification items completed → piesa_records (new current post_rectification row) → piesa_recorded event → on a pass
// compliance checks, the fixes booking completed, the guarded transition to installation scheduling → autoAdvance →
// the one installer clearance notice (decision 186). Nothing here sends to the owner.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, getStage, logEvent, transition } from "./workflow.server";
import { autoAdvanceJob } from "./autoadvance.server";

export type PostRectificationRecord = {
  jobId: string;
  /** The person recording: the electrician / office user, or null for the Mitti form completion (actor = the form). */
  actorId: string | null;
  kind: "post_rectification" | "reassessment";
  outcome: "pass" | "fail";
  /** Melbourne calendar dates (YYYY-MM-DD). */
  completedDate: string;
  sectionCSignedDate?: string | null;
  notes?: string | null;
  /** Where the record came from, kept on the event (portal page or the Mitti fixes form's audit id). */
  source?: { kind: "portal" } | { kind: "mitti_fixes_form"; auditId: string };
};

/** Who may record a reassessment PIESA (null = allowed): the 30-day window expired, or (batch 1 task 6) the job was
 *  reopened so the earlier check no longer counts — then once the new visit is booked. */
export async function reassessmentBlocker(jobId: string, stage: string): Promise<string | null> {
  if (await (await import("./repeat-piesa.server")).currentPiesaSupersededByReopen(jobId)) {
    if (stage === "piesa_scheduled") return null;
    const { STAGE_LABEL } = await import("./workflow");
    return `The PIESA can be completed once it is booked (current: ${STAGE_LABEL[stage as keyof typeof STAGE_LABEL] ?? stage}).`;
  }
  const { piesaStatus } = await import("./workflow.server");
  const p = await piesaStatus(jobId);
  return !p?.piesa_expired && stage !== "assessment_complete" ? "Reassessment is only needed when the PIESA window has expired." : null;
}

/** Writes the PIESA record exactly as the portal page does. Returns the new piesa_records row id when returned. */
export async function applyPiesaRecord(r: PostRectificationRecord): Promise<{ recordId: string | null }> {
  const post = r.kind === "post_rectification";
  if (post && r.outcome === "pass" && !r.sectionCSignedDate) throw new WorkflowError("Section C signed date is required for a post-rectification PIESA record.");
  let recordId: string | null = null;
  let duplicate = false;
  if (r.source?.kind === "mitti_fixes_form") {
    const { data: existing, error } = await admin.from("workflow_events").select("details").eq("job_id", r.jobId).eq("event_type", "piesa_recorded").contains("details", { source: "mitti_fixes_form", audit_id: r.source.auditId }).maybeSingle();
    if (error) throw new Error(error.message);
    if (existing) { duplicate = true; recordId = (existing.details as { record_id?: string } | null)?.record_id ?? null; }
  }
  if (!duplicate) {
  await (await import("./fixes-day.server")).closeUnusedRectificationForm(r.jobId);
  if (post) await admin.from("rectification_items").update({ status: "completed" }).eq("job_id", r.jobId).eq("status", "required");
  await admin.from("piesa_records").update({ is_current: false }).eq("job_id", r.jobId).eq("is_current", true);
  const { data: rec, error: recordError } = await admin.from("piesa_records").insert({
    job_id: r.jobId,
    kind: r.kind,
    outcome: r.outcome,
    completed_date: r.completedDate,
    signed_off_by: r.actorId,
    notes: r.notes ?? null,
    ...(post ? { rectification_completed_at: `${r.completedDate}T00:00:00.000Z` } : {}),
    ...(post && r.outcome === "pass" ? { section_c_signed_at: `${r.sectionCSignedDate}T00:00:00.000Z` } : {}),
  }).select("id").maybeSingle();
  if (recordError) throw new Error(recordError.message);
  await logEvent(r.jobId, r.actorId, "piesa_recorded", `PIESA (${r.kind.replace("_", " ")}) ${r.outcome} on ${r.completedDate}${r.source?.kind === "mitti_fixes_form" ? " — from the Mitti rectification form" : ""}`,
    r.source?.kind === "mitti_fixes_form" ? { source: "mitti_fixes_form", audit_id: r.source.auditId, record_id: rec?.id ?? null } : {});
  recordId = rec?.id ?? null;
  }
  if (post && r.outcome === "pass") {
    if (!duplicate) {
    await admin.from("compliance_checks").update({ status: "pass", checked_at: new Date().toISOString() }).eq("job_id", r.jobId).in("check_key", ["rectification", "electrical_assessment"]);
    await admin.from("bookings").update({ status: "completed" }).eq("job_id", r.jobId).eq("kind", "rectification").eq("status", "confirmed");
    }
    if ((await getStage(r.jobId)) === "piesa_scheduled" && await (await import("./in-house-rectification.server")).optionalPartnerBilledRectificationFor(r.jobId)) {
      await transition(r.jobId, "piesa_complete", r.actorId, "PIESA and Part C rectification completed on the same visit");
    }
    if (!duplicate || ["piesa_complete", "rectification_booked", "assessment_complete", "electrical_variation_pending"].includes(await getStage(r.jobId)))
      await transition(r.jobId, "installation_scheduling", r.actorId, "Rectification complete, PIESA passed – installation scheduling unlocked");
  }
  // Batch 1 task 6: the new safety check after a reopen is a reassessment at PIESA booked — the visit is done, so the job
  // moves on to PIESA complete the same guarded way Complete PIESA does (a standing guard keeps it put with the reason).
  if (r.kind === "reassessment" && (await getStage(r.jobId)) === "piesa_scheduled") {
    const { error: visitErr } = await admin.from("bookings").update({ status: "completed" }).eq("job_id", r.jobId).eq("kind", "assessment").eq("status", "confirmed");
    if (visitErr) console.error("safety check visit not marked done", visitErr.message);
    try { await transition(r.jobId, "piesa_complete", r.actorId, `PIESA complete – ${r.outcome} (new safety check after the job was reopened)`, { piesa_outcome: r.outcome, reassessment: true }); }
    catch (e) { if (!(e instanceof WorkflowError)) throw e; await admin.from("jobs").update({ next_action: e.message.replace(/^Blocked:\s*/, "") }).eq("id", r.jobId); }
  }
  await autoAdvanceJob(r.jobId, r.actorId, "PIESA recorded");
  // Decision 186: fixes complete + Section C signed is electrical clearance — tell the installer once (nothing when not cleared).
  try { await (await import("./install-clearance.server")).notifyInstallerClearance(r.jobId); } catch (e) { console.error("install clearance notice failed", (e as Error).message); }
  return { recordId };
}
