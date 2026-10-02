// CENTRAL WORKFLOW RULES. All stage transitions, guards and audit logging live here.
// Server-only: uses the service-role client AFTER the caller's permission has been checked.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { DEFAULT_NEXT_ACTION, STAGE_LABEL, type JobRole, type Stage } from "./workflow";

export class WorkflowError extends Error {}

type Sb = SupabaseClient<Database>;

/**
 * Allowed forward/back transitions. on_hold/cancelled handled separately by admin.
 * Rectification path: owner approves scope -> installer quotes (incl. rectification lines, one combined total)
 * -> owner accepts -> Xero invoice -> 50% deposit -> rectification scheduling -> PIESA -> installation scheduling.
 */
export const TRANSITIONS: Partial<Record<Stage, Stage[]>> = {
  // Eligible jobs go to the free installer Ready Check first; the electrician PIESA comes later (piesa_and_install_window_pending).
  new_enquiry: ["eligibility_review", "ready_check_ready_to_schedule", "ready_check_complete", "preliminary_estimate_ready", "awaiting_electrician"],
  eligibility_review: ["ready_check_ready_to_schedule", "ready_check_complete", "preliminary_estimate_ready", "awaiting_electrician"],
  // Ready Check pathway. NO electrician-review stage between ready_check_complete and measured_estimate_ready.
  preliminary_estimate_ready: ["ready_check_awaiting_acceptance", "ready_check_ready_to_schedule"],
  ready_check_awaiting_acceptance: ["ready_check_ready_to_schedule"],
  ready_check_awaiting_payment: ["ready_check_ready_to_schedule"],
  ready_check_ready_to_schedule: ["ready_check_scheduled", "eligibility_review", "ready_check_complete"],
  ready_check_scheduled: ["ready_check_complete", "ready_check_ready_to_schedule"],
  ready_check_complete: ["measured_estimate_ready"],
  measured_estimate_ready: ["measured_quote_accepted"],
  // The existing final-quote → one Xero invoice → 50% deposit machinery stays separate and later.
  measured_quote_accepted: ["piesa_and_install_window_pending", "awaiting_quote_acceptance"],
  piesa_and_install_window_pending: ["piesa_scheduled"],
  piesa_scheduled: ["piesa_complete", "piesa_and_install_window_pending"],
  piesa_complete: ["electrical_variation_pending", "rectification_scheduling", "installation_scheduling", "awaiting_deposit_payment"],
  electrical_variation_pending: ["rectification_scheduling", "installation_scheduling", "awaiting_deposit_payment"],
  awaiting_electrician: ["assessment_booking", "eligibility_review", "ready_check_ready_to_schedule", "ready_check_complete"], // back-step only for admin eligibility correction
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

/**
 * Activity 48 sequence: the customer signs a commercial Customer Agreement / Quote Acceptance (unlocks invoice/deposit);
 * ESC owner consent is a separate pre-install record; the final VEEC assignment is prepared and signed only post-install.
 */
export const CONSUMER_SIGN_BLOCKER = "Customer Agreement / Quote Acceptance not signed by the customer.";
export const ASSIGNMENT_VEEC_BLOCKER = "Final Activity 48 VEEC assignment not yet effective.";

export async function agreementSigned(jobId: string): Promise<boolean> {
  const { data } = await admin.from("customer_agreements").select("id").eq("job_id", jobId).eq("status", "signed").maybeSingle();
  return !!data;
}

/** Status of the FINAL post-install VEEC assignment (legacy quote-time records never count). */
export async function assignmentStatus(jobId: string): Promise<string | null> {
  const { data } = await admin.from("customer_assignments").select("status").eq("job_id", jobId).eq("record_kind", "final_veec_assignment").neq("status", "cancelled").maybeSingle();
  return (data?.status as string | undefined) ?? null;
}

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

/** Ready Check pathway guards (pure rules in readycheck.core.ts). */
async function readyCheckBlockers(jobId: string, to: Stage): Promise<string[]> {
  const out: string[] = [];
  if (to === "ready_check_scheduled") {
    const { data: assignment } = await admin.from("job_assignments").select("id, user_id, business_id, businesses(business_type, onboarding_status, is_active, capabilities)").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
    const business = assignment?.businesses as { business_type: string; onboarding_status: string; is_active: boolean; capabilities: string[] | null } | null;
    const certifiedInstaller = !!assignment?.user_id && !!assignment.business_id && !!business?.is_active && business.onboarding_status === "approved"
      && (business.business_type === "eec_installer" || business.capabilities?.includes("installer"));
    if (!certifiedInstaller) out.push("Assign an approved EEC Certified Insulation Installer before scheduling the Ready Check.");
    const { data: booking } = await admin.from("bookings").select("id, scheduled_start, contractor_id, assignment_id, business_id").eq("job_id", jobId).eq("kind", "ready_check").eq("status", "confirmed").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!booking?.scheduled_start || booking.assignment_id !== assignment?.id || booking.contractor_id !== assignment?.user_id || booking.business_id !== assignment?.business_id) out.push("Record the Ready Check date, time, assigned installer and installer business before scheduling.");
  }
  if (to === "measured_estimate_ready") {
    const { count } = await admin.from("ceiling_measurements").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("is_current", true).eq("status", "complete").eq("source_role", "installer");
    if (!count) out.push("Free Ready Check eligibility measure-up not yet completed by the installer.");
  }
  if (to === "piesa_scheduled") {
    const { checkPiesaWindow } = await import("./readycheck.core");
    const { data: w } = await admin.from("job_install_windows").select("planned_piesa_date, planned_install_date, piesa_completed_at").eq("job_id", jobId).maybeSingle();
    const c = checkPiesaWindow({ planned_piesa_date: w?.planned_piesa_date ?? null, planned_install_date: w?.planned_install_date ?? null, piesa_completed_at: null, today: new Date().toISOString() });
    if (!c.readyForPiesa) out.push(c.hardWarning ?? "Reserve a realistic installation slot before scheduling the PIESA.");
  }
  if (["rectification_scheduling", "installation_scheduling"].includes(to)) {
    const { data: r } = await admin.from("piesa_reconciliations").select("id, requires_customer_approval").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (r?.requires_customer_approval) {
      const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", "electrical_variation_approved").contains("details", { reconciliation_id: r.id });
      if (!count) out.push("Electrical variation awaiting customer approval.");
    }
  }
  return out;
}

