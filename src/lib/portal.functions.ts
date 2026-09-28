// All state-changing operations. Each verifies the caller (via RLS-backed RPC) then
// delegates to the central workflow/quote modules which write with the service role.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { withRequestMeta } from "./request-meta";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent, nextStepBlockers, stageEntryBlockers, piesaStatus, requireAdmin, requireJobRole, transition, getStage } from "./workflow.server";
import { adjustQuote as adjustQuoteImpl, deriveRectificationItems, generateInstallerQuotes as genInstaller, generateRectificationQuote } from "./quotes.server";
import { enquirySchema, upsertEnquiry } from "./enquiry.server";
import { STAGE_LABEL, type Stage } from "./workflow";
import { applyPaidAmount, createInvoiceForQuote, refreshBalanceDueDate, syncInvoiceFromXero } from "./xero.server";
import { AUTHORITY_BLOCKER, commercialBlocker, depositCleared } from "./workflow.server";
import { acceptAuthority, authorityValid, declineAuthority, markViewed, requestAuthority, revokeAuthority, sweepAuthorityExpiry } from "./authority.server";

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
    const stage = await getStage(data.jobId);
    await admin.from("jobs").update({ eligibility_outcome: data.outcome, eligibility_reason: data.reason, next_action: data.nextAction, eligibility_set_by: context.userId, eligibility_set_at: new Date().toISOString() }).eq("id", data.jobId);
    await logEvent(data.jobId, context.userId, "eligibility_set", `Eligibility: ${data.outcome.replaceAll("_", " ")}`, { reason: data.reason, next_action: data.nextAction });
    if (data.outcome !== "does_not_appear_eligible" && (stage === "new_enquiry" || stage === "eligibility_review")) {
      await transition(data.jobId, "awaiting_electrician", context.userId, "Eligibility passed – awaiting electrician", {}, { nextAction: data.nextAction });
      // Job is proceeding: Owner Authority must be requested now (before any onsite booking).
      if (!(await authorityValid(data.jobId))) await requestAuthority(data.jobId, context.userId, "initial");
    } else if (stage === "new_enquiry") {
      await transition(data.jobId, "eligibility_review", context.userId, "Moved to eligibility review", {}, { nextAction: data.nextAction });
    }
    await admin.from("compliance_checks").update({ status: data.outcome === "does_not_appear_eligible" ? "fail" : data.outcome === "likely_eligible" ? "pass" : "pending", checked_by: context.userId, checked_at: new Date().toISOString(), notes: data.reason }).eq("job_id", data.jobId).eq("check_key", "eligibility");
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

