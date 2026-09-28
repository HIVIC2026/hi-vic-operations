// CENTRAL WORKFLOW RULES. All stage transitions, guards and audit logging live here.
// Server-only: uses the service-role client AFTER the caller's permission has been checked.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { DEFAULT_NEXT_ACTION, STAGE_LABEL, type JobRole, type Stage } from "./workflow";
import { authorityValid } from "./authority.server";

export class WorkflowError extends Error {}

type Sb = SupabaseClient<Database>;

/**
 * Allowed forward/back transitions. on_hold/cancelled handled separately by admin.
 * Rectification path: owner approves scope -> installer quotes (incl. rectification lines, one combined total)
 * -> owner accepts -> Xero invoice -> 50% deposit -> rectification scheduling -> PIESA -> installation scheduling.
 */
export const TRANSITIONS: Partial<Record<Stage, Stage[]>> = {
  new_enquiry: ["eligibility_review", "awaiting_electrician"],
  eligibility_review: ["awaiting_electrician"],
  awaiting_electrician: ["assessment_booking"],
  assessment_booking: ["assessment_booked"],
  assessment_booked: ["assessment_complete", "assessment_booking"],
  assessment_complete: ["rectification_required", "ready_for_installer_quotes"],
  rectification_required: ["awaiting_owner_rectification_approval"],
  awaiting_owner_rectification_approval: ["ready_for_installer_quotes", "rectification_required"],
  ready_for_installer_quotes: ["awaiting_quote_acceptance"],
  awaiting_quote_acceptance: ["awaiting_deposit_payment", "ready_for_installer_quotes"],
  awaiting_deposit_payment: ["rectification_scheduling", "installation_scheduling"],
  rectification_scheduling: ["rectification_booked"],
  rectification_booked: ["installation_scheduling", "rectification_scheduling"],
  installation_scheduling: ["installation_booked"],
  installation_booked: ["evidence_outstanding", "installation_scheduling"],
  evidence_outstanding: ["ap_review"],
  ap_review: ["ready_for_veec", "evidence_outstanding"],
  ready_for_veec: ["complete"],
};

/** Stages that may only be entered while the PIESA 30-day window is valid. */
const PIESA_WINDOW_STAGES: Stage[] = ["installation_scheduling", "installation_booked", "evidence_outstanding"];

/** Stages that require a valid (accepted, unexpired, unrevoked) Owner Authority. */
export const AUTHORITY_STAGES: Stage[] = [
  "assessment_booked", "rectification_scheduling", "rectification_booked",
  "installation_scheduling", "installation_booked", "ready_for_veec",
];
export const AUTHORITY_BLOCKER = "Valid Owner Authority required";

export async function requireJobRole(sb: Sb, jobId: string, allowed: JobRole[]): Promise<JobRole> {
  const { data, error } = await sb.rpc("my_job_role", { _job: jobId });
  if (error) throw new Error(error.message);
  const role = data as JobRole | null;
  if (!role || !allowed.includes(role)) throw new WorkflowError("You don't have permission for this action on this job.");
  return role;
}

export async function requireAdmin(sb: Sb) {
  const { data, error } = await sb.rpc("is_admin");
  if (error) throw new Error(error.message);
  if (!data) throw new WorkflowError("Admin only.");
}

export async function logEvent(
  jobId: string,
  actorId: string | null,
  eventType: string,
  summary: string,
  details: Record<string, unknown> = {},
  opts: { from?: Stage; to?: Stage; internal?: boolean } = {},
) {
  const { error } = await admin.from("workflow_events").insert({
    job_id: jobId,
    actor_id: actorId,
    event_type: eventType,
    summary,
    details: details as Json,
    from_stage: opts.from ?? null,
    to_stage: opts.to ?? null,
    internal: opts.internal ?? false,
  });
  if (error) throw new Error(error.message);
  await admin.from("jobs").update({ last_activity_at: new Date().toISOString() }).eq("id", jobId);
}

export async function getStage(jobId: string): Promise<Stage> {
  const { data, error } = await admin.from("jobs").select("stage").eq("id", jobId).single();
  if (error || !data) throw new WorkflowError("Job not found");
  return data.stage;
}

/** Central PIESA rule (window length lives in workflow_settings; computed by job_piesa_deadlines view). */
export async function piesaStatus(jobId: string) {
  const { data } = await admin.from("job_piesa_deadlines").select("*").eq("job_id", jobId).maybeSingle();
  return data;
}

/** Deposit gate: the accepted installation invoice's 50% deposit is paid (Xero) OR an audited admin override exists. */
export async function depositCleared(jobId: string) {
  const { data: inv } = await admin
    .from("invoices")
    .select("id, deposit_paid_at")
    .eq("job_id", jobId)
    .eq("kind", "installation")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!inv) return false;
  if (inv.deposit_paid_at) return true;
  const { count } = await admin.from("payment_overrides").select("id", { count: "exact", head: true }).eq("invoice_id", inv.id).eq("gate", "deposit");
  return (count ?? 0) > 0;
}

async function openRectCount(jobId: string) {
  const { count } = await admin.from("rectification_items").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("status", "required");
  return count ?? 0;
}

