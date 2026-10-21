import { JOB_LIST_COLUMNS } from "./job-list-columns";
// All state-changing operations. Each verifies the caller (via RLS-backed RPC) then
// delegates to the central workflow/quote modules which write with the service role.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Json } from "@/integrations/supabase/types";
import { withRequestMeta } from "./request-meta";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent, nextStepBlockers, stageEntryBlockers, piesaStatus, requireAdmin, requireJobRole, transition, getStage } from "./workflow.server";
import { adjustQuote as adjustQuoteImpl, generateInstallerQuotes as genInstaller, generateRectificationQuote } from "./quotes.server";
import { enquirySchema, upsertEnquiry } from "./enquiry.server";
import { installationDateBlocker, STAGE_LABEL, type Stage } from "./workflow";
import { applyPaidAmount, createInvoiceForQuote, requireHivicInvoice, requireHivicJob, setInstallDueDate, syncInvoiceFromXero } from "./xero.server";
import { clearInstallDueDate } from "./install-balance.server";
import { buildDepositOverride, depositRequestPatch } from "./invoice.lifecycle";
import { commercialBlocker, paymentOptionCleared } from "./workflow.server";
import { assertAgreementCanSign, assignmentEffective, buildAcceptancePackage, currentAgreement, currentAssignment, currentInstallerDeclaration, loadTemplates, prepareFinalAssignment, raiseVariation, reconfirmVariation, signCustomerAgreement, signFinalAssignment, signInstallerDecl } from "./assignment.server";
import { ASSIGNMENT_EVENTS, parseFormFields, prefillRows, setupStatus, templateBlockers, type TemplateKey } from "./assignment.core";
import { consentValidityBlockers } from "./consent.core";
import { autoAdvanceJob, autoAdvanceOpenJobs } from "./autoadvance.server";
import { sweepAuthorityExpiry } from "./authority.server";
import { requireMittiAccess } from "./mitti-membership.server";
import { mittiAssignBlocker, mittiOverrideAccepted } from "./mitti-membership.core";
import { signFile } from "./file-links.server";
import { melbourneToday } from "@/lib/melbourne-time.core";
import { piesaDateBlockers } from "./piesa-date.core";
import { CLEARANCE_RECORDER_REFUSED, clearanceRecorderAllowed } from "./clearance-guard.core";

const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as never;

const uuid = z.string().uuid();

// ---------- Gate 1 ----------
export const createEnquiry = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => enquirySchema.parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    return upsertEnquiry(data, "portal", context.userId);
  });

export const createTestEnquiry = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => enquirySchema.parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    return upsertEnquiry({ ...data, external_enquiry_id: `qa-${crypto.randomUUID()}` }, "qa_test", context.userId);
  });

export const setEligibility = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ jobId: uuid, outcome: z.enum(["likely_eligible", "needs_onsite_confirmation", "does_not_appear_eligible"]), reason: z.string().trim().min(3).max(2000), nextAction: z.string().trim().max(300).optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { AUTO_FAIL_HOLD_PREFIX, refreshGate1Flags } = await import("./eligibility.server");
    const { data: before } = await admin.from("jobs").select("stage, prior_stage, hold_reason, eligibility_outcome, eligibility_decision_source, eligibility_decision_rules").eq("id", data.jobId).single();
    if (!before) throw new WorkflowError("Job not found");
    // Admin correction of a system auto-fail: release the automatic hold back to Gate 1.
    if (before.stage === "on_hold" && before.hold_reason?.startsWith(AUTO_FAIL_HOLD_PREFIX)) {
      const { isRetiredStage } = await import("./workflow");
      if (isRetiredStage(before.prior_stage)) before.prior_stage = "eligibility_review";
      await admin.from("jobs").update({ stage: before.prior_stage ?? "eligibility_review", prior_stage: null, hold_reason: null }).eq("id", data.jobId);
      await logEvent(data.jobId, context.userId, "stage_changed", "Auto-fail hold released by admin for Gate 1 correction", { reason: data.reason }, { from: "on_hold", to: before.prior_stage ?? "eligibility_review" });
    }
    let stage = await getStage(data.jobId);
    await admin.from("jobs").update({ eligibility_outcome: data.outcome, eligibility_reason: data.reason, ...(data.nextAction ? { next_action: data.nextAction } : {}), eligibility_set_by: context.userId, eligibility_set_at: new Date().toISOString(), eligibility_decision_source: "admin", eligibility_review_required: false }).eq("id", data.jobId);
    const gate = await refreshGate1Flags(data.jobId); // safety/operational flags + 2026 rollout hold (admin outcome stands)
    const overriding = before.eligibility_decision_source === "system";
    await logEvent(data.jobId, context.userId, overriding ? "eligibility_override" : "eligibility_set", `${overriding ? "Admin override of system Gate 1 decision" : "Eligibility"}: ${data.outcome.replaceAll("_", " ")}`, { reason: data.reason, next_action: data.nextAction || null, previous_outcome: before.eligibility_outcome, previous_source: before.eligibility_decision_source, previous_rules: before.eligibility_decision_rules });
    if (data.outcome === "does_not_appear_eligible" && (stage === "awaiting_electrician" || stage === "ready_check_ready_to_schedule")) {
      await transition(data.jobId, "eligibility_review", context.userId, "Admin corrected Gate 1 – back to eligibility review", { reason: data.reason }, (data.nextAction ? { nextAction: data.nextAction } : {}));
      stage = "eligibility_review";
    }
    if (data.outcome !== "does_not_appear_eligible" && gate?.rolloutHold && (stage === "new_enquiry" || stage === "eligibility_review")) {
      if (stage === "new_enquiry") await transition(data.jobId, "eligibility_review", context.userId, "Eligibility set – held until general rollout starts 1 Oct 2026", {}, { nextAction: "Hold until general rollout starts 1 Oct 2026, then assign installer for the free Ready Check" });
      await logEvent(data.jobId, context.userId, "gate1_rollout_hold", "Assessment dispatch held: general rollout starts 1 Oct 2026", { flags: gate.flags }, { internal: true });
    } else if (data.outcome !== "does_not_appear_eligible" && (stage === "new_enquiry" || stage === "eligibility_review")) {
      await transition(data.jobId, "preliminary_estimate_ready", context.userId, "Eligibility passed – waiting for the owner to save their spot", {}, (data.nextAction ? { nextAction: data.nextAction } : {}));
      // Owner Authority is no longer requested before assessment; acceptance happens at quote acceptance.
    } else if (stage === "new_enquiry") {
      await transition(data.jobId, "eligibility_review", context.userId, "Moved to eligibility review", {}, (data.nextAction ? { nextAction: data.nextAction } : {}));
    }
    await admin.from("compliance_checks").update({ status: data.outcome === "does_not_appear_eligible" ? "fail" : data.outcome === "likely_eligible" ? "pass" : "pending", checked_by: context.userId, checked_at: new Date().toISOString(), notes: data.reason }).eq("job_id", data.jobId).eq("check_key", "eligibility");
    // Step 3 sync after the admin decision is persisted: likely/onsite -> refresh + ensure link; review/fail -> revoke.
    try { const { syncStep3 } = await import("./estimatelink.server"); await syncStep3(data.jobId, context.userId); } catch (e) { await logEvent(data.jobId, context.userId, "step3_prepare_failed", "Step 3 preparation failed after admin Gate 1 decision", { error: (e as Error).message.slice(0, 300) }, { internal: true }); }
    // One automatic email route after an admin Gate 1 decision. Best-effort; senders re-check all safeguards.
    try { const { maybeAutoRouteLeadEmail } = await import("./lead-email-routing.server"); await maybeAutoRouteLeadEmail(data.jobId); } catch { /* never block the decision */ }
    await autoAdvanceJob(data.jobId, context.userId, "eligibility");
    return { ok: true };
  });

// Installer-sourced intake: an approved EEC installer submits its own customer/property.
export const submitInstallerJob = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => enquirySchema.omit({ external_enquiry_id: true }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isInstaller } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "installer" });
    if (!isInstaller) throw new WorkflowError("Only approved installers can submit jobs.");
    const { data: prof } = await admin.from("profiles").select("business_id, full_name, businesses(name, business_type, is_active)").eq("id", context.userId).single();
    const biz = prof?.businesses as { name: string; business_type: string; is_active: boolean } | null;
    if (!prof?.business_id || !biz || biz.business_type !== "eec_installer" || !biz.is_active)
      throw new WorkflowError("Your account isn't linked to an approved EEC installer business yet. Ask Home Insulation Victoria to set this up.");
    const { intakeSourceFor } = await import("./pilot.server");
    const res = await upsertEnquiry(data, await intakeSourceFor(context.userId, prof.business_id, "installer_portal"), context.userId, { channel: "installer_sourced", businessId: prof.business_id, userId: context.userId });
    await admin.from("job_assignments").insert({ job_id: res.job_id, user_id: context.userId, role: "installer", business_id: prof.business_id, assigned_by: context.userId });
    await logEvent(res.job_id, context.userId, "contractor_assigned", `Installer assigned (originating installer): ${prof.full_name ?? "installer"} – ${biz.name}`);
    return res;
  });

export const setCommercialModel = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, model: z.enum(["hivic_invoices_owner", "installer_invoices_owner", "not_configured"]), reason: z.string().trim().min(5).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { data: j } = await admin.from("jobs").select("channel, commercial_model").eq("id", data.jobId).single();
    if (!j) throw new WorkflowError("Job not found");
    if (j.channel !== "installer_sourced") throw new WorkflowError("Home Insulation Victoria-sourced jobs always use Home Insulation Victoria invoicing.");
    const { count } = await admin.from("invoices").select("id", { count: "exact", head: true }).eq("job_id", data.jobId);
    if (count) throw new WorkflowError("An invoice already exists – the invoice route can no longer change.");
    await admin.from("jobs").update({ commercial_model: data.model, commercial_model_set_by: context.userId, commercial_model_set_at: new Date().toISOString() }).eq("id", data.jobId);
    await logEvent(data.jobId, context.userId, "commercial_model_set", `Invoice route set: ${data.model.replaceAll("_", " ")}`, { before: j.commercial_model, after: data.model, reason: data.reason });
    return { ok: true };
  });

// ---------- Assignments / users ----------
export const assignContractor = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, userId: uuid, role: z.enum(["electrician", "installer"]), mittiOverrideReason: z.string().trim().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const stage = await getStage(data.jobId);
    if (stage === "ready_check_ready_to_schedule" && data.role === "electrician") throw new WorkflowError("Do not assign an electrician for the Ready Check. Assign an Installer.");
    const { data: hasRole } = await admin.from("user_roles").select("id").eq("user_id", data.userId).eq("role", data.role).maybeSingle();
    if (!hasRole) throw new WorkflowError(`User does not hold the ${data.role} role.`);
    const { data: prof } = await admin.from("profiles").select("full_name, business_id").eq("id", data.userId).single();
    if (data.role === "electrician") {
      // Phase 2 compliance: Office direct assignment must enforce the same mandatory REC / electrician eligibility
      // as the automatic and team paths (pilot.functions assignElectrician / teaming.server tryTeamAssign).
      const { electricianWorkEligibility } = await import("./pilot.core");
      const businessId = prof?.business_id ?? null;
      if (!businessId) throw new WorkflowError("The electrician must belong to an approved REC business.");
      const [{ data: business }, { data: creds }, { data: workers }] = await Promise.all([
        admin.from("businesses").select("*").eq("id", businessId).maybeSingle(),
        admin.from("business_credentials").select("kind,label,expires_at,critical,verification").eq("business_id", businessId),
        admin.from("partner_workers").select("trade_role,licence_expires_on,approval_status,removed_at").eq("business_id", businessId).eq("trade_role", "electrician"),
      ]);
      const blocker = electricianWorkEligibility(business as never, creds as never, workers as never);
      if (blocker) throw new WorkflowError(`Electrician assignment blocked: ${blocker}`);
    }
    // Every Mitti form (Ready Check, PIESA, installer safety form) can only be handed to a member of
    // our Mitti organisation, so office learns that here instead of at send time.
    const { row: member, access } = await requireMittiAccess(data.userId, data.role);
    if (access !== "member") {
      if (!mittiOverrideAccepted(data.mittiOverrideReason)) throw new WorkflowError(mittiAssignBlocker(data.role, member.full_name, member.email, access));
      await logEvent(data.jobId, context.userId, "mitti_access_override", `Assigned ${data.role} without confirmed Mitti access: ${member.full_name ?? member.email} – reason: ${data.mittiOverrideReason!.trim()}`, { user_id: data.userId, access, reason: data.mittiOverrideReason!.trim() });
    }
    if (stage === "ready_check_ready_to_schedule" && data.role === "installer") {
      if (!prof?.business_id) throw new WorkflowError("The installer must belong to an approved EEC installer business.");
      const { requireApprovedPartner } = await import("./pilot.server");
      const business = await requireApprovedPartner(prof.business_id);
      if (business.business_type !== "eec_installer" && !business.capabilities.includes("installer")) throw new WorkflowError("The Ready Check requires an Installer.");
    }
    await admin.from("job_assignments").update({ active: false, ended_at: new Date().toISOString(), end_reason: "reassigned" }).eq("job_id", data.jobId).eq("role", data.role).eq("active", true);
    await admin.from("job_assignments").insert({ job_id: data.jobId, user_id: data.userId, role: data.role, business_id: prof?.business_id ?? null, assigned_by: context.userId });
    await admin.from("reassignment_requests").update({ status: "actioned", resolved_by: context.userId, resolved_at: new Date().toISOString() }).eq("job_id", data.jobId).eq("role", data.role).eq("status", "open");
    if (data.role === "electrician") await admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", data.jobId).in("kind", ["assessment", "rectification"]).eq("status", "proposed");
    const { data: src } = await admin.from("jobs").select("channel, originating_installer_user_id").eq("id", data.jobId).single();
    const awayFromOrigin = data.role === "installer" && src?.channel === "installer_sourced" && src.originating_installer_user_id !== data.userId;
    await logEvent(data.jobId, context.userId, "contractor_assigned", `${data.role === "electrician" ? "Electrician" : "Installer"} assigned: ${prof?.full_name ?? "user"}${awayFromOrigin ? " (admin reassignment away from originating installer – attribution unchanged)" : ""}`);
    if (stage === "ready_check_ready_to_schedule" && data.role === "installer") await admin.from("jobs").update({ next_action: "Assigned Installer to contact owner and arrange Ready Check" }).eq("id", data.jobId);
    await autoAdvanceJob(data.jobId, context.userId, "contractor assigned");
    return { ok: true };
  });

export const setUserRole = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: uuid, role: z.enum(["admin", "electrician", "installer", "owner"]), grant: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    if (!data.grant && data.role === "admin" && data.userId === context.userId) throw new WorkflowError("You cannot remove your own admin role.");
    if (data.grant) await admin.from("user_roles").upsert({ user_id: data.userId, role: data.role }, { onConflict: "user_id,role" });
    else await admin.from("user_roles").delete().eq("user_id", data.userId).eq("role", data.role);
    return { ok: true };
  });

export const setUserBusiness = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: uuid, businessId: uuid.nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    await admin.from("profiles").update({ business_id: data.businessId }).eq("id", data.userId);
    return { ok: true };
  });

// ---------- Gate 2: two independent requirements ----------
// (B) Electrical assessment / PIESA lives in `assessments`; (A) ceiling measure-up lives in `ceiling_measurements`.
const assessmentPatch = z.object({
  no_rectification_confirmed: z.boolean().nullable(),
  downlights_qty: z.number().int().min(0).max(500).nullable(),
  downlights_type: z.string().max(200).nullable(),
  downlights_upgrade_qty: z.number().int().min(0).max(500).nullable(),
  exhaust_fans_qty: z.number().int().min(0).max(50).nullable(),
  exhaust_fans_clearance_qty: z.number().int().min(0).max(50).nullable(),
  hazards: z.string().max(2000).nullable(),
  switchboard_condition: z.enum(["ok", "upgrade_required"]).nullable(),
  rcds_present: z.boolean().nullable(),
  rcds_required_qty: z.number().int().min(0).max(20).nullable(),
  life_support_confirmed: z.boolean().nullable(),
  piesa_outcome: z.enum(["pending", "pass", "fail"]),
  notes: z.string().max(4000).nullable(),
  assessed_on: z.string().nullable(),
  external_mitti_id: z.string().max(100).nullable(),
}).partial();