async function openRectCount(jobId: string) {
  const { count } = await admin.from("rectification_items").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("status", "required");
  return count ?? 0;
}

export const COMMERCIAL_BLOCKER = "Commercial setup required – invoice route not configured for this installer-sourced job.";

/** Installer-sourced jobs stay payment-gated until an admin configures a supported invoice route. */
export async function commercialBlocker(jobId: string): Promise<string | null> {
  const { data } = await admin.from("jobs").select("channel, commercial_model, installer_led").eq("id", jobId).single();
  // Installer-led jobs: Home Insulation Victoria invoices the owner, co-branded (confirmed by Jo 2026-10-01).
  if (data?.channel === "installer_sourced" && !data.installer_led && data.commercial_model !== "hivic_invoices_owner") return COMMERCIAL_BLOCKER;
  return null;
}

/** Quoting needs an ACCEPTED current ceiling measurement with area > 0 (not "assessment complete"). */
export async function measurementBlocker(jobId: string): Promise<string | null> {
  const { data: m } = await admin.from("ceiling_measurements").select("status, measured_area_m2").eq("job_id", jobId).eq("is_current", true).maybeSingle();
  if (!m) return "Ceiling measure-up missing.";
  if (m.status === "needs_review") return "Ceiling measure-up needs review / missing evidence.";
  if (m.status !== "complete") return "Ceiling measure-up not yet completed.";
  if (!(Number(m.measured_area_m2) > 0)) return "Accepted ceiling measure-up has no measured area.";
  return null;
}

