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
import { applyPaidAmount, clearInstallDueDate, createInvoiceForQuote, requireHivicInvoice, requireHivicJob, setInstallDueDate, syncInvoiceFromXero } from "./xero.server";
import { buildDepositOverride, depositRequestPatch } from "./invoice.lifecycle";
import { commercialBlocker, depositCleared } from "./workflow.server";
import { assertAgreementCanSign, assignmentEffective, buildAcceptancePackage, currentAgreement, currentAssignment, currentInstallerDeclaration, loadTemplates, prepareFinalAssignment, raiseVariation, reconfirmVariation, signCustomerAgreement, signFinalAssignment, signInstallerDecl } from "./assignment.server";
import { ASSIGNMENT_EVENTS, parseFormFields, prefillRows, setupStatus, templateBlockers, type TemplateKey } from "./assignment.core";
import { consentValidityBlockers } from "./consent.core";
import { autoAdvanceJob, autoAdvanceOpenJobs } from "./autoadvance.server";
import { acceptAuthority, declineAuthority, markViewed, requestAuthority, revokeAuthority, sweepAuthorityExpiry } from "./authority.server";

const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as never;

const uuid = z.string().uuid();

// ---------- Gate 1 ----------
export const createEnquiry = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => enquirySchema.parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    return upsertEnquiry(data, "portal", context.userId);
  });

export const setEligibility = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ jobId: uuid, outcome: z.enum(["likely_eligible", "needs_onsite_confirmation", "does_not_appear_eligible"]), reason: z.string().trim().min(3).max(2000), nextAction: z.string().trim().min(2).max(300) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { AUTO_FAIL_HOLD_PREFIX } = await import("./eligibility.server");
    const { data: before } = await admin.from("jobs").select("stage, prior_stage, hold_reason, eligibility_outcome, eligibility_decision_source, eligibility_decision_rules").eq("id", data.jobId).single();
    if (!before) throw new WorkflowError("Job not found");
    // Admin correction of a system auto-fail: release the automatic hold back to Gate 1.
    if (before.stage === "on_hold" && before.hold_reason?.startsWith(AUTO_FAIL_HOLD_PREFIX)) {
      await admin.from("jobs").update({ stage: before.prior_stage ?? "eligibility_review", prior_stage: null, hold_reason: null }).eq("id", data.jobId);
      await logEvent(data.jobId, context.userId, "stage_changed", "Auto-fail hold released by admin for Gate 1 correction", { reason: data.reason }, { from: "on_hold", to: before.prior_stage ?? "eligibility_review" });
    }
    let stage = await getStage(data.jobId);
    await admin.from("jobs").update({ eligibility_outcome: data.outcome, eligibility_reason: data.reason, next_action: data.nextAction, eligibility_set_by: context.userId, eligibility_set_at: new Date().toISOString(), eligibility_decision_source: "admin" }).eq("id", data.jobId);
    const overriding = before.eligibility_decision_source === "system";
    await logEvent(data.jobId, context.userId, overriding ? "eligibility_override" : "eligibility_set", `${overriding ? "Admin override of system Gate 1 decision" : "Eligibility"}: ${data.outcome.replaceAll("_", " ")}`, { reason: data.reason, next_action: data.nextAction, previous_outcome: before.eligibility_outcome, previous_source: before.eligibility_decision_source, previous_rules: before.eligibility_decision_rules });
    if (data.outcome === "does_not_appear_eligible" && stage === "awaiting_electrician") {
      await transition(data.jobId, "eligibility_review", context.userId, "Admin corrected Gate 1 – back to eligibility review", { reason: data.reason }, { nextAction: data.nextAction });
      stage = "eligibility_review";
    }
    if (data.outcome !== "does_not_appear_eligible" && (stage === "new_enquiry" || stage === "eligibility_review")) {
      await transition(data.jobId, "awaiting_electrician", context.userId, "Eligibility passed – awaiting electrician", {}, { nextAction: data.nextAction });
      // Owner Authority is no longer requested before assessment; acceptance happens at quote acceptance.
    } else if (stage === "new_enquiry") {
      await transition(data.jobId, "eligibility_review", context.userId, "Moved to eligibility review", {}, { nextAction: data.nextAction });
    }
    await admin.from("compliance_checks").update({ status: data.outcome === "does_not_appear_eligible" ? "fail" : data.outcome === "likely_eligible" ? "pass" : "pending", checked_by: context.userId, checked_at: new Date().toISOString(), notes: data.reason }).eq("job_id", data.jobId).eq("check_key", "eligibility");
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
      throw new WorkflowError("Your account isn't linked to an approved EEC installer business yet. Ask HI VIC to set this up.");
    const res = await upsertEnquiry(data, "installer_portal", context.userId, { channel: "installer_sourced", businessId: prof.business_id, userId: context.userId });
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
    if (j.channel !== "installer_sourced") throw new WorkflowError("HI VIC-sourced jobs always use HI VIC invoicing.");
    const { count } = await admin.from("invoices").select("id", { count: "exact", head: true }).eq("job_id", data.jobId);
    if (count) throw new WorkflowError("An invoice already exists – the invoice route can no longer change.");
    await admin.from("jobs").update({ commercial_model: data.model, commercial_model_set_by: context.userId, commercial_model_set_at: new Date().toISOString() }).eq("id", data.jobId);
    await logEvent(data.jobId, context.userId, "commercial_model_set", `Invoice route set: ${data.model.replaceAll("_", " ")}`, { before: j.commercial_model, after: data.model, reason: data.reason });
    return { ok: true };
  });