// ---------- Gate 2: assessment ----------
const assessmentPatch = z.object({
  measured_area_m2: z.number().min(0).max(5000).nullable(),
  insulation_present: z.boolean().nullable(),
  existing_r_value: z.number().min(0).max(10).nullable(),
  removal_required: z.boolean().nullable(),
  removal_m2: z.number().min(0).max(5000).nullable(),
  access_difficulty: z.enum(["easy", "moderate", "difficult"]).nullable(),
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

export const completeAssessment = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["admin", "electrician"]);
    const { data: a } = await admin.from("assessments").select("*").eq("job_id", data.jobId).maybeSingle();
    if (!a) throw new WorkflowError("Start the assessment first.");
    const missing: string[] = [];
    if (a.measured_area_m2 == null) missing.push("measured ceiling area");
    if (a.insulation_present == null) missing.push("existing insulation present/absent");
    if (a.insulation_present && a.existing_r_value == null) missing.push("existing R-value");
    if (a.removal_required == null) missing.push("removal required");
    if (a.removal_required && !a.removal_m2) missing.push("removal m²");
    if (!a.access_difficulty) missing.push("access difficulty");
    if (!a.switchboard_condition) missing.push("switchboard condition");
    if (a.rcds_present == null) missing.push("RCDs present");
    if (a.life_support_confirmed == null) missing.push("life support confirmation");
    if (a.piesa_outcome === "pending") missing.push("PIESA outcome");
    if (!a.assessed_on) missing.push("assessment date");
    if (missing.length) throw new WorkflowError(`Still needed: ${missing.join(", ")}`);
    const { data: ev } = await admin.from("evidence_requirements").select("label,status,gate,category").eq("job_id", data.jobId).eq("required", true);
    // Assessment evidence always; the PIESA sign-off too when PIESA passed on this visit (no second electrician trip).
    const evMissing = (ev ?? [])
      .filter((e) => e.gate === "assessment" || (a.piesa_outcome === "pass" && e.category === "piesa_signoff"))
      .filter((e) => !["uploaded", "verified"].includes(e.status)).map((e) => e.label);
    if (evMissing.length) throw new WorkflowError(`Upload evidence first: ${evMissing.join(", ")}`);

    const stage = await getStage(data.jobId);
    if (stage !== "assessment_booked") throw new WorkflowError(`Assessment can be completed from "Assessment Booked" (current: ${STAGE_LABEL[stage]}).`);
    await admin.from("assessments").update({ status: "complete", completed_at: new Date().toISOString(), assessor_id: a.assessor_id ?? context.userId, mitti_sync_status: a.external_mitti_id ? "synced" : "not_synced" }).eq("id", a.id);
    await admin.from("piesa_records").update({ is_current: false }).eq("job_id", data.jobId).eq("is_current", true);
    await admin.from("piesa_records").insert({ job_id: data.jobId, assessment_id: a.id, kind: "initial", outcome: a.piesa_outcome, completed_date: a.assessed_on!, signed_off_by: context.userId, external_mitti_id: a.external_mitti_id });
    await transition(data.jobId, "assessment_complete", context.userId, `Assessment complete – PIESA ${a.piesa_outcome}`, { measured_area_m2: a.measured_area_m2 });

    const rectCount = await deriveRectificationItems(data.jobId, context.userId);
    await admin.from("compliance_checks").update({ status: a.piesa_outcome === "pass" && rectCount === 0 ? "pass" : "pending" }).eq("job_id", data.jobId).eq("check_key", "electrical_assessment");
    if (rectCount > 0 || a.piesa_outcome === "fail") {
      await admin.from("evidence_requirements").update({ required: true, status: "outstanding" }).eq("job_id", data.jobId).eq("category", "rectification_completion");
      await transition(data.jobId, "rectification_required", context.userId, `${rectCount} rectification item(s) required`);
      if (rectCount > 0) {
        await generateRectificationQuote(data.jobId, context.userId);
        await transition(data.jobId, "awaiting_owner_rectification_approval", context.userId, "Rectification quote issued to owner");
      }
    } else {
      await admin.from("compliance_checks").update({ status: "pass" }).eq("job_id", data.jobId).eq("check_key", "rectification");
      await transition(data.jobId, "ready_for_installer_quotes", context.userId, "No rectification required – ready for installer quotes");
    }
    return { ok: true };
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
    if (stage === "ready_for_installer_quotes") await transition(data.jobId, "awaiting_quote_acceptance", context.userId, "Installation quotes issued to owner");
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

export const respondToQuote = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ quoteId: uuid, accept: z.boolean(), consent: z.boolean().optional(), reason: z.string().max(1000).optional() }).parse(d))
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
    if (!(await authorityValid(q.job_id))) throw new WorkflowError(`${AUTHORITY_BLOCKER} before accepting quotes.`);
    // All gates are checked BEFORE the quote is marked accepted, so a blocked acceptance leaves nothing half-done.
    if (q.kind === "installation") {
      const cb = await commercialBlocker(q.job_id);
      if (cb) throw new WorkflowError(`Blocked: ${cb}`);
      const p = await piesaStatus(q.job_id);
      const { count: rect } = await admin.from("rectification_items").select("id", { count: "exact", head: true }).eq("job_id", q.job_id).eq("status", "required");
      if (!rect && p?.piesa_expired) throw new WorkflowError("The electrical safety assessment has expired. HI VIC will arrange a reassessment.");
    }
    await admin.from("quotes").update({ status: "accepted", accepted_at: new Date().toISOString(), accepted_by: context.userId }).eq("id", q.id);
    await admin.from("quotes").update({ status: "superseded" }).eq("job_id", q.job_id).eq("kind", q.kind).eq("status", "issued");

    if (q.kind === "rectification") {
      // Scope approval only – no invoice. The rectification lines are folded into the final installation quote.
      await logEvent(q.job_id, context.userId, "rectification_scope_approved", `Owner approved rectification scope (${q.customer_total_inc_gst} inc GST)`, { quote_id: q.id });
      await transition(q.job_id, "ready_for_installer_quotes", context.userId, "Rectification scope approved – preparing final installation quotes");
      await genInstaller(q.job_id, context.userId);
      await transition(q.job_id, "awaiting_quote_acceptance", context.userId, "Final installation quotes (incl. rectification) issued to owner");
      return { ok: true };
    }

    await admin.from("declarations").upsert({ job_id: q.job_id, kind: "owner_consent", declared_by: context.userId, statement: `Owner accepted ${q.option_label} (${q.customer_total_inc_gst} inc GST): 50% deposit due now, balance due on installation day.` }, { onConflict: "job_id,kind" });
    await admin.from("compliance_checks").update({ status: "pass", checked_at: new Date().toISOString() }).eq("job_id", q.job_id).eq("check_key", "owner_consent");
    await logEvent(q.job_id, context.userId, "quote_accepted", `${q.option_label} accepted`, { quote_id: q.id, total_inc_gst: q.customer_total_inc_gst });
    await transition(q.job_id, "awaiting_deposit_payment", context.userId, "Owner accepted final installation quote – 50% deposit due");
    await createInvoiceForQuote(q.id, context.userId);
    await advanceAfterDeposit(q.job_id, context.userId);
    return { ok: true };
  });