const measurementPatch = z.object({
  measured_area_m2: z.number().min(0).max(5000).nullable(),
  insulation_present: z.boolean().nullable(),
  existing_r_value: z.number().min(0).max(10).nullable(),
  removal_required: z.boolean().nullable(),
  removal_m2: z.number().min(0).max(5000).nullable(),
  access_difficulty: z.enum(["easy", "moderate", "difficult"]).nullable(),
  evidence_notes: z.string().max(2000).nullable(),
}).partial();

const SITE_STAGES = ["ready_check_scheduled", "assessment_booking", "assessment_booked"];
const MEASURE_EVIDENCE = ["measurement", "existing_insulation_r_value"];

/**
 * STEP 73/80: recording a regulated electrical result (PIESA draft, completion, a fresh PIESA record or the electrician
 * declaration) needs the licensed-electrician APP role — not merely a job role. Since 0115 a partner BUSINESS ADMIN gets
 * the assignment's role ('electrician') for its business's jobs without holding that app role, so requireJobRole alone is
 * not enough. Office (admin) keeps its existing access. Runs BEFORE any read or write, and fails closed on an rpc error.
 */
async function requireClearanceRecorder(r: Parameters<typeof requireJobRole>[0], jobRole: string, userId: string) {
  const { data, error } = await r.rpc("has_role", { _user_id: userId, _role: "electrician" });
  if (error || !clearanceRecorderAllowed({ jobRole, hasElectricianRole: data === true })) throw new WorkflowError(CLEARANCE_RECORDER_REFUSED);
}

export const saveAssessment = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, patch: assessmentPatch }).parse(d))
  .handler(async ({ data, context }) => {
    const jobRole = await requireJobRole(context.supabase, data.jobId, ["admin", "electrician"]);
    await requireClearanceRecorder(context.supabase as never, jobRole, context.userId);
    // Server-side PIESA date rule (same one recordPiesa enforces): no future assessment dates.
    if (data.patch.assessed_on !== undefined && data.patch.assessed_on !== null) {
      const b = piesaDateBlockers(data.patch.assessed_on);
      if (b.length) throw new WorkflowError(b[0]!);
    }
    const { data: existing } = await admin.from("assessments").select("id,status").eq("job_id", data.jobId).maybeSingle();
    if (existing?.status === "complete") throw new WorkflowError("Assessment is complete and locked. Ask Home Insulation Victoria to reopen.");
    if (existing) await admin.from("assessments").update(clean(data.patch)).eq("id", existing.id);
    else await admin.from("assessments").insert(clean({ ...data.patch, job_id: data.jobId, assessor_id: context.userId }));
    return { ok: true, savedAt: new Date().toISOString() };
  });

/** Current derived visit scope (the ONE derivation, server-side). */
export const getJobScope = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    // No access (e.g. job reassigned, or a TEST account on a live job): no scope to show, not a server error.
    try { await requireJobRole(context.supabase, data.jobId, ["admin", "electrician", "installer", "owner"]); }
    catch (e) { if (e instanceof WorkflowError) return null; throw e; }
    const { jobScope } = await import("./requirements.server");
    const { measurementRow: _m, ...s } = await jobScope(data.jobId);
    return s;
  });

export const saveMeasurement = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, patch: measurementPatch }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await requireJobRole(context.supabase, data.jobId, ["admin", "installer"]);
    if (!SITE_STAGES.includes(await getStage(data.jobId))) throw new WorkflowError("Ready Check can only be recorded during assessment booking.");
    const { jobScope } = await import("./requirements.server");
    const { planMeasurementUpdate } = await import("./scope.core");
    const s = await jobScope(data.jobId);
    if (role === "installer" && !s.installerTasks.includes("measure_up")) throw new WorkflowError("The eligibility Ready Check is already complete.");
    const source = role === "admin" ? "admin_import" : "installer";
    const { evidence_notes, ...vals } = data.patch;
    const plan = planMeasurementUpdate({ scope: s.scope, current: s.measurementRow as never, incoming: vals, source });
    const cur = s.measurementRow;
    if (plan.action === "skip") {
      if (evidence_notes !== undefined && cur && cur.status !== "complete") await admin.from("ceiling_measurements").update({ evidence_notes }).eq("id", cur.id);
      else if (evidence_notes === undefined) throw new WorkflowError(plan.reason);
    } else if (plan.action === "create") {
      await admin.from("ceiling_measurements").insert({ ...plan.values, evidence_notes: evidence_notes ?? null, job_id: data.jobId, status: "draft", is_current: true, source_role: plan.source, created_by: context.userId });
    } else {
      await admin.from("ceiling_measurements").update({
        ...plan.values, ...(evidence_notes !== undefined ? { evidence_notes } : {}),
        ...(plan.supplemented.length ? { supplemented_by: context.userId, supplemented_at: new Date().toISOString(), supplemented_fields: [...new Set([...((cur?.supplemented_fields as string[]) ?? []), ...plan.supplemented])] } : {}),
      }).eq("id", plan.id).neq("status", "complete");
    }
    return { ok: true, savedAt: new Date().toISOString() };
  });

async function requireMeasureEvidence(jobId: string) {
  const { data: ev } = await admin.from("evidence_requirements").select("label,status,category").eq("job_id", jobId).eq("required", true).in("category", MEASURE_EVIDENCE as never);
  const miss = (ev ?? []).filter((e) => !["uploaded", "verified"].includes(e.status)).map((e) => e.label);
  if (miss.length) throw new WorkflowError(`Upload Ready Check evidence first: ${miss.join(", ")}`);
}

/** Complete the ceiling measure-up requirement (installer / electrician in scope, or admin). */
export const completeMeasurement = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, method: z.enum(["laser", "tape", "floorplan", "other"]).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await requireJobRole(context.supabase, data.jobId, ["admin", "installer"]);
    if (!SITE_STAGES.includes(await getStage(data.jobId))) throw new WorkflowError("Ready Check can only be completed during assessment booking.");
    const { jobScope, advanceSiteRequirements } = await import("./requirements.server");
    const { missingMeasureFields, MEASURE_FIELD_LABEL } = await import("./scope.core");
    const s = await jobScope(data.jobId);
    if (role === "installer" && !s.installerTasks.includes("measure_up")) throw new WorkflowError("The eligibility Ready Check is already complete.");
    const m = s.measurementRow;
    if (!m) throw new WorkflowError("Enter the Ready Check first.");
    if (m.status === "complete") throw new WorkflowError("Ready Check is already accepted.");
    const miss = missingMeasureFields(m as never);
    if (miss.length) throw new WorkflowError(`Still needed: ${miss.map((f) => MEASURE_FIELD_LABEL[f]).join(", ")}`);
    await requireMeasureEvidence(data.jobId);
    // Pilot dual verification: a provisional installer-supplied figure is kept; the onsite figure is recorded separately.
    let verification: Record<string, unknown> = {};
    if (m.provenance === "installer_supplied_provisional" && !m.verified_at) {
      const { measurementVariance, verifierBlocker } = await import("./measurement.core");
      const { data: ws } = await admin.from("workflow_settings").select("measurement_standard_approved").limit(1).maybeSingle();
      const { data: prof } = await admin.from("profiles").select("business_id").eq("id", context.userId).maybeSingle();
      const vb = verifierBlocker({ verifierRole: role, verifierBusinessId: prof?.business_id ?? null, suppliedBusinessId: m.measured_by_business_id, standardApproved: !!ws?.measurement_standard_approved });
      if (vb) throw new WorkflowError(vb);
      if (role !== "admin" && !data.method) throw new WorkflowError("Choose how you measured the ceiling area onsite (laser, tape, floor plan or other).");
      const v = measurementVariance(m.supplied_area_m2 == null ? null : Number(m.supplied_area_m2), Number(m.measured_area_m2));
      verification = { verified_area_m2: m.measured_area_m2, verified_method: data.method ?? "other", verified_by: context.userId, verified_role: role, verified_at: new Date().toISOString(), variance_m2: v?.m2 ?? null, variance_pct: v?.pct ?? null };
    }
    const own = m.source_role === (role === "admin" ? "admin_import" : role);
    await admin.from("ceiling_measurements").update({
      status: "complete", review_flags: [], completed_at: new Date().toISOString(), ...verification,
      ...(own || !m.completed_by ? { completed_by: m.completed_by ?? context.userId } : {}),
      ...(role === "admin" ? { reviewed_by: context.userId, reviewed_at: new Date().toISOString() } : {}),
    }).eq("id", m.id);
    await logEvent(data.jobId, context.userId, "measurement_completed", `Ready Check completed (${m.source_role}${own ? "" : `, completed by ${role}`}) – ${Number(m.measured_area_m2)} m²${verification["verified_at"] ? ` · installer-supplied ${m.supplied_area_m2 ?? "—"} m², variance ${verification["variance_m2"] ?? "—"} m² (${verification["variance_pct"] ?? "—"}%)` : ""}`, { measurement_id: m.id, source_role: m.source_role, supplemented_fields: m.supplemented_fields, ...verification });
    if ((await getStage(data.jobId)) === "ready_check_scheduled") {
      await transition(data.jobId, "ready_check_complete", context.userId, "Ready Check completed", { measurement_id: m.id, measured_area_m2: m.measured_area_m2 }, { nextAction: "Office records verified eligibility, then prepares the measured quote" });
      // The measured-estimate stage needs the office's verified-eligibility record, which can only be made now that the
      // Ready Check is final, so the old hard second transition always threw AFTER the first had committed. The office
      // now records eligibility and prepares the measured quote (generateInstallerQuotes), which moves the stage.
      return { advanced: true, scope: "MEASURE_UP_ONLY" as const };
    }
    const res = await advanceSiteRequirements(data.jobId, context.userId);
    await autoAdvanceJob(data.jobId, context.userId, "Ready Check completed");
    return res;
  });

export const flagMeasurement = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, reason: z.string().trim().min(5).max(1000), fields: z.array(z.enum(["measured_area_m2", "insulation_present", "existing_r_value", "removal_required", "removal_m2", "access_difficulty"])).max(6) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["admin", "electrician"]);
    const stage = await getStage(data.jobId);
    if (![...SITE_STAGES, "assessment_complete", "rectification_required", "awaiting_owner_rectification_approval", "ready_for_installer_quotes"].includes(stage))
      throw new WorkflowError("Measurement can only be flagged before the owner accepts a quote.");
    const { currentMeasurement } = await import("./requirements.server");
    const m = await currentMeasurement(data.jobId);
    if (!m) throw new WorkflowError("No Ready Check to flag.");
    const at = new Date().toISOString();
    const flags = [...((m.review_flags as unknown[]) ?? []), ...(data.fields.length ? data.fields : ["measured_area_m2"]).map((field) => ({ field, reason: data.reason, by: context.userId, at }))];
    await admin.from("ceiling_measurements").update({ status: "needs_review", review_flags: flags as never, review_reason: data.reason }).eq("id", m.id);
    await logEvent(data.jobId, context.userId, "measurement_flagged", `Ready Check flagged for review: ${data.reason}`, { measurement_id: m.id, fields: data.fields, previous_status: m.status });
    return { ok: true };
  });

export const reviewMeasurement = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, action: z.enum(["accept", "needs_review", "reject"]), reason: z.string().trim().min(3).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { currentMeasurement, advanceSiteRequirements } = await import("./requirements.server");
    const { missingMeasureFields, MEASURE_FIELD_LABEL } = await import("./scope.core");
    const m = await currentMeasurement(data.jobId);
    if (!m) throw new WorkflowError("No Ready Check to review.");
    const at = new Date().toISOString();
    if (data.action === "accept") {
      const blockers = await measurementAcceptanceBlockers(m);
      if (blockers.length) throw new WorkflowError(`Cannot accept – ${blockers.join(" ")}`);
      const miss = missingMeasureFields(m as never);
      if (miss.length) throw new WorkflowError(`Cannot accept – missing: ${miss.map((f) => MEASURE_FIELD_LABEL[f]).join(", ")}`);
      const { data: ws } = await admin.from("workflow_settings").select("measurement_standard_version").limit(1).maybeSingle();
      await admin.from("ceiling_measurements").update({ status: "complete", review_flags: [], review_reason: data.reason, reviewed_by: context.userId, reviewed_at: at, completed_at: m.completed_at ?? at, accepted_by: context.userId, accepted_at: at, accepted_reason: data.reason, accepted_standard_version: ws?.measurement_standard_version ?? null }).eq("id", m.id);
    } else if (data.action === "needs_review") {
      await admin.from("ceiling_measurements").update({ status: "needs_review", review_reason: data.reason, reviewed_by: context.userId, reviewed_at: at }).eq("id", m.id);
    } else {
      await admin.from("ceiling_measurements").update({ status: "rejected", is_current: false, review_reason: data.reason, reviewed_by: context.userId, reviewed_at: at }).eq("id", m.id);
    }
    await logEvent(data.jobId, context.userId, "measurement_reviewed", `Ready Check ${data.action.replace("_", " ")}: ${data.reason}`, { measurement_id: m.id, previous_status: m.status });
    if (data.action === "accept" && SITE_STAGES.includes(await getStage(data.jobId))) await advanceSiteRequirements(data.jobId, context.userId);
    return { ok: true };
  });

async function measurementAcceptanceBlockers(m: { provenance: string; measurement_method: string | null; measurement_purpose: string | null; supplied_area_m2: unknown; verified_area_m2: unknown; verified_at: string | null; partner_method_id: string | null }) {
  const { acceptanceBlockers } = await import("./measurement.core");
  const { data: ws } = await admin.from("workflow_settings").select("measurement_standard_approved").limit(1).maybeSingle();
  const { data: pm } = m.partner_method_id ? await admin.from("partner_measurement_methods").select("status").eq("id", m.partner_method_id).maybeSingle() : { data: null };
  return acceptanceBlockers({ ...m, supplied_area_m2: m.supplied_area_m2 == null ? null : Number(m.supplied_area_m2), verified_area_m2: m.verified_area_m2 == null ? null : Number(m.verified_area_m2) },
    { standardApproved: !!ws?.measurement_standard_approved, partnerMethodApproved: pm?.status === "approved" });
}

/** Admin: acceptance blockers + pilot variance for the current measurement. */
export const getMeasurementReview = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { currentMeasurement } = await import("./requirements.server");
    const { varianceWithinTolerance } = await import("./measurement.core");
    const m = await currentMeasurement(data.jobId);
    if (!m) return null;
    const { data: ws } = await admin.from("workflow_settings").select("measurement_standard_version, measurement_standard_approved, measurement_variance_tolerance_pct").limit(1).maybeSingle();
    const tol = ws?.measurement_variance_tolerance_pct == null ? null : Number(ws.measurement_variance_tolerance_pct);
    return {
      blockers: await measurementAcceptanceBlockers(m), standardApproved: !!ws?.measurement_standard_approved, standardVersion: ws?.measurement_standard_version ?? null, tolerancePct: tol,
      withinTolerance: varianceWithinTolerance(m.variance_pct == null ? null : Number(m.variance_pct), tol),
    };
  });

export const setMeasureUpResponsibility = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, by: z.literal("installer") }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    await admin.from("jobs").update({ measure_up_responsibility: "installer" }).eq("id", data.jobId);
    await logEvent(data.jobId, context.userId, "measure_up_responsibility_set", "Eligibility Ready Check assigned to installer");
    return { ok: true };
  });