export async function stageEntryBlockers(jobId: string, to: Stage): Promise<string[]> {
  const blockers: string[] = [];
  const piesa = await piesaStatus(jobId);

  if (AUTHORITY_STAGES.includes(to) && !(await authorityValid(jobId))) blockers.push(AUTHORITY_BLOCKER);

  if (PIESA_WINDOW_STAGES.includes(to) && piesa?.piesa_expired) {
    blockers.push(
      `PIESA 30-day window expired on ${piesa.install_deadline}. Electrician must record a reassessment before progressing.`,
    );
  }
  const rect = await openRectCount(jobId);
  if (to === "ready_for_installer_quotes" || to === "awaiting_quote_acceptance") {
    if (!piesa?.piesa_date) blockers.push("No current PIESA record.");
    else if (rect === 0 && piesa.piesa_outcome !== "pass") blockers.push("Current PIESA has not passed and no rectification scope exists.");
    if (to === "awaiting_quote_acceptance" && rect === 0 && piesa?.piesa_expired) blockers.push(`PIESA 30-day window expired on ${piesa.install_deadline}.`);
  }
  if (to === "awaiting_quote_acceptance") {
    const { count } = await admin.from("quotes").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "installation").eq("status", "issued");
    if (!count) blockers.push("No installation quotes issued.");
  }
  if (to === "awaiting_deposit_payment" || to === "rectification_scheduling" || to === "installation_scheduling") {
    const { count } = await admin.from("quotes").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "installation").eq("status", "accepted");
    if (!count) blockers.push("Owner has not accepted the final installation quote.");
  }
  // LOCKED PAYMENT RULE: no rectification or installation scheduling until the 50% deposit is cleared.
  if (["rectification_scheduling", "rectification_booked", "installation_scheduling", "installation_booked"].includes(to)) {
    if (!(await depositCleared(jobId))) blockers.push("50% deposit not paid – scheduling locked until Xero confirms payment.");
  }
  if (to === "installation_scheduling" || to === "installation_booked") {
    if (rect > 0) blockers.push("Rectification works not yet completed.");
    if (!piesa?.piesa_date || piesa.piesa_outcome !== "pass") blockers.push("A passing PIESA / electrical sign-off is required before installation.");
  }
  if (to === "installation_booked" || to === "evidence_outstanding") {
    const { data: inst } = await admin
      .from("job_assignments")
      .select("id")
      .eq("job_id", jobId)
      .eq("role", "installer")
      .eq("active", true)
      .maybeSingle();
    if (!inst) blockers.push("No installer assigned.");
  }
  if (to === "ap_review" || to === "ready_for_veec") {
    const { data: reqs } = await admin
      .from("evidence_requirements")
      .select("label,status,required")
      .eq("job_id", jobId)
      .eq("required", true);
    for (const r of reqs ?? []) {
      if (to === "ap_review" && !["uploaded", "verified"].includes(r.status)) blockers.push(`Evidence missing: ${r.label}`);
      if (to === "ready_for_veec" && r.status !== "verified") blockers.push(`Evidence not verified: ${r.label}`);
    }
  }
  if (to === "ready_for_veec") {
    const { data: checks } = await admin
      .from("compliance_checks")
      .select("label,status")
      .eq("job_id", jobId)
      .eq("blocking", true);
    for (const c of checks ?? []) if (c.status !== "pass") blockers.push(`Compliance not passed: ${c.label}`);
  }
  if (to === "complete") {
    const { data: v } = await admin.from("veec_lodgements").select("status").eq("job_id", jobId).maybeSingle();
    if (!v || !["submitted", "approved"].includes(v.status)) blockers.push("VEEC lodgement not submitted.");
  }
  return blockers;
}

export async function transition(
  jobId: string,
  to: Stage,
  actorId: string,
  summary: string,
  details: Record<string, unknown> = {},
  opts: { nextAction?: string } = {},
) {
  const from = await getStage(jobId);
  if (from === "on_hold" || from === "cancelled") throw new WorkflowError(`Job is ${STAGE_LABEL[from]}.`);
  if (from !== to && !TRANSITIONS[from]?.includes(to)) {
    throw new WorkflowError(`Cannot move from ${STAGE_LABEL[from]} to ${STAGE_LABEL[to]}.`);
  }
  const blockers = await stageEntryBlockers(jobId, to);
  if (blockers.length) throw new WorkflowError(`Blocked: ${blockers.join(" • ")}`);
  const { error } = await admin
    .from("jobs")
    .update({ stage: to, next_action: opts.nextAction ?? DEFAULT_NEXT_ACTION[to] })
    .eq("id", jobId);
  if (error) throw new Error(error.message);
  await logEvent(jobId, actorId, "stage_changed", summary, details, { from, to });
}

/** Blockers for the job's natural next step (for UI display), plus standing hard blockers. */
export async function nextStepBlockers(jobId: string) {
  const stage = await getStage(jobId);
  let next = TRANSITIONS[stage]?.[0] ?? null;
  if (stage === "awaiting_deposit_payment") next = (await openRectCount(jobId)) > 0 ? "rectification_scheduling" : "installation_scheduling";
  if (stage === "rectification_booked") next = "installation_scheduling";
  const blockers = next ? await stageEntryBlockers(jobId, next) : [];
  const piesa = await piesaStatus(jobId);
  if (piesa?.piesa_expired && !blockers.some((b) => b.startsWith("PIESA")))
    blockers.unshift(`PIESA 30-day window expired on ${piesa.install_deadline}. Reassessment required.`);
  const pre: Stage[] = ["new_enquiry", "eligibility_review", "complete", "cancelled"];
  if (!pre.includes(stage) && !blockers.includes(AUTHORITY_BLOCKER) && !(await authorityValid(jobId))) blockers.unshift(AUTHORITY_BLOCKER);
  return { stage, next, blockers };
}
