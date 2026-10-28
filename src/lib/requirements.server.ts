// Server side of the two-requirement model. Loads measurement + PIESA state and runs the ONE scope derivation.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { deriveScope, type MeasurementLike } from "./scope.core";
import { WorkflowError, getStage, logEvent, piesaStatus, transition } from "./workflow.server";
import { deriveRectificationItems, generateRectificationQuote } from "./quotes.server";
import { PIESA_ADVANCE_STAGE, piesaAdvanceDecision, piesaClearsElectrical, piesaNeedsRectification } from "./piesa-advance.core";

export async function currentMeasurement(jobId: string) {
  const { data } = await admin.from("ceiling_measurements").select("*").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  return data;
}

/** Electrical requirement = the electrical assessment is complete and its PIESA record is current. Batch 1 task 6: a
 *  PIESA record made before the job's latest reopen no longer counts, so it can never move a reopened job on. */
export async function electricalState(jobId: string) {
  const [{ data: a }, piesa, superseded] = await Promise.all([
    admin.from("assessments").select("status").eq("job_id", jobId).maybeSingle(),
    piesaStatus(jobId),
    import("./repeat-piesa.server").then((m) => m.currentPiesaSupersededByReopen(jobId)),
  ]);
  return { hasCurrentPiesa: a?.status === "complete" && !!piesa?.piesa_date && !superseded, piesaExpired: !!piesa?.piesa_expired };
}

export async function jobScope(jobId: string) {
  const [m, electrical, { data: job }] = await Promise.all([
    currentMeasurement(jobId), electricalState(jobId),
    admin.from("jobs").select("measure_up_responsibility").eq("id", jobId).single(),
  ]);
  return { ...deriveScope({ measurement: m as MeasurementLike | null, electrical, measureUpBy: "installer" }), measurementRow: m };
}

/**
 * After either requirement completes: if BOTH are satisfied and the job is in assessment booked,
 * move to assessment_complete and run the existing rectification / quote-readiness path.
 * Otherwise stay put with next_action saying exactly what is missing.
 *
 * Phase 1 electrician path (S64): the manual PIESA result is recorded at `piesa_scheduled`, so the same
 * completion must move that job on to `piesa_complete` — the only forward transition the stage graph allows.
 * Nothing moves until the assessment is complete, its outcome is recorded and a current PIESA record exists.
 *
 * Duplication note: `completeAssessment` also advances `piesa_scheduled` → `piesa_complete`, but only in its
 * own branch, and it never calls this function on that path (`portal.functions.ts`: the piesa branch returns
 * directly; the `else` branch is the retired `assessment_booked` path). Because either path leaves the job at
 * `piesa_complete`, this branch cannot fire a second time for the same completion — the two are mutually
 * exclusive, not duplicated.
 */
export async function advanceSiteRequirements(jobId: string, actorId: string) {
  const s = await jobScope(jobId);
  const stage = await getStage(jobId);
  if (stage === PIESA_ADVANCE_STAGE) return advanceAfterPiesa(jobId, actorId, s.scope);
  if (stage !== "assessment_booked") return { advanced: false, scope: s.scope };
  if (s.scope !== "COMPLETE") {
    await admin.from("jobs").update({ next_action: s.nextAction }).eq("id", jobId);
    return { advanced: false, scope: s.scope };
  }
  const { data: a } = await admin.from("assessments").select("id, piesa_outcome").eq("job_id", jobId).single();
  if (!a) throw new WorkflowError("No electrical assessment.");
  await transition(jobId, "assessment_complete", actorId, `Site requirements complete – Ready Check accepted, PIESA ${a.piesa_outcome}`, { measured_area_m2: s.measurementRow?.measured_area_m2, measurement_id: s.measurementRow?.id });
  const rectCount = await deriveRectificationItems(jobId, actorId);
  await admin.from("compliance_checks").update({ status: a.piesa_outcome === "pass" && rectCount === 0 ? "pass" : "pending" }).eq("job_id", jobId).eq("check_key", "electrical_assessment");
  if (rectCount > 0 || a.piesa_outcome === "fail") {
    await admin.from("evidence_requirements").update({ required: true, status: "outstanding" }).eq("job_id", jobId).eq("category", "rectification_completion");
    await transition(jobId, "rectification_required", actorId, `${rectCount} electrical fixes item(s) required`);
    if (rectCount > 0) {
      await generateRectificationQuote(jobId, actorId);
      await transition(jobId, "awaiting_owner_rectification_approval", actorId, "Electrical fixes quote issued to owner");
    }
  } else {
    await admin.from("compliance_checks").update({ status: "pass" }).eq("job_id", jobId).eq("check_key", "rectification");
    await transition(jobId, "ready_for_installer_quotes", actorId, "No electrical fixes required – ready for installer quotes");
  }
  await logEvent(jobId, actorId, "site_requirements_complete", "Ready Check and electrical/PIESA requirements both complete", { measurement_id: s.measurementRow?.id }, { internal: true });
  return { advanced: true, scope: "COMPLETE" as const };
}