export const addOtherRectItem = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, description: z.string().trim().min(2).max(300), quantity: z.number().positive().max(1000), unitPriceIncGst: z.number().min(0).max(100000), explanation: z.string().trim().min(5).max(2000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["admin", "electrician"]);
    const stage = await getStage(data.jobId);
    if (!["piesa_scheduled", "assessment_booked", "assessment_booking", "assessment_complete", "rectification_required", "awaiting_owner_rectification_approval"].includes(stage))
      throw new WorkflowError("Other items can only be added before the owner approves electrical fixes.");
    await admin.from("rectification_items").insert({ job_id: data.jobId, description: data.description, quantity: data.quantity, is_other: true, other_unit_price_inc_gst: data.unitPriceIncGst, explanation: data.explanation, added_by: context.userId });
    await logEvent(data.jobId, context.userId, "rectification_other_added", `Other electrical fixes item added: ${data.description}`, { explanation: data.explanation });
    if (stage === "awaiting_owner_rectification_approval") await generateRectificationQuote(data.jobId, context.userId);
    return { ok: true };
  });

export const getAssignedRecRates = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["admin", "electrician"]);
    const { data: assigned } = await admin.from("job_assignments").select("business_id").eq("job_id", data.jobId).eq("role", "electrician").eq("active", true).maybeSingle();
    if (!assigned?.business_id) return [];
    const { data: card } = await admin.from("rate_cards").select("id").eq("business_id", assigned.business_id).eq("kind", "electrical").eq("is_active", true).order("version", { ascending: false }).limit(1).maybeSingle();
    if (!card) return [];
    const { data: rates, error } = await admin.from("rate_card_items").select("code,description,unit,display_unit,unit_price_ex_gst").eq("rate_card_id", card.id).eq("category", "electrical").like("code", "CUSTOM_%").order("sort");
    if (error) throw new WorkflowError("Approved REC rates could not be loaded.");
    return rates ?? [];
  });

export const addApprovedRectItem = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, rateCode: z.string().regex(/^CUSTOM_[A-Z0-9]{1,33}$/), quantity: z.number().positive().max(1000), explanation: z.string().trim().max(2000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["admin", "electrician"]);
    const stage = await getStage(data.jobId);
    if (!["piesa_scheduled", "assessment_booked", "assessment_booking", "assessment_complete", "rectification_required", "awaiting_owner_rectification_approval"].includes(stage)) throw new WorkflowError("Approved items can only be added before the owner approves electrical fixes.");
    const { data: assigned } = await admin.from("job_assignments").select("business_id").eq("job_id", data.jobId).eq("role", "electrician").eq("active", true).maybeSingle();
    if (!assigned?.business_id) throw new WorkflowError("No REC business is assigned to this job.");
    const { data: cards } = await admin.from("rate_cards").select("id,rate_card_items(code,description)").eq("business_id", assigned.business_id).eq("kind", "electrical").eq("is_active", true).order("version", { ascending: false }).limit(1);
    const approved = (cards?.[0]?.rate_card_items as { code: string; description: string }[] | undefined)?.find((item) => item.code === data.rateCode);
    if (!approved) throw new WorkflowError("That item is not on the assigned REC's approved rate card.");
    await admin.from("rectification_items").insert({ job_id: data.jobId, rate_code: approved.code, description: approved.description, quantity: data.quantity, is_other: false, explanation: data.explanation ?? null, added_by: context.userId });
    await logEvent(data.jobId, context.userId, "rectification_approved_item_added", `Approved electrical fixes item added: ${approved.description}`, { rate_code: approved.code, quantity: data.quantity });
    if (stage === "awaiting_owner_rectification_approval") await generateRectificationQuote(data.jobId, context.userId);
    return { ok: true };
  });

export const removeRectItem = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ itemId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: it } = await admin.from("rectification_items").select("job_id,is_other,description").eq("id", data.itemId).single();
    if (!it) throw new WorkflowError("Not found");
    await requireJobRole(context.supabase, it.job_id, ["admin", "electrician"]);
    if (!it.is_other) throw new WorkflowError("Standard items are derived from the assessment – edit the assessment instead.");
    await admin.from("rectification_items").update({ status: "removed" }).eq("id", data.itemId);
    await logEvent(it.job_id, context.userId, "rectification_item_removed", `Removed item: ${it.description}`);
    return { ok: true };
  });

// ---------- Mitti bridge (populates assessment data only; completeAssessment stays authoritative) ----------
export const createMittiAssessment = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { createAssignMittiAudit, realMittiCall } = await import("./mitti.server");
    // T3: the office's explicit action may supersede an earlier attempt whose result is unknown (>= 10 min old, recorded).
    return createAssignMittiAudit(data.jobId, context.userId, realMittiCall, { officeOverride: true });
  });

export const syncFromMitti = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["admin", "electrician"]);
    const { syncMittiAssessment } = await import("./mitti.server");
    return syncMittiAssessment(data.jobId, context.userId);
  });

export const syncPendingMittiAssessments = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({}).parse(d ?? {}))
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { syncPendingMitti } = await import("./mitti.server");
    return syncPendingMitti(context.userId);
  });

export const priceRectItem = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ itemId: uuid, unitPriceIncGst: z.number().min(0).max(100000), reason: z.string().trim().min(5).max(2000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { data: it } = await admin.from("rectification_items").select("job_id,is_other,description").eq("id", data.itemId).single();
    if (!it?.is_other) throw new WorkflowError("Only manual items can be priced here.");
    await admin.from("rectification_items").update({ other_unit_price_inc_gst: data.unitPriceIncGst, needs_office_pricing: false }).eq("id", data.itemId);
    await logEvent(it.job_id, context.userId, "rectification_item_priced", `Office priced: ${it.description}`, { unit_price_inc_gst: data.unitPriceIncGst, reason: data.reason });
    return { ok: true };
  });

/** Complete the ELECTRICAL / PIESA requirement. The electrician never completes the installer measure-up. */
export const completeAssessment = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    jobId: uuid, rectHours: z.number().optional(),
    rectWindows: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), slot: z.enum(["8-10", "10-12", "12-14", "14-16"]) })).max(5).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const jobRole = await requireJobRole(context.supabase, data.jobId, ["admin", "electrician"]);
    await requireClearanceRecorder(context.supabase as never, jobRole, context.userId);
    const { data: a } = await admin.from("assessments").select("*").eq("job_id", data.jobId).maybeSingle();
    if (!a) throw new WorkflowError("Start the assessment first.");
    if (a.status === "complete") throw new WorkflowError("Electrical assessment is already complete.");
    const { jobScope, advanceSiteRequirements } = await import("./requirements.server");
    const s = await jobScope(data.jobId);
    const missing: string[] = [];
    if (!a.switchboard_condition) missing.push("switchboard condition");
    if (a.rcds_present == null) missing.push("RCDs present");
    if (a.life_support_confirmed == null) missing.push("life support confirmation");
    if (a.piesa_outcome === "pending") missing.push("PIESA outcome");
    if (!a.assessed_on) missing.push("assessment date");
    if (missing.length) throw new WorkflowError(`Still needed: ${missing.join(", ")}`);
    // Defence in depth: even a value written before this guard existed cannot be completed with a future date.
    const dateBlockers = piesaDateBlockers(a.assessed_on);
    if (dateBlockers.length) throw new WorkflowError(dateBlockers[0]!);
    const { data: ev } = await admin.from("evidence_requirements").select("label,status,gate,category").eq("job_id", data.jobId).eq("required", true);
    const evMissing = (ev ?? [])
      .filter((e) => a.piesa_outcome === "pass" && e.category === "piesa_signoff")
      .filter((e) => !["uploaded", "verified"].includes(e.status)).map((e) => e.label);
    if (evMissing.length) throw new WorkflowError(`Upload evidence first: ${evMissing.join(", ")}`);
    const { data: unpriced } = await admin.from("rectification_items").select("description").eq("job_id", data.jobId).eq("status", "required").eq("needs_office_pricing", true);
    if (unpriced?.length) throw new WorkflowError(`Home Insulation Victoria must price these items first: ${unpriced.map((u) => u.description).join(", ")}`);
    // Same-day rule: the PIESA submission must carry the rectification decision – priced items, or an explicit "none required".
    const { count: rectCount } = await admin.from("rectification_items").select("id", { count: "exact", head: true }).eq("job_id", data.jobId).eq("status", "required");
    if (!rectCount && a.no_rectification_confirmed !== true) throw new WorkflowError("Add the electrical fixes items for today's quote, or tick \"No electrical fixes required\", before completing the PIESA.");
    if (rectCount && a.no_rectification_confirmed === true) throw new WorkflowError("You ticked \"No electrical fixes required\" but electrical fixes items are listed – untick it or remove the items.");

    // Rectification needed: the electrician also gives estimated hours + 3-5 windows (asked once, here).
    if (rectCount) {
      const { rectPlanBlockers } = await import("./rectification.core");
      const rb = rectPlanBlockers(data.rectHours, data.rectWindows ?? []);
      if (rb.length) throw new WorkflowError(`Electrical fixes times: ${rb.join(" ")}`);
    }
    const stage = await getStage(data.jobId);
    // Current model: the PIESA is booked at piesa_scheduled. assessment_booked is the retired legacy stage, kept for old jobs.
    if (stage !== "assessment_booked" && stage !== "piesa_scheduled") throw new WorkflowError(`The PIESA can be completed once it is booked (current: ${STAGE_LABEL[stage]}).`);
    if (stage === "piesa_scheduled") {
      // Check the guarded stage move BEFORE writing anything, so a blocked completion leaves no half-recorded PIESA.
      const entry = await stageEntryBlockers(data.jobId, "piesa_complete", context.userId);
      if (entry.length) throw new WorkflowError(`PIESA cannot be completed yet: ${entry.join(" ")}`);
    }
    const now = new Date().toISOString();
    await admin.from("assessments").update({ status: "complete", completed_at: now, assessor_id: a.assessor_id ?? context.userId, mitti_sync_status: a.external_mitti_id ? "synced" : "not_synced" }).eq("id", a.id);
    await admin.from("piesa_records").update({ is_current: false }).eq("job_id", data.jobId).eq("is_current", true);
    await admin.from("piesa_records").insert({ job_id: data.jobId, assessment_id: a.id, kind: "initial", outcome: a.piesa_outcome, completed_date: a.assessed_on!, signed_off_by: context.userId, external_mitti_id: a.external_mitti_id });
    await logEvent(data.jobId, context.userId, "electrical_assessment_complete", `Electrical assessment complete – PIESA ${a.piesa_outcome} (${s.label})`, { scope: s.scope });
    let res: { advanced: boolean; scope: string };
    if (stage === "piesa_scheduled") {
      await transition(data.jobId, "piesa_complete", context.userId, `PIESA complete – ${a.piesa_outcome}${rectCount ? `, ${rectCount} electrical fixes item(s) listed` : ", no electrical fixes required"}`, { piesa_outcome: a.piesa_outcome, rectification_items: rectCount ?? 0 });
      res = { advanced: true, scope: s.scope };
    } else res = await advanceSiteRequirements(data.jobId, context.userId);
    if (rectCount && data.rectWindows?.length) {
      const { windowBounds } = await import("./piesa-windows.core");
      const { data: rq } = await admin.from("quotes").select("id").eq("job_id", data.jobId).eq("kind", "rectification").eq("status", "draft").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (rq) await admin.from("quotes").update({ rect_estimated_hours: data.rectHours ?? null }).eq("id", rq.id);
      const { data: asg } = await admin.from("job_assignments").select("id").eq("job_id", data.jobId).eq("role", "electrician").eq("active", true).maybeSingle();
      const { error: we } = await admin.from("appointment_proposals").insert(data.rectWindows.map((w) => ({
        job_id: data.jobId, kind: "rectification" as const, assignment_id: asg?.id ?? null, proposed_by: context.userId, proposer_role: "electrician",
        ...windowBounds(w.date, w.slot), electrician_window: true, note: `Electrician's electrical fixes window (est. ${data.rectHours} h)`,
      })));
      if (we) throw new WorkflowError(we.message);
      await logEvent(data.jobId, context.userId, "rectification_windows_given", `Electrician gave ${data.rectWindows.length} electrical fixes windows and an estimate of ${data.rectHours} hours`, { hours: data.rectHours });
    }
    await autoAdvanceJob(data.jobId, context.userId, "assessment completed");
    return res;
  });

/** Rectification complete + new PIESA; also the reassessment path when the 30-day window expired. */
export const recordPiesa = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({
    jobId: uuid,
    kind: z.enum(["post_rectification", "reassessment"]),
    outcome: z.enum(["pass", "fail"]),
    completedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes: z.string().max(2000).optional(),
    sectionCCompleted: z.boolean().optional(),
    sectionCSignedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const jobRole = await requireJobRole(context.supabase, data.jobId, ["admin", "electrician"]);
    await requireClearanceRecorder(context.supabase as never, jobRole, context.userId);
    const dateBlockers = piesaDateBlockers(data.completedDate); // Melbourne calendar date, not UTC
    if (dateBlockers.length) throw new WorkflowError(dateBlockers[0]!);
    const stage = await getStage(data.jobId);
    if (data.kind === "post_rectification") {
      if (stage !== "rectification_booked") throw new WorkflowError("Electrical fixes must be booked first.");
      const { data: ev } = await admin.from("evidence_requirements").select("status").eq("job_id", data.jobId).eq("category", "rectification_completion").single();
      if (ev && !["uploaded", "verified"].includes(ev.status)) throw new WorkflowError("Upload electrical fixes completion evidence first.");
      if (data.outcome === "pass") {
        const { data: ps } = await admin.from("evidence_requirements").select("status").eq("job_id", data.jobId).eq("category", "piesa_signoff").single();
        if (ps && !["uploaded", "verified"].includes(ps.status)) throw new WorkflowError("Upload the PIESA / Pre Insulation Electrical Safety Assessment (PIESA) sign-off first.");
        const { sectionCBlockers } = await import("./rectification.core");
        const sc = sectionCBlockers(clean({ outcome: data.outcome, completedDate: data.completedDate, sectionCCompleted: data.sectionCCompleted, sectionCSignedDate: data.sectionCSignedDate }));
        if (sc.length) throw new WorkflowError(`Section C: ${sc.join(" ")}`);
      }
      await admin.from("rectification_items").update({ status: "completed" }).eq("job_id", data.jobId).eq("status", "required");
    } else {
      const p = await piesaStatus(data.jobId);
      if (!p?.piesa_expired && stage !== "assessment_complete") throw new WorkflowError("Reassessment is only needed when the PIESA window has expired.");
    }
    await admin.from("piesa_records").update({ is_current: false }).eq("job_id", data.jobId).eq("is_current", true);
    await admin.from("piesa_records").insert({
      job_id: data.jobId,
      kind: data.kind,
      outcome: data.outcome,
      completed_date: data.completedDate,
      signed_off_by: context.userId,
      notes: data.notes ?? null,
      ...(data.kind === "post_rectification" ? { rectification_completed_at: `${data.completedDate}T00:00:00.000Z` } : {}),
      ...(data.kind === "post_rectification" && data.outcome === "pass" ? { section_c_signed_at: `${data.sectionCSignedDate!}T00:00:00.000Z` } : {}),
    });
    await logEvent(data.jobId, context.userId, "piesa_recorded", `PIESA (${data.kind.replace("_", " ")}) ${data.outcome} on ${data.completedDate}`);
    if (data.kind === "post_rectification" && data.outcome === "pass") {
      await admin.from("compliance_checks").update({ status: "pass", checked_at: new Date().toISOString() }).eq("job_id", data.jobId).in("check_key", ["rectification", "electrical_assessment"]);
      await admin.from("bookings").update({ status: "completed" }).eq("job_id", data.jobId).eq("kind", "rectification").eq("status", "confirmed");
      await transition(data.jobId, "installation_scheduling", context.userId, "Electrical fixes complete, PIESA passed – installation scheduling unlocked");
    }
    await autoAdvanceJob(data.jobId, context.userId, "PIESA recorded");
    return { ok: true };
  });