// ---------- Assignments / users ----------
export const assignContractor = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, userId: uuid, role: z.enum(["electrician", "installer"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { data: hasRole } = await admin.from("user_roles").select("id").eq("user_id", data.userId).eq("role", data.role).maybeSingle();
    if (!hasRole) throw new WorkflowError(`User does not hold the ${data.role} role.`);
    const { data: prof } = await admin.from("profiles").select("full_name, business_id").eq("id", data.userId).single();
    await admin.from("job_assignments").update({ active: false, ended_at: new Date().toISOString(), end_reason: "reassigned" }).eq("job_id", data.jobId).eq("role", data.role).eq("active", true);
    await admin.from("job_assignments").insert({ job_id: data.jobId, user_id: data.userId, role: data.role, business_id: prof?.business_id ?? null, assigned_by: context.userId });
    await admin.from("reassignment_requests").update({ status: "actioned", resolved_by: context.userId, resolved_at: new Date().toISOString() }).eq("job_id", data.jobId).eq("role", data.role).eq("status", "open");
    const { data: src } = await admin.from("jobs").select("channel, originating_installer_user_id").eq("id", data.jobId).single();
    const awayFromOrigin = data.role === "installer" && src?.channel === "installer_sourced" && src.originating_installer_user_id !== data.userId;
    await logEvent(data.jobId, context.userId, "contractor_assigned", `${data.role === "electrician" ? "Electrician" : "Installer"} assigned: ${prof?.full_name ?? "user"}${awayFromOrigin ? " (admin reassignment away from originating installer – attribution unchanged)" : ""}`);
    if (data.role === "electrician" && (await getStage(data.jobId)) === "awaiting_electrician")
      await transition(data.jobId, "assessment_booking", context.userId, "Electrician assigned – booking measure-up");
    await autoAdvanceJob(data.jobId, context.userId, "contractor assigned");
    return { ok: true };
  });

export const setUserRole = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ userId: uuid, role: z.enum(["admin", "electrician", "installer", "owner", "property_manager"]), grant: z.boolean() }).parse(d))
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

const SITE_STAGES = ["assessment_booking", "assessment_booked"];
const MEASURE_EVIDENCE = ["measurement", "existing_insulation_r_value"];

export const saveAssessment = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, patch: assessmentPatch }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["admin", "electrician"]);
    const { data: existing } = await admin.from("assessments").select("id,status").eq("job_id", data.jobId).maybeSingle();
    if (existing?.status === "complete") throw new WorkflowError("Assessment is complete and locked. Ask HI VIC to reopen.");
    if (existing) await admin.from("assessments").update(clean(data.patch)).eq("id", existing.id);
    else await admin.from("assessments").insert(clean({ ...data.patch, job_id: data.jobId, assessor_id: context.userId }));
    return { ok: true, savedAt: new Date().toISOString() };
  });

/** Current derived visit scope (the ONE derivation, server-side). */
export const getJobScope = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["admin", "electrician", "installer", "owner"]);
    const { jobScope } = await import("./requirements.server");
    const { measurementRow: _m, ...s } = await jobScope(data.jobId);
    return s;
  });

export const saveMeasurement = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, patch: measurementPatch }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await requireJobRole(context.supabase, data.jobId, ["admin", "electrician", "installer"]);
    if (!SITE_STAGES.includes(await getStage(data.jobId))) throw new WorkflowError("Measure-up can only be recorded during assessment booking.");
    const { jobScope } = await import("./requirements.server");
    const { planMeasurementUpdate } = await import("./scope.core");
    const s = await jobScope(data.jobId);
    if (role === "installer" && !s.installerTasks.includes("measure_up")) throw new WorkflowError("Measure-up is not assigned to the installer on this job.");
    if (role === "electrician" && !s.electricianTasks.some((t) => t !== "electrical")) throw new WorkflowError("The accepted measure-up is read-only. Use \"Measurement needs review\" if it looks wrong.");
    const source = role === "admin" ? "admin_import" : role === "installer" ? "installer" : "electrician";
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
  if (miss.length) throw new WorkflowError(`Upload measure-up evidence first: ${miss.join(", ")}`);
}

/** Complete the ceiling measure-up requirement (installer / electrician in scope, or admin). */
export const completeMeasurement = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await requireJobRole(context.supabase, data.jobId, ["admin", "electrician", "installer"]);
    if (!SITE_STAGES.includes(await getStage(data.jobId))) throw new WorkflowError("Measure-up can only be completed during assessment booking.");
    const { jobScope, advanceSiteRequirements } = await import("./requirements.server");
    const { missingMeasureFields, MEASURE_FIELD_LABEL } = await import("./scope.core");
    const s = await jobScope(data.jobId);
    if (role === "installer" && !s.installerTasks.includes("measure_up")) throw new WorkflowError("Measure-up is not assigned to the installer on this job.");
    if (role === "electrician" && !s.electricianTasks.some((t) => t !== "electrical")) throw new WorkflowError("Measure-up is not part of your scope on this job.");
    const m = s.measurementRow;
    if (!m) throw new WorkflowError("Enter the measure-up first.");
    if (m.status === "complete") throw new WorkflowError("Measure-up is already accepted.");
    const miss = missingMeasureFields(m as never);
    if (miss.length) throw new WorkflowError(`Still needed: ${miss.map((f) => MEASURE_FIELD_LABEL[f]).join(", ")}`);
    await requireMeasureEvidence(data.jobId);
    const own = m.source_role === (role === "admin" ? "admin_import" : role);
    await admin.from("ceiling_measurements").update({
      status: "complete", review_flags: [], completed_at: new Date().toISOString(),
      ...(own || !m.completed_by ? { completed_by: m.completed_by ?? context.userId } : {}),
      ...(role === "admin" ? { reviewed_by: context.userId, reviewed_at: new Date().toISOString() } : {}),
    }).eq("id", m.id);
    await logEvent(data.jobId, context.userId, "measurement_completed", `Ceiling measure-up completed (${m.source_role}${own ? "" : `, completed by ${role}`}) – ${Number(m.measured_area_m2)} m²`, { measurement_id: m.id, source_role: m.source_role, supplemented_fields: m.supplemented_fields });
    const res = await advanceSiteRequirements(data.jobId, context.userId);
    await autoAdvanceJob(data.jobId, context.userId, "measure-up completed");
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
    if (!m) throw new WorkflowError("No measure-up to flag.");
    const at = new Date().toISOString();
    const flags = [...((m.review_flags as unknown[]) ?? []), ...(data.fields.length ? data.fields : ["measured_area_m2"]).map((field) => ({ field, reason: data.reason, by: context.userId, at }))];
    await admin.from("ceiling_measurements").update({ status: "needs_review", review_flags: flags as never, review_reason: data.reason }).eq("id", m.id);
    await logEvent(data.jobId, context.userId, "measurement_flagged", `Measure-up flagged for review: ${data.reason}`, { measurement_id: m.id, fields: data.fields, previous_status: m.status });
    return { ok: true };
  });