/**
 * `piesa_scheduled` → `piesa_complete` after a completed manual PIESA result.
 * The stage means "the PIESA visit is complete", not "the PIESA passed": a fail also lands here and is
 * rectified from `piesa_complete`. A standing guard (for example an unresolved PIESA Part 7 hazard)
 * keeps the job where it is and puts the reason in front of Office instead of throwing after the
 * assessment was already recorded.
 *
 * Fails closed: `piesaAdvanceDecision` refuses to move on an incomplete assessment, a missing outcome or
 * a missing current PIESA record, so no stage change can happen on partial facts.
 */
async function advanceAfterPiesa(jobId: string, actorId: string, scope: string) {
  // Decision 178: an onsite-form PIESA holds until its evidence is on the synced form (same pure rule as the sync
  // and the stage gate; one assessment-row read, no network).
  const [{ data: a }, electrical, evidenceBlockers] = await Promise.all([
    admin.from("assessments").select("id, status, piesa_outcome").eq("job_id", jobId).maybeSingle(),
    electricalState(jobId),
    (await import("./piesa-evidence.server")).piesaEvidenceHold(jobId),
  ]);
  const decision = piesaAdvanceDecision({
    stage: PIESA_ADVANCE_STAGE,
    assessmentStatus: a?.status,
    outcome: a?.piesa_outcome,
    hasCurrentPiesa: electrical.hasCurrentPiesa,
    evidenceBlockers,
  });
  if (decision.action === "hold") return { advanced: false, scope, held: decision.reason };
  try {
    await transition(jobId, "piesa_complete", actorId, `PIESA ${decision.outcome} recorded – Pre Insulation Electrical Safety Assessment (PIESA) complete`, { assessment_id: a?.id, piesa_outcome: decision.outcome });
  } catch (e) {
    if (!(e instanceof WorkflowError)) throw e;
    await admin.from("jobs").update({ next_action: e.message.replace(/^Blocked:\s*/, "") }).eq("id", jobId);
    return { advanced: false, scope, held: e.message };
  }
  // The safety check visit is done: mark the confirmed assessment booking completed (same as piesa-complete.server), so the
  // electrician's pay line shows and a later reopen never cancels a finished visit.
  const { error: visitErr } = await admin.from("bookings").update({ status: "completed" }).eq("job_id", jobId).eq("kind", "assessment").eq("status", "confirmed");
  if (visitErr) console.error("safety check visit not marked done", visitErr.message);
  const rectCount = await deriveRectificationItems(jobId, actorId);
  await admin.from("compliance_checks").update({ status: piesaClearsElectrical(decision.outcome, rectCount) ? "pass" : "pending" }).eq("job_id", jobId).eq("check_key", "electrical_assessment");
  if (piesaNeedsRectification(decision.outcome, rectCount)) {
    await admin.from("evidence_requirements").update({ required: true, status: "outstanding" }).eq("job_id", jobId).eq("category", "rectification_completion");
  } else {
    await admin.from("compliance_checks").update({ status: "pass" }).eq("job_id", jobId).eq("check_key", "rectification");
  }
  await logEvent(jobId, actorId, "site_requirements_complete", `PIESA ${decision.outcome} recorded – Pre Insulation Electrical Safety Assessment (PIESA) complete`, { assessment_id: a?.id, rectification_items: rectCount }, { internal: true });
  return { advanced: true, scope: "COMPLETE" as const };
}