// ---------- Gate 3: quotes ----------
export const generateInstallerQuotes = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const stage = await getStage(data.jobId);
    // Ready Check path (Jo 7 Oct: office-released measured quote at measured_estimate_ready): after the Ready Check is
    // complete and the office has recorded verified eligibility, this office action prepares the measured quote and
    // moves ready_check_complete -> measured_estimate_ready through the guarded transition. The legacy path stays.
    const measuredPath = stage === "ready_check_complete" || stage === "measured_estimate_ready";
    if (!["ready_for_installer_quotes", "awaiting_quote_acceptance", "ready_check_complete", "measured_estimate_ready"].includes(stage)) throw new WorkflowError("Quotes can only be generated once the Ready Check is complete (or the job is Ready for Installer Quotes).");
    // Check the gates BEFORE issuing quotes so none are issued to the owner while the job is blocked.
    const pre = measuredPath
      ? await stageEntryBlockers(data.jobId, "measured_estimate_ready") // verified eligibility + accepted installer measure-up (PIESA comes after acceptance)
      : (await stageEntryBlockers(data.jobId, "awaiting_quote_acceptance")).filter((b) => b !== "No installation quotes issued.");
    if (pre.length) throw new WorkflowError(`Blocked: ${pre.join(" • ")}`);
    await genInstaller(data.jobId, context.userId);
    { const { applyCobrand } = await import("./pilot.server"); await applyCobrand(data.jobId); }
    const { data: released } = await admin.from("quotes").select("id").eq("job_id", data.jobId).eq("kind", "installation").eq("status", "issued").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (stage === "ready_for_installer_quotes" && released) await transition(data.jobId, "awaiting_quote_acceptance", context.userId, "Installation quote released to owner");
    if (stage === "ready_check_complete") await transition(data.jobId, "measured_estimate_ready", context.userId, "Measured quote prepared by the office after verified eligibility");
    await autoAdvanceJob(data.jobId, context.userId, "quotes generated");
    return { ok: true };
  });

export const regenerateRectificationQuote = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const stage = await getStage(data.jobId);
    const quoteId = await generateRectificationQuote(data.jobId, context.userId);
    const { data: released } = await admin.from("quotes").select("id").eq("id", quoteId).eq("status", "issued").maybeSingle();
    if (stage === "rectification_required" && released) await transition(data.jobId, "awaiting_owner_rectification_approval", context.userId, "Electrical fixes quote released to owner");
    return { ok: true };
  });

export const approveHeldQuote = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ quoteId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { approveHeldQuote: approve } = await import("./quotes.server");
    return approve(data.quoteId, context.userId);
  });

export const adjustQuote = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ quoteId: uuid, reason: z.string().trim().min(5).max(1000), items: z.array(z.object({ id: uuid, quantity: z.number().min(0), unit_price_inc_gst: z.number().min(0) })), veecDiscount: z.number().min(0).optional(), discountOverride: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    await adjustQuoteImpl(data.quoteId, context.userId, data.reason, data.items, data.veecDiscount, data.discountOverride ?? false);
    return { ok: true };
  });

export const respondToQuoteSchema = z.object({
    quoteId: uuid, accept: z.boolean(), consent: z.boolean().optional(), reason: z.string().max(1000).optional(),
    windowId: uuid.optional(), noneSuit: z.boolean().optional(), expectedVersion: z.number().int().optional(),
    signing: z.object({
      signatoryName: z.string().trim().min(2).max(200), authorityType: z.enum(["owner", "authorised_representative"]), over18: z.boolean(),
      readConsumerInfo: z.boolean(), acceptAgreement: z.boolean(), signatureName: z.string().trim().max(200),
      assistance: z.enum(["none", "interpreter", "support_understanding", "both"]),
    }).optional(),
  });

export const respondToQuote = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth, withRequestMeta])
  .inputValidator((d) => respondToQuoteSchema.parse(d))
  .handler(async ({ data, context }) => respondToQuoteImpl(data, {
    userId: context.userId, ip: context.ip, userAgent: context.userAgent,
    authorize: (jobId) => requireJobRole(context.supabase, jobId, ["owner", "admin"]).then(() => undefined),
    isOwner: async (jobId) => (await context.supabase.rpc("is_job_owner", { _job: jobId, _user: context.userId })).data === true,
  }));

export type QuoteActor = { userId: string; ip: string | null; userAgent: string | null; authorize: (jobId: string) => Promise<void>; isOwner: (jobId: string) => Promise<boolean> };

/** Shared by the signed-in owner page and the no-login secure link (after a verified 6-digit code). */
export async function respondToQuoteImpl(data: z.infer<typeof respondToQuoteSchema>, context: QuoteActor) {
    const { data: q } = await admin.from("quotes").select("*").eq("id", data.quoteId).single();
    if (!q) throw new WorkflowError("Quote not found");
    await context.authorize(q.job_id);
    if (q.status === "expired") throw new WorkflowError("This quote has expired. Please contact us for an updated quote.");
    if (q.status !== "issued") throw new WorkflowError("This quote is no longer open.");
    // A held or queued installation quote is not the owner's to action (it was never released to them).
    if (q.kind === "installation") { const { ownerQuoteReleased, QUOTE_NOT_RELEASED } = await import("./owner-quote-visibility.core"); if (!ownerQuoteReleased(q)) throw new WorkflowError(QUOTE_NOT_RELEASED); }
    // Exact-version acceptance: if the owner's screen shows a version (any manual adjustment bumps it),
    // accepting an older version is rejected instead of silently approving changed pricing.
    if (data.accept && data.expectedVersion != null && data.expectedVersion !== q.version)
      throw new WorkflowError("This quote has been updated since you opened it. Please review the latest version before accepting.");
    if (data.accept) {
      const { quoteIsExpired } = await import("./quote-expiry.core");
      if (quoteIsExpired(q)) throw new WorkflowError("This quote has expired. Please contact us for an updated quote.");
    }
    if (data.accept && !data.consent) throw new WorkflowError("Please confirm to proceed.");
    if (data.accept) { const bb = await (await import("./installer-quote.server")).quoteBillingBlocker(q.id); if (bb) throw new WorkflowError(`${bb}. Please contact us for an updated quote.`); }
    const stage = await getStage(q.job_id);
    // Installation quotes: the Ready Check path (office-released measured quote at measured_estimate_ready, Jo 7 Oct)
    // and the older awaiting_quote_acceptance path both accept. Every other guard below still applies to both.
    const expected: Stage[] = q.kind === "rectification" ? ["awaiting_owner_rectification_approval"] : ["awaiting_quote_acceptance", "measured_estimate_ready"];
    const measuredPath = q.kind === "installation" && stage === "measured_estimate_ready";
    if (!expected.includes(stage)) throw new WorkflowError("This quote can't be actioned at the current stage.");
    if (!data.accept) {
      await admin.from("quotes").update({ status: "declined" }).eq("id", q.id);
      await logEvent(q.job_id, context.userId, "quote_declined", `${q.option_label} declined`, { reason: data.reason });
      return { ok: true };
    }
    // Installation acceptance is the commercial agreement only. ESC consent and VEEC assignment are later forms.
    if (q.kind === "installation") {
      if (!data.signing) throw new WorkflowError("The customer must review and sign the customer agreement to accept this quote.");
      if (!(await context.isOwner(q.job_id))) throw new WorkflowError("Only the customer can sign the agreement.");
      const { assistance: _a, ...chk } = data.signing;
      await assertAgreementCanSign(chk);
    }
    // All gates are checked BEFORE the quote is marked accepted, so a blocked acceptance leaves nothing half-done.
    let priorAccepted: string[] = [];
    if (q.kind === "installation") {
      // Installer intake jobs: the exact released version, current readiness/consent and no pending reconfirmation.
      const { data: cur } = await admin.from("quotes").select("status, release_state").eq("id", q.id).maybeSingle();
      const { intakeSendBlockers, isIntakeJob } = await import("./installer-intake.server");
      // A site hold also applies to supplied jobs predating the intake workflow.
      const ib = await intakeSendBlockers(q.job_id);
      if (ib.length) throw new WorkflowError(`Blocked: ${ib.join(" • ")}`);
      if (await isIntakeJob(q.job_id)) {
        if (cur?.status !== "issued" || cur.release_state !== "released") throw new WorkflowError("This quote is not the current version sent to you.");
        // Reconfirming after a correction: the earlier accepted quote is replaced only if no invoice was raised on it.
        const { data: prior } = await admin.from("quotes").select("id").eq("job_id", q.job_id).eq("kind", "installation").eq("status", "accepted").neq("id", q.id);
        priorAccepted = (prior ?? []).map((x) => x.id);
        if (prior?.length) {
          const { count: inv } = await admin.from("invoices").select("id", { count: "exact", head: true }).in("quote_id", prior.map((x) => x.id));
          if (inv) throw new WorkflowError("Home Insulation Victoria needs to cancel the earlier invoice before you can accept the corrected quote. We'll be in touch.");
        }
      }
      const cb = await commercialBlocker(q.job_id);
      if (cb) throw new WorkflowError(`Blocked: ${cb}`);
      const p = await piesaStatus(q.job_id);
      const { count: rect } = await admin.from("rectification_items").select("id", { count: "exact", head: true }).eq("job_id", q.job_id).eq("status", "required");
      if (!rect && p?.piesa_expired) throw new WorkflowError("The Pre Insulation Electrical Safety Assessment (PIESA) has expired. Home Insulation Victoria will arrange a reassessment.");
    }
    if (q.kind === "installation" && data.signing) {
      const { assistance, ...input } = data.signing;
      await signCustomerAgreement({ quoteId: q.id, actorId: context.userId, input, assistance, ip: context.ip, userAgent: context.userAgent });
    }
    let pickedWindow: string | null = null;
    if (q.kind === "rectification") {
      // New path: if the electrician gave windows, the owner must pick one (24h+ away) or say none suit.
      const { data: ws } = await admin.from("appointment_proposals").select("id, starts_at, status").eq("job_id", q.job_id).eq("kind", "rectification").eq("electrician_window", true).eq("status", "proposed");
      const { pickableRectWindows } = await import("./rectification.core");
      const open = pickableRectWindows(ws ?? []);
      if (data.windowId) {
        if (!open.some((w) => w.id === data.windowId)) throw new WorkflowError("That time is no longer available. Please choose another.");
        const { error: re } = await admin.rpc("approve_rectification_with_window", { _quote: q.id, _proposal: data.windowId, _user: context.userId });
        if (re) throw new WorkflowError(re.message);
        pickedWindow = open.find((w) => w.id === data.windowId)!.starts_at;
      } else if (ws?.length && !data.noneSuit) {
        throw new WorkflowError("Please choose one of the electrician's times, or tap \"None of these work\".");
      } else if (ws?.length) {
        await admin.from("appointment_proposals").update({ status: "superseded", response_note: "Owner: none of these work" }).eq("job_id", q.job_id).eq("electrician_window", true).eq("status", "proposed");
        await logEvent(q.job_id, context.userId, "rectification_windows_declined", "Owner said none of the electrician's times work — contacts will be shared for the electrical fixes visit when scheduling opens");
      }
    }
    if (!pickedWindow) {
      // Only a still-open quote can become accepted: a quote superseded/expired meanwhile is never flipped back.
      const { data: won, error: ae } = await admin.from("quotes").update({ status: "accepted", accepted_at: new Date().toISOString(), accepted_by: context.userId }).eq("id", q.id).eq("status", "issued").select("id");
      if (ae) throw new Error(ae.message);
      if (!won?.length) { const { QUOTE_CHANGED_WHILE_ACCEPTING } = await import("./owner-quote-visibility.core"); throw new WorkflowError(QUOTE_CHANGED_WHILE_ACCEPTING); }
    }
    await admin.from("quotes").update({ status: "superseded" }).eq("job_id", q.job_id).eq("kind", q.kind).eq("status", "issued");
    if (priorAccepted.length) await admin.from("quotes").update({ status: "superseded" }).in("id", priorAccepted).eq("status", "accepted"); // intake reconfirmation: replaced (no invoice on it — checked above)
    if (pickedWindow) await logEvent(q.job_id, context.userId, "rectification_window_picked", `Owner picked the electrical fixes time ${new Date(pickedWindow).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })}; it becomes the confirmed booking when electrical fixes scheduling opens`, { quote_id: q.id, starts_at: pickedWindow });
    if (pickedWindow) {
      const { moveHoldForRectification } = await import("./install-holds.server");
      await moveHoldForRectification(q.job_id, pickedWindow, context.userId).catch((e) => console.error("install hold move skipped", (e as Error).message));
    }

    if (q.kind === "rectification") {
      // Scope approval only – no invoice. The rectification lines are folded into the final installation quote.
      await logEvent(q.job_id, context.userId, "rectification_scope_approved", `Owner approved electrical fixes scope (${q.customer_total_inc_gst} inc GST)`, { quote_id: q.id });
      await transition(q.job_id, "ready_for_installer_quotes", context.userId, "Electrical fixes scope approved – preparing final installation quotes");
      await genInstaller(q.job_id, context.userId);
      { const { applyCobrand } = await import("./pilot.server"); await applyCobrand(q.job_id); }
      await transition(q.job_id, "awaiting_quote_acceptance", context.userId, "Final installation quotes (incl. electrical fixes) issued to owner");
      await autoAdvanceJob(q.job_id, context.userId, "electrical fixes approved");
      return { ok: true };
    }

    await admin.from("declarations").upsert({ job_id: q.job_id, kind: "owner_consent", declared_by: context.userId, statement: `Owner accepted ${q.option_label} (${q.customer_total_inc_gst} inc GST): approved payment option due now (minimum upfront deposit, paid in full, or active 3-instalment plan), balance due on installation day.` }, { onConflict: "job_id,kind" });
    await admin.from("compliance_checks").update({ status: "pass", checked_at: new Date().toISOString() }).eq("job_id", q.job_id).eq("check_key", "owner_consent");
    await logEvent(q.job_id, context.userId, ASSIGNMENT_EVENTS.QUOTE_ACCEPTED, `${q.option_label} accepted with signed Customer Agreement / Quote Acceptance`, { quote_id: q.id, total_inc_gst: q.customer_total_inc_gst });
    const { data: installerAssignment } = await admin.from("job_assignments").select("id").eq("job_id", q.job_id).eq("role", "installer").eq("active", true).order("assigned_at", { ascending: false }).limit(1).maybeSingle();
    if (installerAssignment) {
      const { data: acceptedEvent } = await admin.from("workflow_events").select("id").eq("job_id", q.job_id).eq("event_type", ASSIGNMENT_EVENTS.QUOTE_ACCEPTED).contains("details", { quote_id: q.id }).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (acceptedEvent) {
        const facts = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${q.id}-${installerAssignment.id}-${q.version}`));
        const hash = [...new Uint8Array(facts)].map((x) => x.toString(16).padStart(2, "0")).join("");
        const { error: notifyError } = await admin.rpc("enqueue_external_action", { _job: q.job_id, _event: acceptedEvent.id, _action: "partner_notifications", _target: `job_assignment:${installerAssignment.id}`, _basis: "transactional_job_coordination", _version: "owner-quote-accepted-v1", _payload: `quote_accepted:${q.id}`, _facts: hash, _key: `quote-accepted-${q.id}-${installerAssignment.id}` });
        if (notifyError) console.error("quote accepted installer notification enqueue skipped", notifyError.message);
      }
    }
    if (measuredPath) {
      // Ready Check path: next is the safety check payment, then the owner picks safety check times.
      await transition(q.job_id, "measured_quote_accepted", context.userId, "Owner accepted the measured quote – Pre Insulation Electrical Safety Assessment (PIESA) payment due next");
      await invoiceAfterAcceptance(q.id, q.job_id, context.userId);
      await autoAdvanceJob(q.job_id, context.userId, "measured quote accepted");
      return { ok: true };
    }
    await transition(q.job_id, "awaiting_deposit_payment", context.userId, "Owner accepted final installation quote – approved payment option due");
    await invoiceAfterAcceptance(q.id, q.job_id, context.userId);
    await advanceAfterDeposit(q.job_id, context.userId);
    return { ok: true };
}

/** The acceptance (signature + stage move) is already committed here. An invoice / Xero push failure must not turn the
 *  owner's completed acceptance into an error they cannot retry (the quote is no longer "issued"); record it for office,
 *  which recovers with Retry Xero push (local invoice row exists) or Sync. */
async function invoiceAfterAcceptance(quoteId: string, jobId: string, actorId: string) {
  try { await createInvoiceForQuote(quoteId, actorId); }
  catch (e) {
    const { data: inv } = await admin.from("invoices").select("id").eq("quote_id", quoteId).maybeSingle();
    await logEvent(jobId, actorId, "invoice_create_failed", `Quote accepted but the invoice step failed – office action needed: ${(e as Error)?.message ?? e}`, { quote_id: quoteId, invoice_id: inv?.id ?? null, local_invoice_exists: !!inv }, { internal: true }).catch(() => null);
  }
}

// ---------- Payments (Xero mirror + gates) ----------
/** Deposit routing now lives in the central auto-advance helper (never bypasses blockers). */
async function advanceAfterDeposit(jobId: string, actorId: string) {
  if ((await getStage(jobId)) === "awaiting_deposit_payment" && (await paymentOptionCleared(jobId)))
    await logEvent(jobId, actorId, ASSIGNMENT_EVENTS.DEPOSIT_PAID, "Approved payment option verified – scheduling can unlock");
  await autoAdvanceJob(jobId, actorId, "payment update");
}

export const syncInvoice = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ invoiceId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    try { await requireHivicInvoice(data.invoiceId); } catch (e) { throw new WorkflowError((e as Error).message); }
    await syncInvoiceFromXero(data.invoiceId, context.userId);
    const { data: inv } = await admin.from("invoices").select("job_id").eq("id", data.invoiceId).single();
    if (inv) await advanceAfterDeposit(inv.job_id, context.userId);
    return { ok: true };
  });

export const retryXeroPush = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ invoiceId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    try { await requireHivicInvoice(data.invoiceId); } catch (e) { throw new WorkflowError((e as Error).message); }
    // Same safe path as Sync: pushes only if not linked, adopts an existing Xero invoice, lock-protected.
    await syncInvoiceFromXero(data.invoiceId, context.userId);
    return { ok: true };
  });

/** Admin override of the deposit gate – reason required, permanently audited. */
export const overrideDepositGate = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ invoiceId: uuid, reason: z.string().trim().min(5).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    try { await requireHivicInvoice(data.invoiceId); } catch (e) { throw new WorkflowError((e as Error).message); }
    const { data: inv } = await admin.from("invoices").select("id, job_id, status, deposit_paid_at, total_paid").eq("id", data.invoiceId).single();
    if (!inv) throw new WorkflowError("Invoice not found");
    // While the payment rule is pending activation an override cannot clear anything: refuse instead of recording a
    // misleading "overridden" audit row that has no effect.
    const { paymentGateActiveForJob } = await import("./workflow.server");
    if (!(await paymentGateActiveForJob(inv.job_id))) throw new WorkflowError("Payment rule pending activation – a deposit override has no effect until the payment gate is switched on. Nothing was recorded.");
    const { count: existing } = await admin.from("payment_overrides").select("id", { count: "exact", head: true }).eq("invoice_id", inv.id).eq("gate", "deposit");
    if (existing) throw new WorkflowError("The deposit gate is already overridden for this invoice.");
    let ov;
    try { ov = buildDepositOverride(inv as never, data.reason, context.userId, await getStage(inv.job_id)); } catch (e) { throw new WorkflowError((e as Error).message); }
    const { error: ovErr } = await admin.from("payment_overrides").insert(ov as never);
    if (ovErr) throw new WorkflowError(`Override not recorded: ${ovErr.message}`);
    await logEvent(inv.job_id, context.userId, "payment_override", `Deposit gate overridden by admin: ${ov.reason}`, { invoice_id: data.invoiceId, before: ov.before_state, after: ov.after_state });
    await advanceAfterDeposit(inv.job_id, context.userId);
    return { ok: true };
  });

/** Admin records that the native Xero deposit request was raised in Xero. Audited; never unlocks scheduling. */
export const markDepositRequestRaised = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ invoiceId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    try { await requireHivicInvoice(data.invoiceId); } catch (e) { throw new WorkflowError((e as Error).message); }
    const { data: inv } = await admin.from("invoices").select("id, job_id, deposit_amount, deposit_pct, deposit_request_raised_at").eq("id", data.invoiceId).single();
    if (!inv) throw new WorkflowError("Invoice not found");
    let patch;
    try { patch = depositRequestPatch(inv as never, context.userId, new Date().toISOString()); } catch (e) { throw new WorkflowError((e as Error).message); }
    await admin.from("invoices").update(patch).eq("id", inv.id);
    await logEvent(inv.job_id, context.userId, "xero_deposit_request_raised", `Native Xero ${patch.deposit_request_pct}% deposit request (${patch.deposit_request_amount} inc GST) recorded as raised in Xero – scheduling still waits for Xero payment`, { invoice_id: inv.id, ...patch }, { internal: true });
    return { ok: true };
  });

/** Dev/testing only until Xero is connected: simulate a payment arriving from Xero. */
export const simulateXeroPayment = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ invoiceId: uuid, amountPaid: z.number().min(0) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    if (process.env["XERO_API_KEY"]) throw new WorkflowError("Xero is connected – use Sync from Xero.");
    const { data: inv } = await admin.from("invoices").select("job_id").eq("id", data.invoiceId).single();
    if (!inv) throw new WorkflowError("Invoice not found");
    // Testing tool: never writes a fake payment onto a real customer job (production shares this database).
    const { data: sj } = await admin.from("jobs").select("source, qa_archived_at").eq("id", inv.job_id).single();
    if (sj?.source !== "qa_test" || sj.qa_archived_at) throw new WorkflowError("Simulated payments are only allowed on live test (qa_test) jobs.");
    await logEvent(inv.job_id, context.userId, "payment_simulated", `Simulated Xero payment total ${data.amountPaid} (testing)`, {}, { internal: true });
    await applyPaidAmount(data.invoiceId, data.amountPaid, context.userId);
    await advanceAfterDeposit(inv.job_id, context.userId);
    return { ok: true };
  });

// ---------- Gate 4: bookings ----------
export const createBooking = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, kind: z.enum(["assessment", "rectification", "installation"]), start: z.string().datetime({ offset: true }), notes: z.string().max(1000).optional(), overrideReason: z.string().trim().max(1000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const need = data.kind === "installation" ? "installer" : "electrician";
    const role = await requireJobRole(context.supabase, data.jobId, ["admin", "owner", need]);
    const { directBookingBlocker } = await import("./pilot.core");
    const blocked = directBookingBlocker(data.kind, role, data.overrideReason);
    if (blocked) throw new WorkflowError(blocked);
    const { confirmBooking } = await import("./booking.server");
    // D-12: an assessment booking here is always an admin override (directBookingBlocker refuses everyone else).
    // confirmBooking checks every gate before it writes, so the override's own writes (superseding open proposals,
    // the homeowner-visible override event) happen only AFTER it succeeds. A refused override changes nothing
    // and leaves only an internal (office-only) diagnostic event.
    const override = data.kind === "assessment";
    try {
      await confirmBooking(data.jobId, data.kind, data.start, context.userId, role === "admin" && override ? "admin (override)" : role, data.notes);
    } catch (e) {
      if (override) await logEvent(data.jobId, context.userId, "admin_booking_override_refused", `Admin override refused: ${(e as Error).message}`, { reason: data.overrideReason, start: data.start }, { internal: true })
        .catch((le) => console.error("override refusal log skipped", (le as Error).message));
      throw e;
    }
    if (override) {
      await admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", data.jobId).eq("kind", "assessment").eq("status", "proposed");
      await logEvent(data.jobId, context.userId, "admin_booking_override", `Admin override: assessment booking set directly for ${new Date(data.start).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" })}`, { reason: data.overrideReason, start: data.start });
    }
    return { ok: true };
  });

/** Admin-only: cancel the current booking of a kind. Installation cancellation clears the balance due date. */
export const cancelBooking = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, kind: z.enum(["assessment", "rectification", "installation"]), reason: z.string().trim().min(5).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { data: rows } = await admin.from("bookings").update({ status: "cancelled" }).eq("job_id", data.jobId).eq("kind", data.kind).in("status", ["proposed", "confirmed"]).select("id");
    if (!rows?.length) throw new WorkflowError(`No active ${data.kind} booking to cancel.`);
    await logEvent(data.jobId, context.userId, "booking_cancelled", `${data.kind} booking cancelled: ${data.reason}`, { booking_ids: rows.map((r) => r.id) });
    if (data.kind === "assessment" && (await getStage(data.jobId)) === "piesa_scheduled") {
      // D-11: "PIESA Scheduled" is only entered by a confirmed PIESA booking (confirmBooking). With that booking cancelled,
      // step back along the existing piesa_scheduled → piesa_and_install_window_pending transition, through the central
      // guarded transition (TRANSITIONS, entry blockers, commit_guarded_stage). If the move is refused, the cancellation
      // still stands and the office gets an internal note with the reason; nothing is forced.
      try {
        await transition(data.jobId, "piesa_and_install_window_pending", context.userId, "PIESA booking cancelled – a new PIESA time is needed", { booking_ids: rows.map((r) => r.id) });
      } catch (e) {
        await logEvent(data.jobId, context.userId, "piesa_stage_not_reverted", `PIESA booking cancelled, but the job could not move back to PIESA pending and stays at PIESA Scheduled: ${(e as Error).message}`, { booking_ids: rows.map((r) => r.id) }, { internal: true })
          .catch((le) => console.error("D-11 stage note skipped", (le as Error).message));
      }
    }
    if (data.kind === "installation") {
      await clearInstallDueDate(data.jobId, context.userId);
      const { regenerateEscNotification } = await import("./esc.server");
      await regenerateEscNotification(data.jobId, context.userId);
    }
    return { ok: true };
  });