export const reviewMeasurement = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, action: z.enum(["accept", "needs_review", "reject"]), reason: z.string().trim().min(3).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { currentMeasurement, advanceSiteRequirements } = await import("./requirements.server");
    const { missingMeasureFields, MEASURE_FIELD_LABEL } = await import("./scope.core");
    const m = await currentMeasurement(data.jobId);
    if (!m) throw new WorkflowError("No measure-up to review.");
    const at = new Date().toISOString();
    if (data.action === "accept") {
      const miss = missingMeasureFields(m as never);
      if (miss.length) throw new WorkflowError(`Cannot accept – missing: ${miss.map((f) => MEASURE_FIELD_LABEL[f]).join(", ")}`);
      await admin.from("ceiling_measurements").update({ status: "complete", review_flags: [], review_reason: data.reason, reviewed_by: context.userId, reviewed_at: at, completed_at: m.completed_at ?? at }).eq("id", m.id);
    } else if (data.action === "needs_review") {
      await admin.from("ceiling_measurements").update({ status: "needs_review", review_reason: data.reason, reviewed_by: context.userId, reviewed_at: at }).eq("id", m.id);
    } else {
      await admin.from("ceiling_measurements").update({ status: "rejected", is_current: false, review_reason: data.reason, reviewed_by: context.userId, reviewed_at: at }).eq("id", m.id);
    }
    await logEvent(data.jobId, context.userId, "measurement_reviewed", `Measure-up ${data.action.replace("_", " ")}: ${data.reason}`, { measurement_id: m.id, previous_status: m.status });
    if (data.action === "accept" && SITE_STAGES.includes(await getStage(data.jobId))) await advanceSiteRequirements(data.jobId, context.userId);
    return { ok: true };
  });

export const setMeasureUpResponsibility = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, by: z.enum(["electrician", "installer"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    await admin.from("jobs").update({ measure_up_responsibility: data.by }).eq("id", data.jobId);
    await logEvent(data.jobId, context.userId, "measure_up_responsibility_set", `Measure-up assigned to ${data.by}`);
    return { ok: true };
  });

export const addOtherRectItem = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, description: z.string().trim().min(2).max(300), quantity: z.number().positive().max(1000), unitPriceIncGst: z.number().min(0).max(100000), explanation: z.string().trim().min(5).max(2000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["admin", "electrician"]);
    const stage = await getStage(data.jobId);
    if (!["assessment_booked", "assessment_booking", "assessment_complete", "rectification_required", "awaiting_owner_rectification_approval"].includes(stage))
      throw new WorkflowError("Other items can only be added before the owner approves rectification.");
    await admin.from("rectification_items").insert({ job_id: data.jobId, description: data.description, quantity: data.quantity, is_other: true, other_unit_price_inc_gst: data.unitPriceIncGst, explanation: data.explanation, added_by: context.userId });
    await logEvent(data.jobId, context.userId, "rectification_other_added", `Other rectification item added: ${data.description}`, { explanation: data.explanation });
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
    const { createAssignMittiAudit } = await import("./mitti.server");
    return createAssignMittiAudit(data.jobId, context.userId);
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

/** Complete the ELECTRICAL / PIESA requirement. In combined / completion scopes the electrician's measure-up is completed too. */
export const completeAssessment = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["admin", "electrician"]);
    const { data: a } = await admin.from("assessments").select("*").eq("job_id", data.jobId).maybeSingle();
    if (!a) throw new WorkflowError("Start the assessment first.");
    if (a.status === "complete") throw new WorkflowError("Electrical assessment is already complete.");
    const { jobScope, advanceSiteRequirements } = await import("./requirements.server");
    const { missingMeasureFields, MEASURE_FIELD_LABEL } = await import("./scope.core");
    const s = await jobScope(data.jobId);
    const doMeasure = s.electricianTasks.some((t) => t !== "electrical");
    const missing: string[] = [];
    if (doMeasure) missing.push(...missingMeasureFields(s.measurementRow as never).map((f) => MEASURE_FIELD_LABEL[f]));
    if (!a.switchboard_condition) missing.push("switchboard condition");
    if (a.rcds_present == null) missing.push("RCDs present");
    if (a.life_support_confirmed == null) missing.push("life support confirmation");
    if (a.piesa_outcome === "pending") missing.push("PIESA outcome");
    if (!a.assessed_on) missing.push("assessment date");
    if (missing.length) throw new WorkflowError(`Still needed: ${missing.join(", ")}`);
    const { data: ev } = await admin.from("evidence_requirements").select("label,status,gate,category").eq("job_id", data.jobId).eq("required", true);
    // Measure-up evidence only when this visit completes the measure-up; PIESA sign-off when PIESA passed on this visit.
    const evMissing = (ev ?? [])
      .filter((e) => (doMeasure && MEASURE_EVIDENCE.includes(e.category)) || (a.piesa_outcome === "pass" && e.category === "piesa_signoff"))
      .filter((e) => !["uploaded", "verified"].includes(e.status)).map((e) => e.label);
    if (evMissing.length) throw new WorkflowError(`Upload evidence first: ${evMissing.join(", ")}`);
    const { data: unpriced } = await admin.from("rectification_items").select("description").eq("job_id", data.jobId).eq("status", "required").eq("needs_office_pricing", true);
    if (unpriced?.length) throw new WorkflowError(`HI VIC must price these items first: ${unpriced.map((u) => u.description).join(", ")}`);

    const stage = await getStage(data.jobId);
    if (stage !== "assessment_booked") throw new WorkflowError(`Assessment can be completed from "Assessment Booked" (current: ${STAGE_LABEL[stage]}).`);
    const now = new Date().toISOString();
    await admin.from("assessments").update({ status: "complete", completed_at: now, assessor_id: a.assessor_id ?? context.userId, mitti_sync_status: a.external_mitti_id ? "synced" : "not_synced" }).eq("id", a.id);
    await admin.from("piesa_records").update({ is_current: false }).eq("job_id", data.jobId).eq("is_current", true);
    await admin.from("piesa_records").insert({ job_id: data.jobId, assessment_id: a.id, kind: "initial", outcome: a.piesa_outcome, completed_date: a.assessed_on!, signed_off_by: context.userId, external_mitti_id: a.external_mitti_id });
    await logEvent(data.jobId, context.userId, "electrical_assessment_complete", `Electrical assessment complete – PIESA ${a.piesa_outcome} (${s.label})`, { scope: s.scope });
    const m = s.measurementRow;
    if (doMeasure && m && m.status !== "complete") {
      await admin.from("ceiling_measurements").update({ status: "complete", review_flags: [], completed_at: now, completed_by: m.completed_by ?? (m.source_role === "electrician" ? context.userId : null) }).eq("id", m.id);
      await logEvent(data.jobId, context.userId, "measurement_completed", `Ceiling measure-up completed onsite by electrician (${m.source_role} record) – ${Number(m.measured_area_m2)} m²`, { measurement_id: m.id, source_role: m.source_role, supplemented_fields: m.supplemented_fields });
    }
    const res = await advanceSiteRequirements(data.jobId, context.userId);
    await autoAdvanceJob(data.jobId, context.userId, "assessment completed");
    return res;
  });