// ---------- Payments (Xero mirror + gates) ----------
async function advanceAfterDeposit(jobId: string, actorId: string) {
  if ((await getStage(jobId)) !== "awaiting_deposit_payment") return;
  if (!(await depositCleared(jobId))) return;
  const { count } = await admin.from("rectification_items").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("status", "required");
  const to: Stage = (count ?? 0) > 0 ? "rectification_scheduling" : "installation_scheduling";
  try {
    await transition(jobId, to, actorId, `Deposit cleared – ${to === "rectification_scheduling" ? "rectification" : "installation"} scheduling unlocked`);
  } catch (e) {
    // Deposit is cleared but another hard gate (e.g. authority, PIESA) still blocks; stays visible as a blocker.
    if (!(e instanceof WorkflowError)) throw e;
  }
}

export const syncInvoice = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ invoiceId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    await syncInvoiceFromXero(data.invoiceId, context.userId);
    const { data: inv } = await admin.from("invoices").select("job_id").eq("id", data.invoiceId).single();
    if (inv) await advanceAfterDeposit(inv.job_id, context.userId);
    return { ok: true };
  });

export const retryXeroPush = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ invoiceId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    // Same safe path as Sync: pushes only if not linked, adopts an existing Xero invoice, lock-protected.
    await syncInvoiceFromXero(data.invoiceId, context.userId);
    return { ok: true };
  });

/** Admin override of the deposit gate – reason required, permanently audited. */
export const overrideDepositGate = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ invoiceId: uuid, reason: z.string().trim().min(5).max(1000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { data: inv } = await admin.from("invoices").select("job_id, status, deposit_paid_at, total_paid").eq("id", data.invoiceId).single();
    if (!inv) throw new WorkflowError("Invoice not found");
    const before = { invoice_status: inv.status, deposit_paid_at: inv.deposit_paid_at, total_paid: inv.total_paid, deposit_gate: "locked", stage: await getStage(inv.job_id) };
    const after = { ...before, deposit_gate: "overridden" };
    await admin.from("payment_overrides").insert({ invoice_id: data.invoiceId, job_id: inv.job_id, gate: "deposit", reason: data.reason, overridden_by: context.userId, before_state: before, after_state: after });
    await logEvent(inv.job_id, context.userId, "payment_override", `Deposit gate overridden by admin: ${data.reason}`, { invoice_id: data.invoiceId, before, after });
    await advanceAfterDeposit(inv.job_id, context.userId);
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
    const stage = await getStage(data.jobId);
    const map: Record<string, [Stage[], Stage]> = {
      assessment: [["assessment_booking", "assessment_booked"], "assessment_booked"],
      rectification: [["rectification_scheduling", "rectification_booked"], "rectification_booked"],
      installation: [["installation_scheduling", "installation_booked"], "installation_booked"],
    };
    const [allowed, target] = map[data.kind]!;
    if (!allowed.includes(stage)) throw new WorkflowError(`A ${data.kind} booking can't be made at ${STAGE_LABEL[stage]}.`);
    const { data: contractor } = await admin.from("job_assignments").select("user_id").eq("job_id", data.jobId).eq("role", need).eq("active", true).maybeSingle();
    if (!contractor) throw new WorkflowError(`No ${need} assigned yet.`);
    if (data.kind === "installation") {
      const p = await piesaStatus(data.jobId);
      if (p?.piesa_expired) throw new WorkflowError(`Blocked: PIESA 30-day window expired on ${p.install_deadline}. Electrician must record a reassessment first.`);
      if (p?.install_deadline && data.start.slice(0, 10) > p.install_deadline)
        throw new WorkflowError(`Installation must be before the PIESA deadline (${p.install_deadline}).`);
    }
    if (!(await authorityValid(data.jobId))) throw new WorkflowError(`Blocked: ${AUTHORITY_BLOCKER}.`);
    if (data.kind !== "assessment") { const cb = await commercialBlocker(data.jobId); if (cb) throw new WorkflowError(`Blocked: ${cb}`); }
    if (data.kind !== "assessment" && !(await depositCleared(data.jobId)))
      throw new WorkflowError("Blocked: the 50% deposit has not been paid.");
    await admin.from("bookings").update({ status: "cancelled" }).eq("job_id", data.jobId).eq("kind", data.kind).in("status", ["proposed", "confirmed"]);
    await admin.from("bookings").insert({ job_id: data.jobId, kind: data.kind, contractor_id: contractor.user_id, scheduled_start: data.start, booked_by: context.userId, notes: data.notes ?? null, status: "confirmed" });
    if (data.kind === "installation") await refreshBalanceDueDate(data.jobId, context.userId);
    const when = new Date(data.start).toLocaleString("en-AU", { timeZone: "Australia/Melbourne" });
    if (stage === target) await logEvent(data.jobId, context.userId, "booking_rescheduled", `${data.kind} rescheduled to ${when} by ${role}`);
    else await transition(data.jobId, target, context.userId, `${data.kind.charAt(0).toUpperCase() + data.kind.slice(1)} booked for ${when} by ${role}`);
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
    if (data.kind === "installation") await refreshBalanceDueDate(data.jobId, context.userId);
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
    return { ok: true };
  });