// ---------- Gate 5: installation & evidence ----------
export const completeInstallation = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["admin", "installer"]);
    // P0: no confirmed installation booking = no completion (checked BEFORE any stage change; fails closed).
    const { confirmedInstallBooking } = await import("./workflow.server");
    const { booking: unlockBooking, blocker } = await confirmedInstallBooking(data.jobId);
    if (blocker || !unlockBooking) throw new WorkflowError(blocker ?? "No confirmed installation booking.");
    await transition(data.jobId, "evidence_outstanding", context.userId, "Installation marked complete by installer");
    await admin.from("jobs").update({ installation_completed_at: new Date().toISOString() }).eq("id", data.jobId);
    await admin.from("bookings").update({ status: "completed" }).eq("job_id", data.jobId).eq("kind", "installation").eq("status", "confirmed");
    // Gap 4: record exactly which confirmed install booking unlocked installation (AP review requires it completed).
    await logEvent(data.jobId, context.userId, "install_unlocked_by_booking", "Installation recorded against the confirmed install booking", { booking_id: unlockBooking.id, scheduled_start: unlockBooking.scheduled_start }, { internal: true });
    await logEvent(data.jobId, context.userId, ASSIGNMENT_EVENTS.INSTALLATION_COMPLETED, "Eligible installation undertaken");
    await autoAdvanceJob(data.jobId, context.userId, "installation completed");
    return { ok: true };
  });

export const submitDeclaration = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, kind: z.enum(["installer_declaration", "electrician_declaration"]), statement: z.string().trim().min(10).max(4000) }).parse(d))
  .handler(async ({ data, context }) => {
    const jobRole = await requireJobRole(context.supabase, data.jobId, ["admin", data.kind === "installer_declaration" ? "installer" : "electrician"]);
    if (data.kind === "installer_declaration") throw new WorkflowError("Installer declarations are signed in the final VEEC assignment step (approved wording only).");
    await requireClearanceRecorder(context.supabase as never, jobRole, context.userId);
    await admin.from("declarations").upsert({ job_id: data.jobId, kind: data.kind, declared_by: context.userId, statement: data.statement, declared_at: new Date().toISOString() }, { onConflict: "job_id,kind" });
    await logEvent(data.jobId, context.userId, "declaration_submitted", `${data.kind.replace("_", " ")} signed`);
    await autoAdvanceJob(data.jobId, context.userId, "declaration signed");
    return { ok: true };
  });

export const submitForApReview = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["admin", "installer"]);
    await transition(data.jobId, "ap_review", context.userId, "Evidence submitted for Final check");
    return { ok: true };
  });

async function requirementWithAccess(sb: Parameters<typeof requireJobRole>[0], requirementId: string) {
  const { data: req } = await admin.from("evidence_requirements").select("*").eq("id", requirementId).single();
  if (!req) throw new WorkflowError("Requirement not found");
  const role = await requireJobRole(sb, req.job_id, ["admin", "electrician", "installer"]);
  // Current measure-up evidence is installer-only. Historical electrician-attributed files remain readable.
  const measureUp = ["measurement", "existing_insulation_r_value"].includes(req.category) && role === "installer";
  if (role !== "admin" && !measureUp && req.responsible_role !== role) throw new WorkflowError("This evidence is uploaded by another party.");
  return req;
}


const fixSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracyM: z.number().min(0).max(100000).nullish(), capturedAt: z.string().max(40).nullish() }).nullish();
async function enforcePhotoLocation(sb: Parameters<typeof requireJobRole>[0], jobId: string, mime: string, fix: z.infer<typeof fixSchema>) {
  const { checkPhotoLocation, propertyPoint } = await import("./geo.core");
  const role = await requireJobRole(sb, jobId, ["admin", "electrician", "installer"]);
  const { data: job } = await admin.from("jobs").select("property_id").eq("id", jobId).single();
  const [{ data: fact }, { data: ws }] = await Promise.all([
    job?.property_id ? admin.from("property_facts").select("value").eq("property_id", job.property_id).eq("fact_key", "coordinates").eq("is_current", true).limit(1).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("workflow_settings").select("photo_max_distance_m").eq("id", 1).maybeSingle(),
  ]);
  const r = checkPhotoLocation({ mime, fix: fix ?? null, property: propertyPoint(fact?.value), maxM: ws?.photo_max_distance_m ?? 150, isOffice: role === "admin" });
  if (!r.ok) throw new WorkflowError(r.reason);
  return { ...r, role };
}