/** Rectification complete + new PIESA; also the reassessment path when the 30-day window expired. */
export const recordPiesa = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, kind: z.enum(["post_rectification", "reassessment"]), outcome: z.enum(["pass", "fail"]), completedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), notes: z.string().max(2000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["admin", "electrician"]);
    if (new Date(data.completedDate) > new Date()) throw new WorkflowError("PIESA date cannot be in the future.");
    const stage = await getStage(data.jobId);
    if (data.kind === "post_rectification") {
      if (stage !== "rectification_booked") throw new WorkflowError("Rectification must be booked first.");
      const { data: ev } = await admin.from("evidence_requirements").select("status").eq("job_id", data.jobId).eq("category", "rectification_completion").single();
      if (ev && !["uploaded", "verified"].includes(ev.status)) throw new WorkflowError("Upload rectification completion evidence first.");
      if (data.outcome === "pass") {
        const { data: ps } = await admin.from("evidence_requirements").select("status").eq("job_id", data.jobId).eq("category", "piesa_signoff").single();
        if (ps && !["uploaded", "verified"].includes(ps.status)) throw new WorkflowError("Upload the PIESA / electrical safety sign-off first.");
      }
      await admin.from("rectification_items").update({ status: "completed" }).eq("job_id", data.jobId).eq("status", "required");
    } else {
      const p = await piesaStatus(data.jobId);
      if (!p?.piesa_expired && stage !== "assessment_complete") throw new WorkflowError("Reassessment is only needed when the PIESA window has expired.");
    }
    await admin.from("piesa_records").update({ is_current: false }).eq("job_id", data.jobId).eq("is_current", true);
    await admin.from("piesa_records").insert({ job_id: data.jobId, kind: data.kind, outcome: data.outcome, completed_date: data.completedDate, signed_off_by: context.userId, notes: data.notes ?? null });
    await logEvent(data.jobId, context.userId, "piesa_recorded", `PIESA (${data.kind.replace("_", " ")}) ${data.outcome} on ${data.completedDate}`);
    if (data.kind === "post_rectification" && data.outcome === "pass") {
      await admin.from("compliance_checks").update({ status: "pass", checked_at: new Date().toISOString() }).eq("job_id", data.jobId).in("check_key", ["rectification", "electrical_assessment"]);
      await admin.from("bookings").update({ status: "completed" }).eq("job_id", data.jobId).eq("kind", "rectification").eq("status", "confirmed");
      await transition(data.jobId, "installation_scheduling", context.userId, "Rectification complete, PIESA passed – installation scheduling unlocked");
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
    if (!["ready_for_installer_quotes", "awaiting_quote_acceptance"].includes(stage)) throw new WorkflowError("Quotes can only be generated once the job is Ready for Installer Quotes.");
    // Check the gates BEFORE issuing quotes so none are issued to the owner while the job is blocked.
    const pre = (await stageEntryBlockers(data.jobId, "awaiting_quote_acceptance")).filter((b) => b !== "No installation quotes issued.");
    if (pre.length) throw new WorkflowError(`Blocked: ${pre.join(" • ")}`);
    await genInstaller(data.jobId, context.userId);
    { const { applyCobrand } = await import("./pilot.server"); await applyCobrand(data.jobId); }
    if (stage === "ready_for_installer_quotes") await transition(data.jobId, "awaiting_quote_acceptance", context.userId, "Installation quotes issued to owner");
    await autoAdvanceJob(data.jobId, context.userId, "quotes generated");
    return { ok: true };
  });

export const regenerateRectificationQuote = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const stage = await getStage(data.jobId);
    await generateRectificationQuote(data.jobId, context.userId);
    if (stage === "rectification_required") await transition(data.jobId, "awaiting_owner_rectification_approval", context.userId, "Rectification quote issued to owner");
    return { ok: true };
  });

export const adjustQuote = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ quoteId: uuid, reason: z.string().trim().min(5).max(1000), items: z.array(z.object({ id: uuid, quantity: z.number().min(0), unit_price_inc_gst: z.number().min(0) })), veecDiscount: z.number().min(0).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    await adjustQuoteImpl(data.quoteId, context.userId, data.reason, data.items, data.veecDiscount);
    return { ok: true };
  });