export const submitDeclaration = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, kind: z.enum(["installer_declaration", "electrician_declaration"]), statement: z.string().trim().min(10).max(4000) }).parse(d))
  .handler(async ({ data, context }) => {
    await requireJobRole(context.supabase, data.jobId, ["admin", data.kind === "installer_declaration" ? "installer" : "electrician"]);
    await admin.from("declarations").upsert({ job_id: data.jobId, kind: data.kind, declared_by: context.userId, statement: data.statement, declared_at: new Date().toISOString() }, { onConflict: "job_id,kind" });
    await logEvent(data.jobId, context.userId, "declaration_submitted", `${data.kind.replace("_", " ")} signed`);
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
  if (role !== "admin" && req.responsible_role !== role) throw new WorkflowError("This evidence is uploaded by another party.");
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
      owner_authority: await authorityValid(data.jobId),
      electrical_assessment: p?.piesa_outcome === "pass",
      rectification: (openRect ?? 0) === 0,
      installation_evidence: (ev ?? []).every((e) => e.status === "verified"),
      declarations: kinds.has("installer_declaration") && kinds.has("owner_consent"),
    };
    for (const [key, ok] of Object.entries(auto))
      await admin.from("compliance_checks").update({ status: ok ? "pass" : "fail", checked_by: context.userId, checked_at: new Date().toISOString(), notes: "Automated check" }).eq("job_id", data.jobId).eq("check_key", key);
    await logEvent(data.jobId, context.userId, "compliance_reviewed", "Automated compliance review run", auto, { internal: true });
    return { ok: true };
  });

export const setComplianceCheck = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ checkId: uuid, status: z.enum(["pending", "pass", "fail"]), notes: z.string().max(2000).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    await requireAdmin(context.supabase);
    const { data: c } = await admin.from("compliance_checks").update({ status: data.status, notes: data.notes ?? null, checked_by: context.userId, checked_at: new Date().toISOString() }).eq("id", data.checkId).select("job_id,label").single();
    if (c) await logEvent(c.job_id, context.userId, "compliance_check", `${c.label}: ${data.status}`, { notes: data.notes }, { internal: true });
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
    return { ok: true };
  });

// ---------- Comms / exceptions ----------
export const sendMessage = createServerFn({ method: "POST" }).middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ jobId: uuid, body: z.string().trim().min(1).max(4000), internal: z.boolean().optional(), channel: z.enum(["portal", "phone", "sms", "email"]).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const role = await requireJobRole(context.supabase, data.jobId, ["admin", "electrician", "installer", "owner"]);
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
    const { data: inv } = await admin.from("invoices").select("id, xero_contact_id, xero_invoice_id, xero_reference, xero_invoice_status, last_synced_at, last_sync_error, sync_lock_at").eq("job_id", data.jobId);
    const { data: ov } = await admin.from("payment_overrides").select("id, invoice_id, reason, created_at, overridden_by").eq("job_id", data.jobId);
    const ids = [...new Set((ov ?? []).map((o) => o.overridden_by))];
    const { data: profs } = ids.length ? await admin.from("profiles").select("id, full_name").in("id", ids) : { data: [] };
    return { invoices: inv ?? [], overrides: (ov ?? []).map((o) => ({ ...o, by: profs?.find((p) => p.id === o.overridden_by)?.full_name ?? null })) };
  });