export const requestEvidenceUpload = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ requirementId: uuid, fileName: z.string().min(1).max(200), mimeType: z.string().max(100), fix: fixSchema }).parse(d))
  .handler(async ({ data, context }) => {
    const req = await requirementWithAccess(context.supabase, data.requirementId);
    { const { INSTALL_EVIDENCE_CATEGORIES } = await import("./prestart.core"); if (INSTALL_EVIDENCE_CATEGORIES.includes(req.category)) { const { requirePrestartClear } = await import("./prestart.server"); await requirePrestartClear(req.job_id); } }
    if (!/^(image\/|video\/|application\/pdf)/.test(data.mimeType)) throw new WorkflowError("Only photos, videos and PDFs are accepted.");
    { const { allowedUpload } = await import("./upload-safety.core"); if (!allowedUpload(data.fileName, data.mimeType)) throw new WorkflowError("Only photos (JPG, PNG, WEBP, HEIC), videos (MP4, MOV) and PDFs are accepted."); }
    await enforcePhotoLocation(context.supabase, req.job_id, data.mimeType, data.fix);
    const safe = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${req.job_id}/${req.category}/${crypto.randomUUID()}-${safe}`;
    const { data: signed, error } = await admin.storage.from("job-files").createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Upload URL failed");
    return { path, token: signed.token };
  });

export const confirmEvidenceUpload = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ requirementId: uuid, path: z.string().min(5).max(500), fileName: z.string().max(200), mimeType: z.string().max(100), size: z.number().int().min(0), fix: fixSchema }).parse(d))
  .handler(async ({ data, context }) => {
    const req = await requirementWithAccess(context.supabase, data.requirementId);
    { const { INSTALL_EVIDENCE_CATEGORIES } = await import("./prestart.core"); if (INSTALL_EVIDENCE_CATEGORIES.includes(req.category)) { const { requirePrestartClear } = await import("./prestart.server"); await requirePrestartClear(req.job_id); } }
    if (!data.path.startsWith(`${req.job_id}/${req.category}/`)) throw new WorkflowError("Invalid path");
    { const { allowedUpload } = await import("./upload-safety.core"); const m = allowedUpload(data.fileName, data.mimeType); if (!m) throw new WorkflowError("That file type isn't accepted."); const { verifyStoredUpload } = await import("./upload-safety.server"); await verifyStoredUpload("job-files", data.path, m); }
    const loc = await enforcePhotoLocation(context.supabase, req.job_id, data.mimeType, data.fix);
    const { persistEvidenceConfirmation } = await import("./evidence-confirmation.server");
    return persistEvidenceConfirmation(admin, { requirement_id: req.id, job_id: req.job_id, storage_path: data.path, file_name: data.fileName, mime_type: data.mimeType, size_bytes: data.size, uploaded_by: context.userId,
      lat: data.fix?.lat ?? null, lng: data.fix?.lng ?? null, location_accuracy_m: data.fix?.accuracyM ?? null, captured_at: null,
      distance_m: loc.distanceM, location_source: loc.exempt ? (loc.role === "admin" ? "office_upload" : "not_required") : "device_at_upload" }, async () => {
      await logEvent(req.job_id, context.userId, "evidence_uploaded", `Evidence uploaded: ${req.label}`, { file: data.fileName });
      await autoAdvanceJob(req.job_id, context.userId, "evidence uploaded");
    });
  });

export const getEvidenceUrl = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ fileId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    // RLS-checked read proves the caller may see this file
    const { data: f } = await context.supabase.from("evidence_files").select("storage_path").eq("id", data.fileId).maybeSingle();
    if (!f) throw new WorkflowError("Not permitted");
    const { data: s, error } = await signFile("job-files", f.storage_path, 300);
    if (error || !s) throw new Error(error?.message);
    return { url: s.signedUrl };
  });

export const verifyEvidence = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ requirementId: uuid, status: z.enum(["verified", "rejected", "not_required", "outstanding"]), notes: z.string().max(2000).optional(), installedAreaM2: z.number().positive().finite().optional(), actualProducts: z.array(z.object({ brand: z.string().trim().min(1).max(200), model: z.string().trim().min(1).max(200), rValue: z.number().positive().finite() })).min(1).max(20).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { data: req } = await admin.from("evidence_requirements").select("job_id,label,category").eq("id", data.requirementId).single();
    if (!req) throw new WorkflowError("Not found");
    const at = new Date().toISOString();
    let notes = data.notes ?? null;
    if (data.actualProducts) {
      if (req.category !== "product_evidence" || data.status !== "verified") throw new WorkflowError("Actual products can only be confirmed while reviewing product label evidence.");
      const { data: files, error } = await admin.from("evidence_files").select("id,job_id,requirement_id,mime_type,uploaded_at,storage_path").eq("job_id", req.job_id).eq("requirement_id", data.requirementId);
      if (error) throw new Error(error.message);
      const { prepareProductReview } = await import("./piisa-products.core");
      notes = JSON.stringify(prepareProductReview({ jobId: req.job_id, requirementId: data.requirementId, products: data.actualProducts, installedAreaM2: data.installedAreaM2, files: files ?? [], actor: context.userId, at }));
    }
    const { error: reviewError } = await admin.from("evidence_requirements").update({ status: data.status, required: data.status === "not_required" ? false : true, verified_by: context.userId, verified_at: at, notes }).eq("id", data.requirementId);
    if (reviewError) throw new Error(reviewError.message);
    await logEvent(req.job_id, context.userId, "evidence_reviewed", `Evidence ${data.status.replace("_", " ")}: ${req.label}`, { notes: data.notes, actual_products: data.actualProducts ?? null });
    if (data.status === "rejected") {
      const { recordEvidenceRejected } = await import("./visit-events.server");
      await recordEvidenceRejected(data.requirementId, context.userId, data.notes ?? null).catch((e) => console.error("evidence rejection not counted", (e as Error).message));
    }
    await autoAdvanceJob(req.job_id, context.userId, "evidence reviewed");
    return { ok: true };
  });

// ---------- Gate 6: compliance & VEEC ----------
export const runComplianceReview = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { data: job } = await admin.from("jobs").select("eligibility_outcome").eq("id", data.jobId).single();
    const p = await piesaStatus(data.jobId);
    const { data: decl } = await admin.from("declarations").select("kind").eq("job_id", data.jobId);
    const kinds = new Set((decl ?? []).map((d) => d.kind));
    const { data: ev } = await admin.from("evidence_requirements").select("status").eq("job_id", data.jobId).eq("required", true);
    const { count: openRect } = await admin.from("rectification_items").select("id", { count: "exact", head: true }).eq("job_id", data.jobId).eq("status", "required");
    const auto: Record<string, boolean> = {
      eligibility: job?.eligibility_outcome === "likely_eligible" || job?.eligibility_outcome === "needs_onsite_confirmation",
      owner_consent: kinds.has("owner_consent"),
      owner_authority: await assignmentEffective(data.jobId),
      electrical_assessment: p?.piesa_outcome === "pass",
      rectification: (openRect ?? 0) === 0,
      installation_evidence: (ev ?? []).every((e) => e.status === "verified"),
      declarations: kinds.has("installer_declaration") && kinds.has("owner_consent"),
    };
    for (const [key, ok] of Object.entries(auto))
      await admin.from("compliance_checks").update({ status: ok ? "pass" : "fail", checked_by: context.userId, checked_at: new Date().toISOString(), notes: "Automated check" }).eq("job_id", data.jobId).eq("check_key", key);
    await logEvent(data.jobId, context.userId, "compliance_reviewed", "Automated compliance review run", auto, { internal: true });
    await autoAdvanceJob(data.jobId, context.userId, "compliance review");
    return { ok: true };
  });

export const setComplianceCheck = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ checkId: uuid, status: z.enum(["pending", "pass", "fail"]), notes: z.string().max(2000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { data: c } = await admin.from("compliance_checks").update({ status: data.status, notes: data.notes ?? null, checked_by: context.userId, checked_at: new Date().toISOString() }).eq("id", data.checkId).select("job_id,label").single();
    if (c) await logEvent(c.job_id, context.userId, "compliance_check", `${c.label}: ${data.status}`, { notes: data.notes }, { internal: true });
    if (c) await autoAdvanceJob(c.job_id, context.userId, "compliance check");
    return { ok: true };
  });

export const markReadyForVeec = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    if ((await getStage(data.jobId)) === "ap_review") throw new WorkflowError("Final AP approval happens only in the AP approval queue. Approve this job there.");
    await transition(data.jobId, "ready_for_veec", context.userId, "All compliance requirements passed – Ready for VEEC");
    return { ok: true };
  });

export const updateVeec = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, quantity: z.number().min(0).nullable(), status: z.enum(["not_submitted", "submitted", "query", "approved", "rejected"]), submission_reference: z.string().trim().max(100).nullable(), submitted_date: z.string().nullable(), notes: z.string().max(2000).nullable(), query_text: z.string().max(4000).nullable().optional(), query_received_at: z.string().nullable().optional(), reply_draft: z.string().max(8000).nullable().optional(), reason: z.string().max(500).nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { jobId, reason, query_text, query_received_at, reply_draft, ...rest } = data;
    const patch = {
      ...rest,
      // Optional fields: only written when the form supplies them, so saving other details never wipes a recorded query or draft.
      ...(query_text !== undefined ? { query_text } : {}),
      ...(query_received_at !== undefined ? { query_received_at } : {}),
      ...(reply_draft !== undefined ? { reply_draft } : {}),
    };
    if (["submitted", "approved"].includes(data.status) && !["ready_for_veec", "complete"].includes(await getStage(jobId)))
      throw new WorkflowError("VEEC can only be lodged once the job is Ready for VEEC.");
    const { data: prev } = await admin.from("veec_lodgements").select("status,quantity,submission_reference,submitted_date,notes,query_text,query_received_at,reply_draft").eq("job_id", jobId).maybeSingle();
    const { veecUpdateBlockers, veecCompletesJob } = await import("./veec.core");
    const blockers = veecUpdateBlockers(prev, { ...patch, reason: reason ?? null }, (await import("./veec.core")).melbourneToday());
    if (blockers.length) throw new WorkflowError(blockers.join(" "));
    await admin.from("veec_lodgements").update({ ...patch, updated_at: new Date().toISOString() }).eq("job_id", jobId);
    await logEvent(jobId, context.userId, "veec_updated", `VEEC lodgement ${data.status.replace("_", " ")}`, { ...rest, previous: prev, reason: reason ?? null }, { internal: true });
    // Only a registered (approved) VEEC completes the job; submitted, query and rejected keep it open at Ready for VEEC.
    if (veecCompletesJob(data.status) && (await getStage(jobId)) === "ready_for_veec")
      await transition(jobId, "complete", context.userId, "VEEC registered – job complete");
    await autoAdvanceJob(jobId, context.userId, "VEEC updated");
    return { ok: true };
  });

/** Draft a Registry query reply with AI. Office only. Returns text only; never changes the lodgement or sends anything. */
export const draftVeecReply = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { data: v } = await admin.from("veec_lodgements").select("status,quantity,submission_reference,submitted_date,query_text").eq("job_id", data.jobId).maybeSingle();
    if (v?.status !== "query" || !v.query_text) throw new WorkflowError("A Registry query with its text must be recorded first.");
    const { data: j } = await admin.from("jobs").select("job_number, properties(address_line, suburb, postcode)").eq("id", data.jobId).single();
    const prop = Array.isArray(j?.properties) ? j?.properties[0] : j?.properties;
    const jobLabel = [j?.job_number, [prop?.address_line, prop?.suburb, prop?.postcode].filter(Boolean).join(", ")].filter(Boolean).join(" — ");
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new WorkflowError("AI drafting is not configured.");
    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "fetch" },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        reasoning: { effort: "low" },
        input: `You draft a factual reply to an Essential Services Commission (VEU program) Registry query about a lodged VEEC creation for Home Insulation Victoria, the Accredited Person. Reply in plain Australian English, under 200 words, no invented facts, list anything that must be verified before sending.\n\nJob: ${jobLabel}.\nLodgement: quantity ${v.quantity ?? "?"}, reference ${v.submission_reference ?? "?"}, submitted ${v.submitted_date ?? "?"}.\nRegistry query: ${v.query_text}`,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`AI draft failed [${res.status}]: ${body}`);
      throw new WorkflowError(`Drafting failed (${res.status}). Try again later.`);
    }
    const json = (await res.json()) as { output?: { content?: { text?: string }[] }[] };
    const draft = (json.output ?? []).flatMap((o) => o.content ?? []).map((c) => c.text ?? "").join("").trim();
    if (!draft) throw new WorkflowError("The draft came back empty. Try again.");
    await logEvent(data.jobId, context.userId, "veec_reply_drafted", "AI drafted a Registry query reply (not sent)", { draft }, { internal: true });
    return { draft };
  });

/** Record that the AP sent the reply in the Registry's own system. Office only, audited. */
export const markVeecReplySent = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, replyDraft: z.string().trim().min(5).max(8000), sentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { data: v } = await admin.from("veec_lodgements").select("status").eq("job_id", data.jobId).maybeSingle();
    if (v?.status !== "query") throw new WorkflowError("This lodgement is not in Registry query.");
    if (data.sentDate > melbourneToday()) throw new WorkflowError("Reply sent date cannot be in the future.");
    await admin.from("veec_lodgements").update({ reply_draft: data.replyDraft, reply_sent_at: data.sentDate, reply_sent_by: context.userId, updated_at: new Date().toISOString() }).eq("job_id", data.jobId);
    await logEvent(data.jobId, context.userId, "veec_reply_sent", "Registry query reply sent (recorded by office)", { sent_date: data.sentDate }, { internal: true });
    return { ok: true };
  });

// ---------- Comms / exceptions ----------
export const sendMessage = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, body: z.string().trim().min(1).max(4000), internal: z.boolean().optional(), channel: z.enum(["portal", "phone", "sms", "email"]).optional(), audience: z.enum(["customer", "trade"]).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await requireJobRole(context.supabase, data.jobId, ["admin", "electrician", "installer", "owner"]);
    if (data.channel === "email" || data.channel === "sms") {
      const { assertCustomerCommsEnabled, assertCustomerDeliveryAllowed } = await import("./comms.server");
      // Owners can receive this unless explicitly trade-only: then the owner's contact consent is also required.
      if ((data.audience ?? "customer") === "customer") await assertCustomerDeliveryAllowed(data.jobId, `${data.channel} message`);
      else await assertCustomerCommsEnabled(`${data.channel} message`);
    }
    // Owners and trades talk only through the portal: typed phone numbers/emails are masked.
    const { maskContactDetails } = await import("./messaging.core");
    const body = role === "admin" ? data.body : maskContactDetails(data.body).body;
    await admin.from("messages").insert({ job_id: data.jobId, sender_id: context.userId, body, internal: role === "admin" ? !!data.internal : false, channel: data.channel ?? "portal" });
    await admin.from("jobs").update({ last_activity_at: new Date().toISOString() }).eq("id", data.jobId);
    return { ok: true };
  });

export const requestReassignment = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, role: z.enum(["electrician", "installer"]), reason: z.string().trim().min(5).max(2000), cantAgreeTime: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    // Review-only: never unassigns. Automatic electrician release lives in requestAnotherElectrician (48h / cannot-attend rules).
    await requireJobRole(context.supabase, data.jobId, ["owner", "admin"]);
    const reason = data.cantAgreeTime ? `Can't agree a suitable time: ${data.reason}` : data.reason;
    await admin.from("reassignment_requests").insert({ job_id: data.jobId, role: data.role, requested_by: context.userId, reason });
    await logEvent(data.jobId, context.userId, data.cantAgreeTime ? "reassignment_review_requested" : "reassignment_requested", data.cantAgreeTime ? `Owner can't agree a time with the ${data.role} – Home Insulation Victoria to review (${data.role} stays assigned)` : `Owner requested a different ${data.role}`, { reason });
    await admin.from("jobs").update({ next_action: `Review ${data.role} reassignment request (owner)` }).eq("id", data.jobId);
    return { ok: true };
  });

export const setHold = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, action: z.enum(["hold", "resume", "cancel"]), reason: z.string().trim().max(1000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { data: job } = await admin.from("jobs").select("stage, prior_stage").eq("id", data.jobId).single();
    if (!job) throw new WorkflowError("Not found");
    if (data.action === "resume") {
      if (job.stage !== "on_hold" || !job.prior_stage) throw new WorkflowError("Job is not on hold.");
      const { retiredStageBlocker } = await import("./workflow");
      const retired = retiredStageBlocker(job.prior_stage);
      if (retired) throw new WorkflowError(`Can't resume into ${job.prior_stage.replaceAll("_", " ")}: ${retired} Move it to the Ready Check stage instead.`);
      await admin.from("jobs").update({ stage: job.prior_stage, prior_stage: null, hold_reason: null }).eq("id", data.jobId);
      await logEvent(data.jobId, context.userId, "stage_changed", "Job resumed", {}, { from: "on_hold", to: job.prior_stage });
    } else {
      const { applyHoldOrCancel } = await import("./job-disposition.server");
      await applyHoldOrCancel(data.jobId, data.action, data.reason ?? "", context.userId);
    }
    return { ok: true };
  });

export const getJobBlockers = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["admin", "electrician", "installer", "owner"]);
    return nextStepBlockers(data.jobId);
  });