export const respondToQuote = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth, withRequestMeta])
  .inputValidator((d) => z.object({
    quoteId: uuid, accept: z.boolean(), consent: z.boolean().optional(), reason: z.string().max(1000).optional(),
    signing: z.object({
      signatoryName: z.string().trim().min(2).max(200), authorityType: z.enum(["owner", "authorised_representative"]), over18: z.boolean(),
      readConsumerInfo: z.boolean(), acceptAgreement: z.boolean(), signatureName: z.string().trim().max(200),
      assistance: z.enum(["none", "interpreter", "support_understanding", "both"]),
    }).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: q } = await admin.from("quotes").select("*").eq("id", data.quoteId).single();
    if (!q) throw new WorkflowError("Quote not found");
    await requireJobRole(context.supabase, q.job_id, ["owner", "admin"]);
    if (q.status !== "issued") throw new WorkflowError("This quote is no longer open.");
    if (data.accept && !data.consent) throw new WorkflowError("Please confirm to proceed.");
    const stage = await getStage(q.job_id);
    const expected: Stage = q.kind === "rectification" ? "awaiting_owner_rectification_approval" : "awaiting_quote_acceptance";
    if (stage !== expected) throw new WorkflowError("This quote can't be actioned at the current stage.");
    if (!data.accept) {
      await admin.from("quotes").update({ status: "declined" }).eq("id", q.id);
      await logEvent(q.job_id, context.userId, "quote_declined", `${q.option_label} declined`, { reason: data.reason });
      return { ok: true };
    }
    // Installation acceptance = Customer Agreement / Quote Acceptance (commercial only). It is NOT the VEEC
    // assignment and NOT the ESC consent – those are separate later records.
    if (q.kind === "installation") {
      if (!data.signing) throw new WorkflowError("The customer must review and sign the customer agreement to accept this quote.");
      const { data: isOwner } = await context.supabase.rpc("is_job_owner", { _job: q.job_id, _user: context.userId });
      if (!isOwner) throw new WorkflowError("Only the customer can sign the agreement.");
      const { assistance: _a, ...chk } = data.signing;
      await assertAgreementCanSign(chk);
    }
    // All gates are checked BEFORE the quote is marked accepted, so a blocked acceptance leaves nothing half-done.
    if (q.kind === "installation") {
      const cb = await commercialBlocker(q.job_id);
      if (cb) throw new WorkflowError(`Blocked: ${cb}`);
      const p = await piesaStatus(q.job_id);
      const { count: rect } = await admin.from("rectification_items").select("id", { count: "exact", head: true }).eq("job_id", q.job_id).eq("status", "required");
      if (!rect && p?.piesa_expired) throw new WorkflowError("The electrical safety assessment has expired. HI VIC will arrange a reassessment.");
    }
    if (q.kind === "installation" && data.signing) {
      const { assistance, ...input } = data.signing;
      await signCustomerAgreement({ quoteId: q.id, actorId: context.userId, input, assistance, ip: context.ip, userAgent: context.userAgent });
    }
    await admin.from("quotes").update({ status: "accepted", accepted_at: new Date().toISOString(), accepted_by: context.userId }).eq("id", q.id);
    await admin.from("quotes").update({ status: "superseded" }).eq("job_id", q.job_id).eq("kind", q.kind).eq("status", "issued");

    if (q.kind === "rectification") {
      // Scope approval only – no invoice. The rectification lines are folded into the final installation quote.
      await logEvent(q.job_id, context.userId, "rectification_scope_approved", `Owner approved rectification scope (${q.customer_total_inc_gst} inc GST)`, { quote_id: q.id });
      await transition(q.job_id, "ready_for_installer_quotes", context.userId, "Rectification scope approved – preparing final installation quotes");
      await genInstaller(q.job_id, context.userId);
      { const { applyCobrand } = await import("./pilot.server"); await applyCobrand(q.job_id); }
      await transition(q.job_id, "awaiting_quote_acceptance", context.userId, "Final installation quotes (incl. rectification) issued to owner");
      await autoAdvanceJob(q.job_id, context.userId, "rectification approved");
      return { ok: true };
    }

    await admin.from("declarations").upsert({ job_id: q.job_id, kind: "owner_consent", declared_by: context.userId, statement: `Owner accepted ${q.option_label} (${q.customer_total_inc_gst} inc GST): 50% deposit due now, balance due on installation day.` }, { onConflict: "job_id,kind" });
    await admin.from("compliance_checks").update({ status: "pass", checked_at: new Date().toISOString() }).eq("job_id", q.job_id).eq("check_key", "owner_consent");
    await logEvent(q.job_id, context.userId, ASSIGNMENT_EVENTS.QUOTE_ACCEPTED, `${q.option_label} accepted with signed Customer Agreement / Quote Acceptance`, { quote_id: q.id, total_inc_gst: q.customer_total_inc_gst });
    await transition(q.job_id, "awaiting_deposit_payment", context.userId, "Owner accepted final installation quote – 50% deposit due");
    await createInvoiceForQuote(q.id, context.userId);
    await advanceAfterDeposit(q.job_id, context.userId);
    return { ok: true };
  });

// ---------- Payments (Xero mirror + gates) ----------
/** Deposit routing now lives in the central auto-advance helper (never bypasses blockers). */
async function advanceAfterDeposit(jobId: string, actorId: string) {
  if ((await getStage(jobId)) === "awaiting_deposit_payment" && (await depositCleared(jobId)))
    await logEvent(jobId, actorId, ASSIGNMENT_EVENTS.DEPOSIT_PAID, "50% deposit confirmed – scheduling can unlock");
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
    const { data: inv } = await admin.from("invoices").select("id, job_id, status, deposit_paid_at, total_paid").eq("id", data.invoiceId).single();
    if (!inv) throw new WorkflowError("Invoice not found");
    let ov;
    try { ov = buildDepositOverride(inv as never, data.reason, context.userId, await getStage(inv.job_id)); } catch (e) { throw new WorkflowError((e as Error).message); }
    await admin.from("payment_overrides").insert(ov as never);
    await logEvent(inv.job_id, context.userId, "payment_override", `Deposit gate overridden by admin: ${ov.reason}`, { invoice_id: data.invoiceId, before: ov.before_state, after: ov.after_state });
    await advanceAfterDeposit(inv.job_id, context.userId);
    return { ok: true };
  });

