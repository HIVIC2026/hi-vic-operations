// Server side of the two-requirement model. Loads measurement + PIESA state and runs the ONE scope derivation.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { deriveScope, type MeasurementLike } from "./scope.core";
import { WorkflowError, getStage, logEvent, piesaStatus, transition } from "./workflow.server";
import { deriveRectificationItems, generateRectificationQuote } from "./quotes.server";

export async function currentMeasurement(jobId: string) {
  const { data } = await admin.from("ceiling_measurements").select("*").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  return data;
}

/** Electrical requirement = the electrical assessment is complete and its PIESA record is current. */
export async function electricalState(jobId: string) {
  const [{ data: a }, piesa] = await Promise.all([
    admin.from("assessments").select("status").eq("job_id", jobId).maybeSingle(),
    piesaStatus(jobId),
  ]);
  return { hasCurrentPiesa: a?.status === "complete" && !!piesa?.piesa_date, piesaExpired: !!piesa?.piesa_expired };
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
 */
export async function advanceSiteRequirements(jobId: string, actorId: string) {
  const s = await jobScope(jobId);
  const stage = await getStage(jobId);
  if (stage !== "assessment_booked") return { advanced: false, scope: s.scope };
  if (s.scope !== "COMPLETE") {
    await admin.from("jobs").update({ next_action: s.nextAction }).eq("id", jobId);
    return { advanced: false, scope: s.scope };
  }
  const { data: a } = await admin.from("assessments").select("id, piesa_outcome").eq("job_id", jobId).single();
  if (!a) throw new WorkflowError("No electrical assessment.");
  await transition(jobId, "assessment_complete", actorId, `Site requirements complete – measure-up accepted, PIESA ${a.piesa_outcome}`, { measured_area_m2: s.measurementRow?.measured_area_m2, measurement_id: s.measurementRow?.id });
  const rectCount = await deriveRectificationItems(jobId, actorId);
  await admin.from("compliance_checks").update({ status: a.piesa_outcome === "pass" && rectCount === 0 ? "pass" : "pending" }).eq("job_id", jobId).eq("check_key", "electrical_assessment");
  if (rectCount > 0 || a.piesa_outcome === "fail") {
    await admin.from("evidence_requirements").update({ required: true, status: "outstanding" }).eq("job_id", jobId).eq("category", "rectification_completion");
    await transition(jobId, "rectification_required", actorId, `${rectCount} rectification item(s) required`);
    if (rectCount > 0) {
      await generateRectificationQuote(jobId, actorId);
      await transition(jobId, "awaiting_owner_rectification_approval", actorId, "Rectification quote issued to owner");
    }
  } else {
    await admin.from("compliance_checks").update({ status: "pass" }).eq("job_id", jobId).eq("check_key", "rectification");
    await transition(jobId, "ready_for_installer_quotes", actorId, "No rectification required – ready for installer quotes");
  }
  await logEvent(jobId, actorId, "site_requirements_complete", "Measure-up and electrical/PIESA requirements both complete", { measurement_id: s.measurementRow?.id }, { internal: true });
  return { advanced: true, scope: "COMPLETE" as const };
}