// ---------- Owner Authority ----------
async function authorityJob(id: string) {
  const { data } = await admin.from("owner_authorities").select("job_id").eq("id", id).single();
  if (!data) throw new WorkflowError("Authority not found");
  return data.job_id;
}

/** Retired legacy Owner Authority action – history is read-only; consent is signed at quote acceptance. */
export const requestOwnerAuthority = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async () => {
    throw new WorkflowError("Owner Authority has been retired. Consent is signed at quote acceptance.");
  });


/** Retired legacy Owner Authority action – history is read-only; consent is signed at quote acceptance. */
export const revokeOwnerAuthority = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async () => {
    throw new WorkflowError("Owner Authority has been retired. Consent is signed at quote acceptance.");
  });


/** Retired legacy Owner Authority action – history is read-only; consent is signed at quote acceptance. */
export const viewOwnerAuthority = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async () => {
    throw new WorkflowError("Owner Authority has been retired. Consent is signed at quote acceptance.");
  });


/** Retired legacy Owner Authority action – history is read-only; consent is signed at quote acceptance. */
export const acceptOwnerAuthority = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async () => {
    throw new WorkflowError("Owner Authority has been retired. Consent is signed at quote acceptance.");
  });


/** Retired legacy Owner Authority action – history is read-only; consent is signed at quote acceptance. */
export const declineOwnerAuthority = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .handler(async () => {
    throw new WorkflowError("Owner Authority has been retired. Consent is signed at quote acceptance.");
  });


export const getAuthorityDocUrl = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ authorityId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: a } = await context.supabase.from("owner_authorities").select("document_path").eq("id", data.authorityId).maybeSingle();
    if (!a?.document_path) throw new WorkflowError("No locked document available");
    const { data: s, error } = await signFile("job-files", a.document_path, 300);
    if (error || !s) throw new Error(error?.message);
    return { url: s.signedUrl };
  });

/** Admin: mark expired authorities across all jobs (audited). */
/** Admin-only pipeline sweep: advance any job whose stored portal state now allows it (no Xero/Mitti calls). */
export const autoAdvancePipeline = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireAdmin(context.supabase);
  return autoAdvanceOpenJobs(context.userId);
});

/** Admin-only pipeline read. Verify the caller with their RLS-scoped client, then load the complete board. */
export const getAdminPipeline = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireAdmin(context.supabase);
  const { archivedQaJobIds, enrichPipeline, jobOverview } = await import("./job-pipeline.server");
  const archivedQaIds = new Set(await archivedQaJobIds());
  // `id` is the stable tie-breaker: without it, rows sharing a last_activity_at can swap places
  // between requests and the same record can appear on two pages at once.
  const { data, error } = await jobOverview().order("last_activity_at", { ascending: false }).order("id");
  if (error) throw new Error(`Pipeline could not be loaded: ${error.message}`);
  return enrichPipeline((data ?? []).filter((j) => j.id != null && !archivedQaIds.has(j.id)));
});

/**
 * One server-paginated page of the Active / Closed jobs list. The database applies
 * filter -> search -> sort -> page; the count comes from a separate exact count so the tile totals
 * never depend on which page is open. Only the rows on this page are enriched and sent.
 */
export const getJobListPage = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    mode: z.enum(["active", "closed"]),
    closedView: z.enum(["completed", "cancelled", "ineligible", "test"]).default("completed"),
    stage: z.string().max(40).default("all"),
    search: z.string().max(120).default(""),
    sort: z.string().max(40).default("last_activity_at"),
    direction: z.enum(["asc", "desc"]).default("desc"),
    page: z.number().int().min(1).max(100_000).default(1),
    pageSize: z.number().int().min(1).max(100).default(20),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { loadJobListPage } = await import("./job-list-page.server");
    return loadJobListPage(data);
  });

export const getGate1Evidence = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { previewGate1 } = await import("./eligibility.server");
    return previewGate1(data.jobId);
  });

/** Admin-only compact Base44 intake summary: owner answers, consent, photos. No research or raw snapshots. */
export const getIntakeSummary = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const [{ data: job }, { data: consents }, { data: media }, { data: fails }] = await Promise.all([
      admin.from("jobs").select("external_enquiry_id, source, life_support_status, estimated_area_m2, estimated_area_unknown, eligibility_outcome, eligibility_reason, eligibility_decision_source, properties(state, occupancy, enrichment)").eq("id", data.jobId).single(),
      admin.from("owner_contact_consents").select("consent_status, consent_version, consented_at, age_confirmed, assistance, contact_preference, created_at, sha256").eq("job_id", data.jobId).order("created_at", { ascending: false }).limit(1),
      admin.from("documents").select("id, title, mime_type, storage_path, original_name, size_bytes").eq("job_id", data.jobId).eq("source_system", "base44").order("created_at"),
      admin.from("workflow_events").select("created_at, summary").eq("job_id", data.jobId).eq("event_type", "base44_media_copy_failed").order("created_at", { ascending: false }).limit(1),
    ]);
    const prop = (job?.properties ?? null) as { state: string; occupancy: string | null; enrichment: Record<string, any> } | null;
    const b44 = prop?.enrichment?.["base44"] ?? null;
    const links = await Promise.all((media ?? []).map(async (m) => {
      const { data: s } = await signFile("job-files", m.storage_path, 3600);
      return { id: m.id, name: m.original_name ?? m.title, mime: m.mime_type, size: m.size_bytes, url: s?.signedUrl ?? null };
    }));
    return JSON.parse(JSON.stringify({
      reference: job?.external_enquiry_id ?? null, source: job?.source ?? null, state: prop?.state ?? null, occupancy: prop?.occupancy ?? null,
      lifeSupport: job?.life_support_status ?? null, area: job?.estimated_area_unknown ? null : job?.estimated_area_m2 ?? null,
      consent: consents?.[0] ?? null, declared: b44?.declared ?? null,
      declaredExtras: (await import("./enquiry.core")).declaredExtras(b44?.raw?.answers ?? null),
      // Preliminary website screening only – never the authoritative Step-2 category.
      screening: (() => { const prelim = job?.eligibility_decision_source !== "system" && job?.eligibility_decision_source !== "admin"; const raw = b44?.raw?.screening ?? null; return { outcome: prelim ? job?.eligibility_outcome ?? null : (typeof raw?.status === "string" ? raw.status : null), reasons: prelim ? job?.eligibility_reason ?? null : null, raw }; })(),
      media: links, lastMediaFailure: fails?.[0] ?? null,
      postIntake: await (await import("./postintake.server")).postIntakeStatus(data.jobId),
    })) as {
      reference: string | null; source: string | null; state: string | null; occupancy: string | null; lifeSupport: string | null; area: number | null;
      consent: { consent_status: string; consent_version: string | null; consented_at: string | null; age_confirmed: boolean | null; assistance: string | null; contact_preference: string | null; created_at: string } | null;
      declared: { property_type: string | null; over_five_years: string | null; previous_upgrade: string | null } | null;
      declaredExtras: { existing_insulation: string | null; top_floor: string | null };
      screening: { outcome: string | null; reasons: string | null; raw: Json };
      media: { id: string; name: string; mime: string | null; size: number | null; url: string | null }[];
      lastMediaFailure: { created_at: string; summary: string } | null;
      postIntake: { status: string; attempts: number; last_error: string | null; available_at: string; updated_at: string; completed_at: string | null; reason: string | null } | null;
    };
  });

export const getCommsStatus = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireAdmin(context.supabase);
  const { customerCommsEnabled } = await import("./comms.server");
  return { enabled: await customerCommsEnabled() };
});

/** Admin-only health snapshot of the durable post-intake queue (Step 1 -> Step 2 worker). */
export const getPostIntakeHealth = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireAdmin(context.supabase);
  return (await import("./postintake.server")).postIntakeHealth();
});

export const sweepAuthorities = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireAdmin(context.supabase);
  const { data } = await admin.from("owner_authorities").select("job_id").eq("status", "accepted").lt("expires_at", new Date().toISOString());
  for (const j of new Set((data ?? []).map((r) => r.job_id))) await sweepAuthorityExpiry(j);
  return { swept: data?.length ?? 0 };
});

/** Admin-only internal Xero identifiers and sync state (hidden from owners/trades at column level). */
export const getInvoiceInternals = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { data: inv } = await admin.from("invoices").select("id, xero_contact_id, xero_invoice_id, xero_reference, xero_invoice_status, last_synced_at, last_sync_error, sync_lock_at, xero_update_pending, deposit_request_raised_at, deposit_request_raised_by, deposit_request_amount, deposit_request_pct").eq("job_id", data.jobId);
    const { data: ov } = await admin.from("payment_overrides").select("id, invoice_id, reason, created_at, overridden_by, gate").eq("job_id", data.jobId);
    const ids = [...new Set([...(ov ?? []).map((o) => o.overridden_by), ...(inv ?? []).map((i) => i.deposit_request_raised_by).filter((x): x is string => !!x)])];
    const { data: profs } = ids.length ? await admin.from("profiles").select("id, full_name").in("id", ids) : { data: [] };
    const { data: jb } = await admin.from("jobs").select("business_unit").eq("id", data.jobId).maybeSingle();
    return { xeroAllowed: jb?.business_unit === "hivic", invoices: (inv ?? []).map((i) => ({ ...i, deposit_request_raised_by_name: profs?.find((p) => p.id === i.deposit_request_raised_by)?.full_name ?? null })), overrides: (ov ?? []).map((o) => ({ ...o, by: profs?.find((p) => p.id === o.overridden_by)?.full_name ?? null })) };
  });

export const updatePartnerEnquiry = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid, status: z.enum(["new", "contacted", "onboarding", "approved", "declined", "closed"]).optional(), internal_notes: z.string().max(5000).nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    if (data.status === "approved") {
      const { data: signed } = await admin.from("rec_onboarding_applications").select("id").eq("partner_enquiry_id", data.id).eq("status", "submitted").limit(1);
      const { enquiryStatusBlocker } = await import("./test-approval.core");
      const b = enquiryStatusBlocker({ status: data.status, hasSignedApplication: (signed ?? []).length > 0 });
      if (b) throw new WorkflowError(b);
    }
    const now = new Date().toISOString();
    const patch: import("@/integrations/supabase/types").TablesUpdate<"partner_enquiries"> = {};
    if (data.internal_notes !== undefined) patch.internal_notes = data.internal_notes;
    if (data.status) {
      patch.status = data.status; patch.status_changed_by = context.userId;
      if (data.status === "contacted") patch.contacted_at = now;
      if (data.status === "approved") patch.approved_at = now;
      if (data.status === "declined") patch.declined_at = now;
    }
    const { error } = await admin.from("partner_enquiries").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Commercial quote acceptance and post-install VEEC assignment ----------
export const getAcceptancePackage = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ quoteId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: q } = await admin.from("quotes").select("job_id, kind").eq("id", data.quoteId).single();
    if (!q || q.kind !== "installation") throw new WorkflowError("Quote not found");
    await requireJobRole(context.supabase, q.job_id, ["owner", "admin"]);
    const templates = await loadTemplates();
    const pick = (k: TemplateKey) => templates.find((t) => t.template_key === k && t.approved) ?? null;
    return { pkg: await buildAcceptancePackage(data.quoteId), consumerRights: pick("consumer_rights"), agreementWording: pick("customer_agreement"), blockers: templateBlockers(templates, "agreement") };
  });

/** All four separate signing records for a job, filtered by role. */
export const getAssignment = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await requireJobRole(context.supabase, data.jobId, ["admin", "owner", "installer"]);
    const { currentConsent } = await import("./consent.server");
    const { data: history } = await admin.from("customer_assignments").select("*").eq("job_id", data.jobId).order("created_at", { ascending: false });
    const { data: v } = await admin.from("assignment_variations").select("id, assignment_id, reasons, status, raised_at, reconfirmed_at, signature_name").eq("job_id", data.jobId).order("raised_at", { ascending: false });
    const templates = await loadTemplates();
    const cur = await currentAssignment(data.jobId);
    const agreement = await currentAgreement(data.jobId);
    const decl = await currentInstallerDeclaration(data.jobId);
    const consent = await currentConsent(data.jobId);
    const { data: job } = await admin.from("jobs").select("stage, installation_completed_at").eq("id", data.jobId).single();
    const installerDeclaration = templates.find((t) => t.template_key === "installer_declaration" && t.approved) ?? null;
    const officialForm = templates.find((t) => t.template_key === "consumer_declaration" && t.approved) ?? null;
    const escConsentTemplate = templates.find((t) => t.template_key === "esc_consent" && t.approved) ?? null;
    const { data: ov } = await admin.from("job_overview").select("job_number, property_address, owner_name, piesa_date, install_deadline, installer_id, installer_name").eq("id", data.jobId).maybeSingle();
    const { data: ip } = ov?.installer_id ? await admin.from("profiles").select("full_name, licence_number, businesses(name, abn)").eq("id", ov.installer_id).maybeSingle() : { data: null };
    const biz = (ip?.businesses ?? null) as { name: string | null; abn: string | null } | null;
    const prefill = prefillRows([
      ["Job", ov?.job_number], ["Property", ov?.property_address], ["Owner", ov?.owner_name],
      ["Installer", ip?.full_name ?? ov?.installer_name], ["Company", biz?.name], ["ABN", biz?.abn], ["Licence", ip?.licence_number],
      ["Product quoted", agreement?.quoted_product], ["Area quoted (m²)", agreement?.quoted_area_m2],
      ["PIESA completed", ov?.piesa_date], ["Install by (PIESA +30 days)", ov?.install_deadline],
    ]);
    const consentView = consent ? { id: consent.id, status: consent.status, version: consent.version, scheduled_start: consent.scheduled_start, installation_days: consent.installation_days, premises_address: consent.premises_address, ap_legal_entity: consent.ap_legal_entity, owner_contact: consent.owner_contact, owner_signed_at: consent.owner_signed_at, ap_signed_at: consent.ap_signed_at, ap_rep_name: consent.ap_rep_name, delivery_status: consent.delivery_status, copy_path: consent.copy_path, blockers: consentValidityBlockers(consent, consent.scheduled_start) } : null;
    const common = {
      stage: job?.stage ?? null, installationCompleted: !!job?.installation_completed_at,
      installerBlockers: templateBlockers(templates, "installer"), finalBlockers: templateBlockers(templates, "final"),
      installerDeclaration, installerFields: parseFormFields(installerDeclaration?.form_fields), officialForm, escConsentTemplate, prefill,
      declaration: decl ? { id: decl.id, installed_product: decl.installed_product, installed_r_value: decl.installed_r_value, installed_area_m2: decl.installed_area_m2, signed_at: decl.signed_at } : null,
    };
    if (role === "installer") {
      // Trades never see prices, consent contact details or consumer signature evidence.
      return { role, agreement: null, consent: null, current: cur ? { id: cur.id, status: cur.status, installer_signed_at: cur.installer_signed_at, installed_product: cur.installed_product, installed_area_m2: cur.installed_area_m2, final_facts: null } : null, history: [], variations: [], ...common };
    }
    return { role, agreement, consent: consentView, current: cur, history: history ?? [], variations: v ?? [], ...common };
  });

export const signInstallerDeclaration = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth, withRequestMeta])
  .inputValidator((d) => z.object({
    jobId: uuid, asQuotedProduct: z.boolean(), installedProduct: z.string().trim().max(300).optional().nullable(), installedRValue: z.string().trim().max(20).optional().nullable(), installedArea: z.number().positive().max(100000),
    fieldValues: z.record(z.string().max(60), z.union([z.string().max(1000), z.number(), z.boolean(), z.null()])).default({}), signatureName: z.string().trim().min(2).max(200),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["installer"]);
    // Retired 7 Oct 2026: the installer declaration is signed inside the Mitti PIISA form onsite.
    void signInstallerDecl;
    throw new WorkflowError("The installer declaration is signed in the Mitti installer safety form (PIISA), not in the portal.");
  });