/** Admin records that the native Xero 50% deposit request was raised in Xero. Audited; never unlocks scheduling. */
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
    await logEvent(inv.job_id, context.userId, "payment_simulated", `Simulated Xero payment total ${data.amountPaid} (testing)`, {}, { internal: true });
    await applyPaidAmount(data.invoiceId, data.amountPaid, context.userId);
    await advanceAfterDeposit(inv.job_id, context.userId);
    return { ok: true };
  });

// ---------- Gate 4: bookings ----------
export const createBooking = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, kind: z.enum(["assessment", "rectification", "installation"]), start: z.string().datetime({ offset: true }), notes: z.string().max(1000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const need = data.kind === "installation" ? "installer" : "electrician";
    const role = await requireJobRole(context.supabase, data.jobId, ["admin", "owner", need]);
    const { confirmBooking } = await import("./booking.server");
    await confirmBooking(data.jobId, data.kind, data.start, context.userId, role, data.notes);
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
    await transition(data.jobId, "evidence_outstanding", context.userId, "Installation marked complete by installer");
    await admin.from("jobs").update({ installation_completed_at: new Date().toISOString() }).eq("id", data.jobId);
    await admin.from("bookings").update({ status: "completed" }).eq("job_id", data.jobId).eq("kind", "installation").eq("status", "confirmed");
    await logEvent(data.jobId, context.userId, ASSIGNMENT_EVENTS.INSTALLATION_COMPLETED, "Eligible installation undertaken");
    await autoAdvanceJob(data.jobId, context.userId, "installation completed");
    return { ok: true };
  });

export const submitDeclaration = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, kind: z.enum(["installer_declaration", "electrician_declaration"]), statement: z.string().trim().min(10).max(4000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["admin", data.kind === "installer_declaration" ? "installer" : "electrician"]);
    if (data.kind === "installer_declaration") throw new WorkflowError("Installer declarations are signed in the final VEEC assignment step (approved wording only).");
    await admin.from("declarations").upsert({ job_id: data.jobId, kind: data.kind, declared_by: context.userId, statement: data.statement, declared_at: new Date().toISOString() }, { onConflict: "job_id,kind" });
    await logEvent(data.jobId, context.userId, "declaration_submitted", `${data.kind.replace("_", " ")} signed`);
    await autoAdvanceJob(data.jobId, context.userId, "declaration signed");
    return { ok: true };
  });

export const submitForApReview = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["admin", "installer"]);
    await transition(data.jobId, "ap_review", context.userId, "Evidence submitted for AP review");
    return { ok: true };
  });

async function requirementWithAccess(sb: Parameters<typeof requireJobRole>[0], requirementId: string) {
  const { data: req } = await admin.from("evidence_requirements").select("*").eq("id", requirementId).single();
  if (!req) throw new WorkflowError("Requirement not found");
  const role = await requireJobRole(sb, req.job_id, ["admin", "electrician", "installer"]);
  // Measure-up evidence belongs to whoever owns the measure-up requirement (electrician or installer).
  const measureUp = ["measurement", "existing_insulation_r_value"].includes(req.category) && (role === "electrician" || role === "installer");
  if (role !== "admin" && !measureUp && req.responsible_role !== role) throw new WorkflowError("This evidence is uploaded by another party.");
  return req;
}

