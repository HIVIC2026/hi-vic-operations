// Office compliance review (the job's blocking compliance checks): the automated review and one office decision on a check.
// Moved verbatim from the office `runComplianceReview` / `setComplianceCheck` server functions, which still check the caller
// is office before calling these; the live full-journey runner (TEST jobs) records its office review through the same path.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent, piesaStatus } from "./workflow.server";
import { assignmentEffective } from "./assignment.server";
import { autoAdvanceJob } from "./autoadvance.server";

/** The caller must already be confirmed as office. */
export async function runAutomatedComplianceReview(jobId: string, actorId: string) {
  const { data: job } = await admin.from("jobs").select("eligibility_outcome").eq("id", jobId).single();
  const p = await piesaStatus(jobId);
  const { data: decl } = await admin.from("declarations").select("kind").eq("job_id", jobId);
  const kinds = new Set((decl ?? []).map((d) => d.kind));
  const { data: ev } = await admin.from("evidence_requirements").select("status").eq("job_id", jobId).eq("required", true);
  const { count: openRect } = await admin.from("rectification_items").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("status", "required");
  const auto: Record<string, boolean> = {
    eligibility: job?.eligibility_outcome === "likely_eligible" || job?.eligibility_outcome === "needs_onsite_confirmation",
    owner_consent: kinds.has("owner_consent"),
    owner_authority: await assignmentEffective(jobId),
    electrical_assessment: p?.piesa_outcome === "pass",
    rectification: (openRect ?? 0) === 0,
    installation_evidence: (ev ?? []).every((e) => e.status === "verified"),
    declarations: kinds.has("installer_declaration") && kinds.has("owner_consent"),
  };
  for (const [key, ok] of Object.entries(auto))
    await admin.from("compliance_checks").update({ status: ok ? "pass" : "fail", checked_by: actorId, checked_at: new Date().toISOString(), notes: "Automated check" }).eq("job_id", jobId).eq("check_key", key);
  await logEvent(jobId, actorId, "compliance_reviewed", "Automated compliance review run", auto, { internal: true });
  await autoAdvanceJob(jobId, actorId, "compliance review");
  return { ok: true, auto };
}

/** One office decision on one compliance check. The caller must already be confirmed as office. */
export async function setComplianceCheckStatus(actorId: string, data: { checkId: string; status: "pending" | "pass" | "fail"; notes?: string | undefined }) {
  const { data: c } = await admin.from("compliance_checks").update({ status: data.status, notes: data.notes ?? null, checked_by: actorId, checked_at: new Date().toISOString() }).eq("id", data.checkId).select("job_id,label").single();
  if (c) await logEvent(c.job_id, actorId, "compliance_check", `${c.label}: ${data.status}`, { notes: data.notes }, { internal: true });
  if (c) await autoAdvanceJob(c.job_id, actorId, "compliance check");
  return { ok: true };
}