export const prepareFinalAssignmentFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, fieldValues: z.record(z.string().max(60), z.union([z.string().max(1000), z.number(), z.boolean(), z.null()])).default({}) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    return { id: await prepareFinalAssignment(data.jobId, context.userId, data.fieldValues) };
  });

export const signFinalAssignmentFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth, withRequestMeta])
  .inputValidator((d) => z.object({ jobId: uuid, party: z.enum(["installer", "ap", "consumer"]), signatureName: z.string().trim().min(2).max(200), signatoryName: z.string().trim().max(200).optional(), authorityType: z.enum(["owner", "authorised_representative"]).optional(), over18: z.boolean().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    if (data.party === "ap") await requireAdmin(context.supabase);
    else await requireJobRole(context.supabase, data.jobId, [data.party === "installer" ? "installer" : "owner"]);
    await signFinalAssignment({ ...data, actorId: context.userId, ip: context.ip, userAgent: context.userAgent });
    await autoAdvanceJob(data.jobId, context.userId, "final assignment signed");
    return { ok: true };
  });

export const signOwnerConsentFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth, withRequestMeta])
  .inputValidator((d) => z.object({ jobId: uuid, signatoryName: z.string().trim().min(2).max(200), authorityType: z.enum(["owner", "authorised_representative"]), accept: z.boolean(), signatureName: z.string().trim().min(2).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isOwner } = await context.supabase.rpc("is_job_owner", { _job: data.jobId, _user: context.userId });
    if (!isOwner) throw new WorkflowError("Only the owner or their authorised representative can sign this consent.");
    const { signOwnerConsent } = await import("./consent.server");
    const { jobId, ...input } = data;
    await signOwnerConsent({ jobId, actorId: context.userId, input, ip: context.ip, userAgent: context.userAgent });
    return { ok: true };
  });

export const confirmApConsentFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth, withRequestMeta])
  .inputValidator((d) => z.object({ jobId: uuid, apRepName: z.string().trim().min(2).max(200), purposeExplained: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { confirmApConsent } = await import("./consent.server");
    await confirmApConsent({ ...data, actorId: context.userId, ip: context.ip, userAgent: context.userAgent });
    return { ok: true };
  });

export const getComplianceSetup = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireAdmin(context.supabase);
  const templates = await loadTemplates();
  const { count, error } = await admin.from("esc_notification_config").select("id", { count: "exact", head: true }).eq("approved", true).eq("is_active", true);
  if (error || count === null) throw new WorkflowError(`Could not read ESC notification approval: ${error?.message ?? "missing count"}`);
  return setupStatus(templates, count > 0);
});

export const raiseAssignmentVariation = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, reason: z.string().trim().min(5).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    await raiseVariation(data.jobId, context.userId, [`Other material change: ${data.reason}`]);
    return { ok: true };
  });

export const reconfirmAssignmentVariation = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth, withRequestMeta])
  .inputValidator((d) => z.object({ variationId: uuid, signatureName: z.string().trim().min(2).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: v } = await admin.from("assignment_variations").select("job_id").eq("id", data.variationId).single();
    if (!v) throw new WorkflowError("Variation not found");
    const { data: isOwner } = await context.supabase.rpc("is_job_owner", { _job: v.job_id, _user: context.userId });
    if (!isOwner) throw new WorkflowError("Only the customer can reconfirm a variation.");
    await reconfirmVariation({ variationId: data.variationId, actorId: context.userId, signatureName: data.signatureName, ip: context.ip, userAgent: context.userAgent });
    return { ok: true };
  });

/** Signed copies: RLS-scoped read of the path (owner/admin), then a short-lived signed link. */
export const getAssignmentDocUrl = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid, which: z.enum(["agreement", "consent", "final"]) }).parse(d))
  .handler(async ({ data, context }) => {
    let path: string | null | undefined;
    if (data.which === "agreement") path = (await context.supabase.from("customer_agreements").select("copy_path").eq("id", data.id).maybeSingle()).data?.copy_path;
    else if (data.which === "consent") path = (await context.supabase.from("owner_esc_consents").select("copy_path").eq("id", data.id).maybeSingle()).data?.copy_path;
    else path = (await context.supabase.from("customer_assignments").select("final_copy_path").eq("id", data.id).maybeSingle()).data?.final_copy_path;
    if (!path) throw new WorkflowError("No copy available");
    const { data: s, error } = await signFile("job-files", path, 300);
    if (error || !s) throw new Error(error?.message);
    return { url: s.signedUrl };
  });

// Admin: versioned compliance wording. The portal never supplies official text itself.
export const listComplianceTemplates = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireAdmin(context.supabase);
  const { data, error } = await admin.from("compliance_templates").select("*").order("template_key").order("created_at", { ascending: false });
  if (error) throw new WorkflowError(`Could not read compliance versions: ${error.message}`);
  return data ?? [];
});

export const addComplianceTemplate = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ template_key: z.enum(["customer_agreement", "consumer_declaration", "consumer_rights", "esc_consent", "installer_declaration", "ap_declaration", "partner_agreement"]), version: z.string().trim().min(1).max(50), body: z.string().trim().min(20).max(50000), source_note: z.string().max(1000).optional(), required: z.boolean().default(true), form_fields: z.array(z.unknown()).max(40).default([]) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const form_fields = parseFormFields(data.form_fields) as unknown as Json;
    const { error } = await admin.from("compliance_templates").insert({ ...data, form_fields, source_note: data.source_note ?? null, created_by: context.userId });
    if (error) throw new WorkflowError(error.message);
    return { ok: true };
  });

export const approveComplianceTemplate = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    await (await import("./owner-gates.server")).approveTemplateVersion(data.id, context.userId);
    return { ok: true };
  });


export const getProviderHealth = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { providerConfigFromEnv, providerStatuses } = await import("./providers.gather");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: last } = await supabaseAdmin.from("property_intelligence_runs").select("id").eq("job_id", data.jobId).order("started_at", { ascending: false }).limit(1).maybeSingle();
    const { data: checks } = last ? await supabaseAdmin.from("property_source_checks").select("source_key, status, error").eq("run_id", last.id) : { data: [] };
    return providerStatuses(providerConfigFromEnv(process.env as Record<string, string | undefined>), checks ?? []);
  });

/** Admin-only read-only Google Solar smoke test for a supplied job. Stores nothing; returns non-secret diagnostics only. */
export const solarSmokeTest = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const key = process.env["GOOGLE_SOLAR_API_KEY"];
    if (!key) return { configured: false, status: "not_configured", detail: "GOOGLE_SOLAR_API_KEY is not set", http_status: null as number | null, latency_ms: null as number | null, summary: null as string | null };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: job } = await supabaseAdmin.from("jobs").select("properties(address_line, suburb, postcode, state)").eq("id", data.jobId).single();
    const p = job?.properties as { address_line: string; suburb: string | null; postcode: string | null; state: string } | null;
    if (!p) return { configured: true, status: "error", detail: "Job has no property", http_status: null, latency_ms: null, summary: null };
    const { gatherEvidence, defaultFetchJson } = await import("./intelligence.gather");
    const { defaultProviderHttp } = await import("./providers.gather");
    const g = await gatherEvidence({ addressLine: p.address_line, suburb: p.suburb, postcode: p.postcode, state: p.state, ownerEstimateM2: null, partnerMeasurement: null, provider: null,
      providers: { cfg: { pricefinder: null, solarKey: key, nearmapKey: null, vicmapBuildings: null }, http: defaultProviderHttp, referenceDate: melbourneToday() } }, defaultFetchJson);
    const c = g.checks.find((x) => x.source_key === "google_solar");
    return { configured: true, status: c?.status ?? "unknown", detail: c?.error ?? null, http_status: c?.http_status ?? null, latency_ms: c?.latency_ms ?? null,
      summary: (() => { const v = g.facts.find((f) => f.key === "solar_summary")?.value; return v ? JSON.stringify(v) : null; })() };
  });

export const floorplanLink = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: fp } = await supabaseAdmin.from("property_floorplans").select("storage_path, storage_policy").eq("id", data.id).single();
    if (!fp?.storage_path || fp.storage_policy !== "store_permitted") throw new WorkflowError("This floor plan is not stored in the portal – the licence setting does not permit copying.");
    const { data: s } = await signFile("job-files", fp.storage_path, 300);
    return { url: s?.signedUrl ?? null };
  });

// ---------- ESC pre-install notification + PIESA delivery ----------
export const getInstallReadiness = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["admin", "installer", "electrician"]);
    const { installReadiness } = await import("./esc.server");
    return installReadiness(data.jobId);
  });

export const recordPiesaDelivery = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, recipient: z.enum(["owner", "installer"]), deliveredAt: z.string().datetime({ offset: true }), method: z.enum(["portal", "email", "in_person", "post"]), documentId: uuid.optional(), notes: z.string().max(1000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["admin", "electrician"]);
    await (await import("./job-records.server")).recordPiesaCopyDelivery({ ...data, actorId: context.userId });
    return { ok: true };
  });

export const regenerateEscNotificationFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, coesNumber: z.string().trim().max(60).optional(), recNumber: z.string().trim().max(60).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { regenerateEscNotification } = await import("./esc.server");
    const extra: Record<string, string> = {};
    if (data.coesNumber) extra["coes_number"] = data.coesNumber;
    if (data.recNumber) extra["rec_number"] = data.recNumber;
    return { id: await regenerateEscNotification(data.jobId, context.userId, extra) };
  });

export const submitEscNotification = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ notificationId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { submitEscViaAdapter } = await import("./esc.server");
    await submitEscViaAdapter(data.notificationId, context.userId);
    return { ok: true };
  });

export const recordEscSubmissionFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ notificationId: uuid, reference: z.string().trim().min(3).max(200), sentAt: z.string().datetime({ offset: true }), method: z.enum(["manual_portal", "manual_email"]), confirmed: z.literal(true) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { recordEscSubmission } = await import("./esc.server");
    await recordEscSubmission({ ...data, actorId: context.userId });
    return { ok: true };
  });

export const addEscConfig = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ version: z.string().trim().min(1).max(50), fields: z.array(z.object({ key: z.string().regex(/^[a-z0-9_]{2,60}$/), label: z.string().trim().min(2).max(200) })).max(50), source_note: z.string().trim().min(5).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    await admin.from("esc_notification_config").insert({ version: data.version, required_fields: data.fields, source_note: data.source_note, created_by: context.userId });
    return { ok: true };
  });

export const approveEscConfig = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    await admin.from("esc_notification_config").update({ is_active: false }).eq("is_active", true);
    await admin.from("esc_notification_config").update({ approved: true, approved_by: context.userId, approved_at: new Date().toISOString(), is_active: true }).eq("id", data.id);
    return { ok: true };
  });

// ---------- Activity 48 office compliance records (permanent; gate stage entry) ----------
const RECORD_KEYS = ["life_support_plan", "assignment_copy_to_consumer", "installer_safety_assessment", "pre_install_consumer_docs", "co_payment_paid", "completion_consumer_docs"] as const;
export const listComplianceRecords = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { data: rows } = await admin.from("job_compliance_records").select("*").eq("job_id", data.jobId).order("created_at", { ascending: false });
    return rows ?? [];
  });
export const recordComplianceItem = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, key: z.enum(RECORD_KEYS), occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reference: z.string().trim().max(200).nullable(), notes: z.string().trim().max(1000).nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    if (data.occurredAt > melbourneToday()) throw new WorkflowError("Date cannot be in the future.");
    await (await import("./job-records.server")).recordComplianceRecord({ ...data, actorId: context.userId });
    await autoAdvanceJob(data.jobId, context.userId, "compliance record");
    return { ok: true };
  });

// ---------- Xero organisation display + Demo Company test payment ----------
export const getXeroConnection = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context.supabase);
    const { xeroConnectionStatus } = await import("./xero.server");
    const { describeXeroRouting } = await import("./xero.core");
    try { return { ...(await xeroConnectionStatus()), error: null as string | null }; }
    catch (e) { return { configured: Boolean(process.env["LOVABLE_API_KEY"] && process.env["XERO_API_KEY"]), connected: false, checkedAt: new Date().toISOString(), routing: describeXeroRouting([]), orgs: [] as { name: string; test: boolean }[], error: e instanceof Error ? e.message : "The Xero connection could not be checked." }; }
  });

export const recordXeroTestPayment = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ invoiceId: uuid, amount: z.number().positive().max(100000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { recordDemoTestPayment } = await import("./xero.server");
    try { await recordDemoTestPayment(data.invoiceId, data.amount, context.userId); } catch (e) { throw new WorkflowError((e as Error).message); }
    const { data: inv } = await admin.from("invoices").select("job_id").eq("id", data.invoiceId).single();
    if (inv) await advanceAfterDeposit(inv.job_id, context.userId);
    return { ok: true };
  });

/** Office job page: the installer's own price, what it includes and whether he already did the site check. */
export const getInstallerJobFacts = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { data: j, error } = await admin.from("jobs").select("channel, installer_quoted, installer_site_check, installer_site_check_date, installer_quoted_price_inc_gst, installer_price_includes").eq("id", data.jobId).single();
    if (error || !j) throw new Error(`Could not load the installer's details: ${error?.message ?? "job not found"}`);
    if (j.channel !== "installer_sourced") return null;
    return { quoted: j.installer_quoted as "yes" | "no" | null, site_check: j.installer_site_check as "yes" | "no" | null, site_check_date: j.installer_site_check_date, quoted_price_inc_gst: j.installer_quoted_price_inc_gst == null ? null : Number(j.installer_quoted_price_inc_gst), price_includes: j.installer_price_includes };
  });

/** Partner job page: the installer answers "Quoted? Yes / No" (business owner of the originating installer only). */
export const answerInstallerQuoted = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, answer: z.enum(["yes", "no"]), price: z.number().positive().max(1_000_000).nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: j } = await admin.from("jobs").select("channel, originating_installer_business_id, installer_quoted, next_action").eq("id", data.jobId).maybeSingle();
    if (!j || j.channel !== "installer_sourced" || !j.originating_installer_business_id) throw new WorkflowError("This job isn't one of your uploaded jobs.");
    const { requireMember } = await import("./pilot.server");
    await requireMember(context.userId, j.originating_installer_business_id, true);
    const { planQuotedAnswer } = await import("./bulk-import.core");
    const plan = planQuotedAnswer(j.installer_quoted as "yes" | "no" | null, data.answer, data.price, j.next_action);
    if ("error" in plan) throw new WorkflowError(plan.error);
    const { data: done, error } = await admin.from("jobs").update(plan.patch).eq("id", data.jobId).or("installer_quoted.is.null,installer_quoted.eq.no").select("id").maybeSingle();
    if (error) throw new Error(`Could not save your answer: ${error.message}`);
    if (!done) throw new WorkflowError("You've already answered this.");
    await logEvent(data.jobId, context.userId, "installer_quoted_answer", data.answer === "yes" ? `Installer quoted $${plan.patch.installer_quoted_price_inc_gst} inc GST` : "Installer has not quoted — quote needed from installer", { answer: data.answer, price: plan.patch.installer_quoted_price_inc_gst });
    return { ok: true };
  });

/** Partner job page: their own site check answer and quoted price (RLS: only jobs they can already see). */
export const getMyInstallerJobFacts = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: j } = await context.supabase.from("jobs").select("channel, installer_quoted, installer_site_check, installer_site_check_date, installer_quoted_price_inc_gst, installer_price_includes").eq("id", data.jobId).maybeSingle();
    if (!j || j.channel !== "installer_sourced") return null;
    return { quoted: j.installer_quoted as "yes" | "no" | null, site_check: j.installer_site_check as "yes" | "no" | null, site_check_date: j.installer_site_check_date, quoted_price_inc_gst: j.installer_quoted_price_inc_gst == null ? null : Number(j.installer_quoted_price_inc_gst), price_includes: j.installer_price_includes };
  });