export const requestEvidenceUpload = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ requirementId: uuid, fileName: z.string().min(1).max(200), mimeType: z.string().max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const req = await requirementWithAccess(context.supabase, data.requirementId);
    if (!/^(image\/|video\/|application\/pdf)/.test(data.mimeType)) throw new WorkflowError("Only photos, videos and PDFs are accepted.");
    const safe = data.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${req.job_id}/${req.category}/${crypto.randomUUID()}-${safe}`;
    const { data: signed, error } = await admin.storage.from("job-files").createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Upload URL failed");
    return { path, token: signed.token };
  });

export const confirmEvidenceUpload = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ requirementId: uuid, path: z.string().min(5).max(500), fileName: z.string().max(200), mimeType: z.string().max(100), size: z.number().int().min(0) }).parse(d))
  .handler(async ({ data, context }) => {
    const req = await requirementWithAccess(context.supabase, data.requirementId);
    if (!data.path.startsWith(`${req.job_id}/${req.category}/`)) throw new WorkflowError("Invalid path");
    await admin.from("evidence_files").insert({ requirement_id: req.id, job_id: req.job_id, storage_path: data.path, file_name: data.fileName, mime_type: data.mimeType, size_bytes: data.size, uploaded_by: context.userId });
    await admin.from("evidence_requirements").update({ status: "uploaded", verified_by: null, verified_at: null }).eq("id", req.id);
    await logEvent(req.job_id, context.userId, "evidence_uploaded", `Evidence uploaded: ${req.label}`, { file: data.fileName });
    await autoAdvanceJob(req.job_id, context.userId, "evidence uploaded");
    return { ok: true };
  });

export const getEvidenceUrl = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ fileId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    // RLS-checked read proves the caller may see this file
    const { data: f } = await context.supabase.from("evidence_files").select("storage_path").eq("id", data.fileId).maybeSingle();
    if (!f) throw new WorkflowError("Not permitted");
    const { data: s, error } = await admin.storage.from("job-files").createSignedUrl(f.storage_path, 300);
    if (error || !s) throw new Error(error?.message);
    return { url: s.signedUrl };
  });

export const verifyEvidence = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ requirementId: uuid, status: z.enum(["verified", "rejected", "not_required", "outstanding"]), notes: z.string().max(2000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { data: req } = await admin.from("evidence_requirements").select("job_id,label").eq("id", data.requirementId).single();
    if (!req) throw new WorkflowError("Not found");
    await admin.from("evidence_requirements").update({ status: data.status, required: data.status === "not_required" ? false : true, verified_by: context.userId, verified_at: new Date().toISOString(), notes: data.notes ?? null }).eq("id", data.requirementId);
    await logEvent(req.job_id, context.userId, "evidence_reviewed", `Evidence ${data.status.replace("_", " ")}: ${req.label}`, { notes: data.notes });
    await autoAdvanceJob(req.job_id, context.userId, "evidence reviewed", { allowApPromotion: true });
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
    await autoAdvanceJob(data.jobId, context.userId, "compliance review", { allowApPromotion: true });
    return { ok: true };
  });

export const setComplianceCheck = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ checkId: uuid, status: z.enum(["pending", "pass", "fail"]), notes: z.string().max(2000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { data: c } = await admin.from("compliance_checks").update({ status: data.status, notes: data.notes ?? null, checked_by: context.userId, checked_at: new Date().toISOString() }).eq("id", data.checkId).select("job_id,label").single();
    if (c) await logEvent(c.job_id, context.userId, "compliance_check", `${c.label}: ${data.status}`, { notes: data.notes }, { internal: true });
    if (c) await autoAdvanceJob(c.job_id, context.userId, "compliance check", { allowApPromotion: true });
    return { ok: true };
  });

export const markReadyForVeec = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    await transition(data.jobId, "ready_for_veec", context.userId, "All compliance requirements passed – Ready for VEEC");
    return { ok: true };
  });

export const updateVeec = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, quantity: z.number().min(0).nullable(), status: z.enum(["not_submitted", "submitted", "approved", "rejected"]), submission_reference: z.string().max(100).nullable(), submitted_date: z.string().nullable(), notes: z.string().max(2000).nullable() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { jobId, ...rest } = data;
    if (["submitted", "approved"].includes(data.status) && !["ready_for_veec", "complete"].includes(await getStage(jobId)))
      throw new WorkflowError("VEEC can only be lodged once the job is Ready for VEEC.");
    await admin.from("veec_lodgements").update({ ...rest, updated_at: new Date().toISOString() }).eq("job_id", jobId);
    await logEvent(jobId, context.userId, "veec_updated", `VEEC lodgement ${data.status.replace("_", " ")}`, rest, { internal: true });
    if (["submitted", "approved"].includes(data.status) && (await getStage(jobId)) === "ready_for_veec")
      await transition(jobId, "complete", context.userId, "VEEC lodged – job complete");
    await autoAdvanceJob(jobId, context.userId, "VEEC updated");
    return { ok: true };
  });

// ---------- Comms / exceptions ----------
export const sendMessage = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, body: z.string().trim().min(1).max(4000), internal: z.boolean().optional(), channel: z.enum(["portal", "phone", "sms", "email"]).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await requireJobRole(context.supabase, data.jobId, ["admin", "electrician", "installer", "owner"]);
    if (data.channel === "email" || data.channel === "sms") {
      const { assertCustomerCommsEnabled } = await import("./comms.server");
      await assertCustomerCommsEnabled(`${data.channel} message`);
    }
    await admin.from("messages").insert({ job_id: data.jobId, sender_id: context.userId, body: data.body, internal: role === "admin" ? !!data.internal : false, channel: data.channel ?? "portal" });
    await admin.from("jobs").update({ last_activity_at: new Date().toISOString() }).eq("id", data.jobId);
    return { ok: true };
  });

export const requestReassignment = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, role: z.enum(["electrician", "installer"]), reason: z.string().trim().min(5).max(2000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["owner", "admin"]);
    await admin.from("reassignment_requests").insert({ job_id: data.jobId, role: data.role, requested_by: context.userId, reason: data.reason });
    await logEvent(data.jobId, context.userId, "reassignment_requested", `Owner requested a different ${data.role}`, { reason: data.reason });
    await admin.from("jobs").update({ next_action: `Reassign ${data.role} (owner request)` }).eq("id", data.jobId);
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
      await admin.from("jobs").update({ stage: job.prior_stage, prior_stage: null, hold_reason: null }).eq("id", data.jobId);
      await logEvent(data.jobId, context.userId, "stage_changed", "Job resumed", {}, { from: "on_hold", to: job.prior_stage });
    } else {
      if (!data.reason || data.reason.length < 3) throw new WorkflowError("A reason is required.");
      const to: Stage = data.action === "hold" ? "on_hold" : "cancelled";
      await admin.from("jobs").update({ stage: to, prior_stage: job.stage === "on_hold" ? job.prior_stage : job.stage, hold_reason: data.action === "hold" ? data.reason : null, cancelled_reason: data.action === "cancel" ? data.reason : null }).eq("id", data.jobId);
      await logEvent(data.jobId, context.userId, "stage_changed", `${to === "on_hold" ? "Put on hold" : "Cancelled"}: ${data.reason}`, {}, { from: job.stage, to });
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

export const requestOwnerAuthority = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, reason: z.enum(["initial", "renewal", "resend"]) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    // Legacy authority requests mark a customer-facing request as "sent" – blocked entirely while locked.
    const { assertCustomerCommsEnabled } = await import("./comms.server");
    await assertCustomerCommsEnabled("owner authority request");
    await requestAuthority(data.jobId, context.userId, data.reason);
    return { ok: true };
  });

export const revokeOwnerAuthority = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ authorityId: uuid, reason: z.string().trim().min(5).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, await authorityJob(data.authorityId), ["admin", "owner"]);
    await revokeAuthority(data.authorityId, context.userId, data.reason);
    return { ok: true };
  });

export const viewOwnerAuthority = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ authorityId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await requireJobRole(context.supabase, await authorityJob(data.authorityId), ["owner", "admin"]);
    if (role === "owner") await markViewed(data.authorityId, context.userId);
    return { ok: true };
  });

export const acceptOwnerAuthority = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth, withRequestMeta])
  .inputValidator((d) => z.object({ authorityId: uuid, over18: z.literal(true), authorised: z.literal(true), assistance: z.enum(["none", "interpreter", "support_understanding", "both"]), signatureName: z.string().trim().min(2).max(200) }).parse(d))
  .handler(async ({ data, context }) => {
    // Only the owner themself may give authority.
    await requireJobRole(context.supabase, await authorityJob(data.authorityId), ["owner"]);
    const { ip, userAgent } = context;
    await acceptAuthority({ authorityId: data.authorityId, actorId: context.userId, over18: data.over18, authorised: data.authorised, assistance: data.assistance, signatureName: data.signatureName, ip, userAgent });
    return { ok: true };
  });

export const declineOwnerAuthority = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ authorityId: uuid, reason: z.string().trim().min(2).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, await authorityJob(data.authorityId), ["owner"]);
    await declineAuthority(data.authorityId, context.userId, data.reason);
    return { ok: true };
  });

export const getAuthorityDocUrl = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ authorityId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: a } = await context.supabase.from("owner_authorities").select("document_path").eq("id", data.authorityId).maybeSingle();
    if (!a?.document_path) throw new WorkflowError("No locked document available");
    const { data: s, error } = await admin.storage.from("job-files").createSignedUrl(a.document_path, 300);
    if (error || !s) throw new Error(error?.message);
    return { url: s.signedUrl };
  });

/** Admin: mark expired authorities across all jobs (audited). */
/** Admin-only pipeline sweep: advance any job whose stored portal state now allows it (no Xero/Mitti calls). */
export const autoAdvancePipeline = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireAdmin(context.supabase);
  return autoAdvanceOpenJobs(context.userId);
});

export const getGate1Evidence = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { previewGate1 } = await import("./eligibility.server");
    return previewGate1(data.jobId);
  });

export const getCommsStatus = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireAdmin(context.supabase);
  const { customerCommsEnabled } = await import("./comms.server");
  return { enabled: await customerCommsEnabled() };
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
    const { data: ov } = await admin.from("payment_overrides").select("id, invoice_id, reason, created_at, overridden_by").eq("job_id", data.jobId);
    const ids = [...new Set([...(ov ?? []).map((o) => o.overridden_by), ...(inv ?? []).map((i) => i.deposit_request_raised_by).filter((x): x is string => !!x)])];
    const { data: profs } = ids.length ? await admin.from("profiles").select("id, full_name").in("id", ids) : { data: [] };
    const { data: jb } = await admin.from("jobs").select("business_unit").eq("id", data.jobId).maybeSingle();
    return { xeroAllowed: jb?.business_unit === "hivic", invoices: (inv ?? []).map((i) => ({ ...i, deposit_request_raised_by_name: profs?.find((p) => p.id === i.deposit_request_raised_by)?.full_name ?? null })), overrides: (ov ?? []).map((o) => ({ ...o, by: profs?.find((p) => p.id === o.overridden_by)?.full_name ?? null })) };
  });

export const updatePartnerEnquiry = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: uuid, status: z.enum(["new", "contacted", "onboarding", "approved", "declined", "closed"]).optional(), internal_notes: z.string().max(5000).nullable().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
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

// ---------- Customer Acceptance & VEEC Assignment ----------
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
    await signInstallerDecl({ ...data, actorId: context.userId, ip: context.ip, userAgent: context.userAgent });
    await autoAdvanceJob(data.jobId, context.userId, "installer declaration signed");
    return { ok: true };
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
  const { count } = await admin.from("esc_notification_config").select("id", { count: "exact", head: true }).eq("approved", true).eq("is_active", true);
  return setupStatus(templates, (count ?? 0) > 0);
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
    const { data: s, error } = await admin.storage.from("job-files").createSignedUrl(path, 300);
    if (error || !s) throw new Error(error?.message);
    return { url: s.signedUrl };
  });

// Admin: versioned compliance wording. The portal never supplies official text itself.
export const listComplianceTemplates = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth]).handler(async ({ context }) => {
  await requireAdmin(context.supabase);
  const { data } = await admin.from("compliance_templates").select("*").order("template_key").order("created_at", { ascending: false });
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
    const { data: t } = await admin.from("compliance_templates").select("template_key").eq("id", data.id).single();
    if (!t) throw new WorkflowError("Template not found");
    await admin.from("compliance_templates").update({ is_active: false }).eq("template_key", t.template_key).eq("is_active", true);
    const { error } = await admin.from("compliance_templates").update({ approved: true, approved_by: context.userId, approved_at: new Date().toISOString(), is_active: true }).eq("id", data.id);
    if (error) throw new WorkflowError(error.message);
    return { ok: true };
  });


// ---------- Gate 1 Property Intelligence (information only) ----------
export const runPropertyIntelligenceFn = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { runPropertyIntelligence } = await import("./intelligence.server");
    const r = await runPropertyIntelligence(data.jobId, context.userId, "admin_rerun");
    return { status: r?.status ?? "error", outcome: r?.recommendation?.outcome ?? null };
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
      providers: { cfg: { pricefinder: null, solarKey: key, nearmapKey: null, vicmapBuildings: null }, http: defaultProviderHttp, referenceDate: new Date().toISOString().slice(0, 10) } }, defaultFetchJson);
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
    const { data: s } = await supabaseAdmin.storage.from("job-files").createSignedUrl(fp.storage_path, 300);
    return { url: s?.signedUrl ?? null };
  });

export const markIntelligenceReviewed = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, note: z.string().trim().min(3).max(2000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    await logEvent(data.jobId, context.userId, "property_intelligence_reviewed", `Admin reviewed property evidence: ${data.note}`, {}, { internal: true });
    return { ok: true };
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
    if (new Date(data.deliveredAt).getTime() > Date.now() + 60_000) throw new WorkflowError("Delivery time cannot be in the future.");
    const { data: cur } = await admin.from("piesa_records").select("id").eq("job_id", data.jobId).eq("is_current", true).maybeSingle();
    if (!cur) throw new WorkflowError("No current PIESA record to deliver.");
    await admin.from("piesa_deliveries").insert({ job_id: data.jobId, piesa_record_id: cur.id, recipient: data.recipient, delivered_at: data.deliveredAt, method: data.method, document_id: data.documentId ?? null, notes: data.notes ?? null, recorded_by: context.userId });
    await logEvent(data.jobId, context.userId, "piesa_copy_delivered", `Signed PIESA copy delivered to ${data.recipient} (${data.method}) at ${data.deliveredAt}`, { piesa_record_id: cur.id });
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
