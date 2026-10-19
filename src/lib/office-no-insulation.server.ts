// Office "Photos show no insulation" decision. Writes: one permanent office event, the admin Gate 1 decision
// (same fields/audit as the existing admin eligibility action), then a recalculated estimate. Never sends email,
// never touches the homeowner's raw answers, never changes the owner-provided ceiling size.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { NO_INSULATION_EVENT, noInsulationDecisionBlocker } from "./office-no-insulation.core";

export async function recordNoInsulationVisible(jobId: string, by: string | null, reason: string) {
  const { data: job, error } = await admin.from("jobs").select("id, job_number, source, stage, eligibility_outcome, eligibility_decision_source, eligibility_decision_rules").eq("id", jobId).maybeSingle();
  if (error || !job) throw new Error("Job not found.");
  const [docs, ev] = await Promise.all([
    admin.from("documents").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "intake_media"),
    admin.from("evidence_files").select("id", { count: "exact", head: true }).eq("job_id", jobId).like("storage_path", `${jobId}/intake/%`),
  ]);
  if (docs.error || ev.error) throw new Error("Could not check the photos on file.");
  const blocker = noInsulationDecisionBlocker({ source: job.source, stage: job.stage, eligibilityOutcome: job.eligibility_outcome, mediaCount: (docs.count ?? 0) + (ev.count ?? 0), reason });
  if (blocker) throw new Error(blocker);

  const now = new Date();
  const ins = await admin.from("customer_engagement_events").insert({
    job_id: jobId, event_type: NO_INSULATION_EVENT, occurred_at: now.toISOString(), source: "office",
    metadata: { by, reason: reason.trim(), raw_answer_preserved: true }, dedupe_key: `${NO_INSULATION_EVENT}:${jobId}:${now.getTime()}`,
  });
  if (ins.error) throw new Error(`Decision could not be saved: ${ins.error.message}`);

  const { logEvent } = await import("./workflow.server");
  if (job.eligibility_outcome !== "likely_eligible") {
    const upd = await admin.from("jobs").update({ eligibility_outcome: "likely_eligible", eligibility_reason: `Office photo review: no ceiling insulation visible. ${reason.trim()}`, eligibility_set_by: by, eligibility_set_at: now.toISOString(), eligibility_decision_source: "admin", eligibility_review_required: false }).eq("id", jobId);
    if (upd.error) throw new Error(`Eligibility could not be saved: ${upd.error.message}`);
    await logEvent(jobId, by, job.eligibility_decision_source === "system" ? "eligibility_override" : "eligibility_set", "Admin eligibility: likely eligible (photos show no insulation)", { reason: reason.trim(), previous_outcome: job.eligibility_outcome, previous_source: job.eligibility_decision_source, previous_rules: job.eligibility_decision_rules, basis: NO_INSULATION_EVENT });
  }
  await logEvent(jobId, by, "office_no_insulation_visible", "Office photo review: no ceiling insulation visible", { reason: reason.trim(), raw_answer_preserved: true }, { internal: true });

  const { refreshIndicativeEstimate } = await import("./estimate.server");
  const view = await refreshIndicativeEstimate(jobId);
  const est = view.estimate;
  if (!est || view.insulationDeclared !== "none") throw new Error("Decision saved, but the estimate did not update to no insulation. Check the job before sending.");
  return { ok: true as const, jobNumber: job.job_number, areaM2: est.area.m2, areaSource: est.area.source };
}