export async function stageEntryBlockers(jobId: string, to: Stage): Promise<string[]> {
  const blockers: string[] = [];
  blockers.push(...(await readyCheckBlockers(jobId, to)));
  if (["assessment_booked", "assessment_complete", "installation_booked", "evidence_outstanding", "ap_review", "ready_for_veec"].includes(to)) {
    const { complianceRecordBlockers } = await import("./compliance-timeline.core");
    const [{ data: recs }, { data: job }, { data: invs }] = await Promise.all([
      admin.from("job_compliance_records").select("record_key").eq("job_id", jobId),
      admin.from("jobs").select("life_support").eq("id", jobId).single(),
      admin.from("invoices").select("deposit_paid_amount").eq("job_id", jobId),
    ]);
    const paid = (invs ?? []).reduce((a, i) => a + Number(i.deposit_paid_amount ?? 0), 0);
    blockers.push(...complianceRecordBlockers(to, new Set((recs ?? []).map((r) => r.record_key as never)), { lifeSupport: !!job?.life_support, ownerPaidIncGst: paid }));
  }
  if (["awaiting_deposit_payment", "rectification_scheduling", "rectification_booked", "installation_scheduling", "installation_booked"].includes(to)) {
    const cb = await commercialBlocker(jobId);
    if (cb) blockers.push(cb);
  }
  const piesa = await piesaStatus(jobId);

  if (["awaiting_deposit_payment", "rectification_scheduling", "rectification_booked", "installation_scheduling", "installation_booked"].includes(to)) {
    if (!(await agreementSigned(jobId))) blockers.push(CONSUMER_SIGN_BLOCKER);
  }
  if (to === "ready_for_veec") {
    const st = await assignmentStatus(jobId);
    if (st === "variation_required") blockers.push("Assignment variation must be reconfirmed by the customer.");
    if (st !== "effective_complete") blockers.push(ASSIGNMENT_VEEC_BLOCKER);
  }

  if (PIESA_WINDOW_STAGES.includes(to) && piesa?.piesa_expired) {
    blockers.push(
      `PIESA 30-day window expired on ${piesa.install_deadline}. Electrician must record a reassessment before progressing.`,
    );
  }
  const rect = await openRectCount(jobId);
  // Two-requirement model: pre-quote site information = accepted ceiling measure-up + recorded electrical/PIESA.
  if (["assessment_complete", "ready_for_installer_quotes", "awaiting_quote_acceptance"].includes(to)) {
    const mb = await measurementBlocker(jobId);
    if (mb) blockers.push(mb);
  }
  if (to === "assessment_complete") {
    const { data: a } = await admin.from("assessments").select("status").eq("job_id", jobId).maybeSingle();
    if (a?.status !== "complete" || !piesa?.piesa_date) blockers.push("Electrical assessment / PIESA not yet recorded.");
  }
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
  // ESC pre-install controls: installation may only be recorded when READY TO INSTALL held 24h before start.
  if (to === "evidence_outstanding") {
    const { installReadiness } = await import("./esc.server");
    const r = await installReadiness(jobId);
    for (const b of r.blockers) blockers.push(`Not ready to install: ${b}`);
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
    const { data: v } = await admin.from("veec_lodgements").select("status,quantity,submission_reference,submitted_date,notes").eq("job_id", jobId).maybeSingle();
    const { lodgementEvidenceBlockers } = await import("./veec.core");
    blockers.push(...lodgementEvidenceBlockers(v, new Date().toISOString().slice(0, 10)));
  }
  return blockers;
}

export async function transition(
  jobId: string,
  to: Stage,
  actorId: string | null,
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
  if ((await assignmentStatus(jobId)) === "variation_required" && !blockers.some((b) => b.startsWith("Assignment variation")))
    blockers.unshift("Assignment variation must be reconfirmed by the customer.");
  return { stage, next, blockers };
}
