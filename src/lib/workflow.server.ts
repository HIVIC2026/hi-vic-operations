// CENTRAL WORKFLOW RULES. All stage transitions, guards and audit logging live here.
// Server-only: uses the service-role client AFTER the caller's permission has been checked.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { STORED_NEXT_ACTION, STAGE_LABEL, retiredStageBlocker, type JobRole, type Stage } from "./workflow";

export class WorkflowError extends Error {}

type Sb = SupabaseClient<Database>;

/**
 * Allowed forward/back transitions. on_hold/cancelled handled separately by admin.
 * Rectification path: owner approves scope -> installer quotes (incl. rectification lines, one combined total)
 * -> owner accepts -> Xero invoice -> approved payment option verified -> PIESA -> rectification -> installation scheduling.
 */
export const TRANSITIONS: Partial<Record<Stage, Stage[]>> = {
  // Eligible jobs go to the free installer Ready Check first; the electrician PIESA comes later (piesa_and_install_window_pending).
  new_enquiry: ["eligibility_review", "ready_check_ready_to_schedule", "ready_check_complete", "preliminary_estimate_ready", "measured_estimate_ready"],
  // measured_estimate_ready from new_enquiry/eligibility_review: ONLY the installer-intake commercial route (readyCheckBlockers).
  eligibility_review: ["ready_check_ready_to_schedule", "ready_check_complete", "preliminary_estimate_ready", "measured_estimate_ready"],
  // Ready Check pathway. NO electrician-review stage between ready_check_complete and measured_estimate_ready.
  // ready_check_complete: an accepted measure-up already on file (autoadvance planStep plans exactly this; entry blockers still apply).
  preliminary_estimate_ready: ["ready_check_awaiting_acceptance", "ready_check_ready_to_schedule", "ready_check_complete"],
  ready_check_awaiting_acceptance: ["ready_check_ready_to_schedule"],
  ready_check_awaiting_payment: ["ready_check_ready_to_schedule"],
  ready_check_ready_to_schedule: ["ready_check_scheduled", "eligibility_review", "ready_check_complete"],
  ready_check_scheduled: ["ready_check_complete", "ready_check_ready_to_schedule"],
  ready_check_complete: ["measured_estimate_ready"],
  measured_estimate_ready: ["measured_quote_accepted"],
  // PIESA entry requires Ready Check complete + verified eligible + current quote approved + approved payment option (piesaRequestBlockers).
  measured_quote_accepted: ["piesa_and_install_window_pending", "awaiting_quote_acceptance"],
  piesa_and_install_window_pending: ["piesa_scheduled"],
  piesa_scheduled: ["piesa_complete", "piesa_and_install_window_pending"],
  piesa_complete: ["electrical_variation_pending", "rectification_scheduling", "installation_scheduling", "awaiting_deposit_payment"],
  electrical_variation_pending: ["rectification_scheduling", "installation_scheduling", "awaiting_deposit_payment"],
  // Retired legacy path: entry is blocked (retiredStageBlocker); exits only lead back to the Ready Check-first flow.
  awaiting_electrician: ["eligibility_review", "ready_check_ready_to_schedule", "ready_check_complete"],
  assessment_booking: ["assessment_booked", "ready_check_ready_to_schedule"],
  assessment_booked: ["assessment_complete", "assessment_booking", "ready_check_ready_to_schedule"],
  assessment_complete: ["rectification_required", "ready_for_installer_quotes"],
  // Decision 366: once the installation quote is accepted (Ready Check path), an approved fixes quote goes straight to
  // fixes scheduling (pay in full, then pick the electrician's time) — never back to installer quotes.
  rectification_required: ["awaiting_owner_rectification_approval", "rectification_scheduling"],
  awaiting_owner_rectification_approval: ["ready_for_installer_quotes", "rectification_required", "rectification_scheduling"],
  ready_for_installer_quotes: ["awaiting_quote_acceptance"],
  awaiting_quote_acceptance: ["awaiting_deposit_payment", "ready_for_installer_quotes"],
  awaiting_deposit_payment: ["rectification_scheduling", "installation_scheduling"],
  // installation_scheduling from rectification_scheduling: ONLY the decision-314 on-site-only job (entry blockers refuse
  // every other job while fixes items are open).
  rectification_scheduling: ["rectification_booked", "installation_scheduling"],
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
export { ASSIGNMENT_VEEC_BLOCKER } from "./assignment.core";
import { ASSIGNMENT_VEEC_BLOCKER } from "./assignment.core";

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
  const { data: auth } = await sb.auth.getUser();
  if (auth.user?.user_metadata?.["qa_test"] === true) {
    const { data: job } = await admin.from("jobs").select("source, qa_archived_at").eq("id", jobId).maybeSingle();
    if (!job || job.source !== "qa_test" || job.qa_archived_at) throw new WorkflowError("TEST accounts can only use active TEST journeys.");
  }
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

/** Feature switch for the approved payment-option gate. Missing column/row = OFF (fails closed). */
async function paymentGateEnabled(): Promise<boolean> {
  const { data, error } = await admin.from("workflow_settings").select("payment_option_gate_enabled" as never).eq("id", 1).maybeSingle();
  if (error || !data) return false;
  return (data as { payment_option_gate_enabled?: boolean }).payment_option_gate_enabled === true;
}

/** Is the approved payment-option gate live for THIS job (global switch, or a live qa_test job)? Read-only. */
export async function paymentGateActiveForJob(jobId: string): Promise<boolean> {
  const { paymentGateEnabledFor } = await import("./payment-gate.core");
  const [globalEnabled, { data: job }] = await Promise.all([paymentGateEnabled(), admin.from("jobs").select("source, qa_archived_at").eq("id", jobId).single()]);
  return paymentGateEnabledFor({ globalEnabled, jobSource: job?.source, qaArchived: !!job?.qa_archived_at });
}

/** Owner-approved CURRENT confirmed installation quote: the newest issued/accepted version must be the accepted one. */
export async function currentApprovedQuote(jobId: string) {
  const { data } = await admin.from("quotes").select("id, status, customer_total_inc_gst").eq("job_id", jobId).eq("kind", "installation")
    .in("status", ["issued", "accepted"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.status === "accepted" ? data : null;
}

/** Approved payment-option gate (pure rule: evaluatePaymentGate). Route-aware; flag OFF blocks with "payment rule pending activation". */
export async function paymentGate(jobId: string) {
  const { evaluatePaymentGate, paymentRouteFor, paymentGateEnabledFor } = await import("./payment-gate.core");
  const [globalEnabled, quote, { data: job }] = await Promise.all([
    paymentGateEnabled(), currentApprovedQuote(jobId), admin.from("jobs").select("channel, source, qa_archived_at").eq("id", jobId).single(),
  ]);
  const enabled = paymentGateEnabledFor({ globalEnabled, jobSource: job?.source, qaArchived: !!job?.qa_archived_at });
  // TEST journeys only: the latest audited simulated payment (never consulted for real jobs).
  const { data: sim } = quote && job?.source === "qa_test" && !job.qa_archived_at
    ? await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "qa_payment_simulated").order("created_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  const qaSimulated = sim ? { jobSource: job?.source ?? null, quoteId: ((sim.details as { quote_id?: string } | null)?.quote_id) ?? null } : null;
  const { data: inv } = quote
    ? await admin.from("invoices").select("id, quote_id, total_inc_gst, total_paid").eq("quote_id", quote.id).maybeSingle()
    : { data: null };
  let plan = null; let overrideCount = 0;
  if (inv) {
    const [{ data: p }, { count }] = await Promise.all([
      admin.from("instalment_plans" as never).select("quote_id, status, instalment_count, office_approved_at, owner_accepted_at, first_instalment_verified_at, collection_recorded_at" as never)
        .eq("invoice_id" as never, inv.id as never).eq("status" as never, "active" as never).maybeSingle(),
      admin.from("payment_overrides").select("id", { count: "exact", head: true }).eq("invoice_id", inv.id).eq("gate", "deposit"),
    ]);
    plan = (p as never) ?? null; overrideCount = count ?? 0;
  }
  // Decision 302: the upfront amount is the accepted quote's PIESA line (setting = fallback when the quote has none).
  const safety = await (await import("./safety-check-amount.server")).quoteSafetyCheck(quote?.id ?? null);
  return evaluatePaymentGate({ enabled, route: paymentRouteFor(job?.channel), currentQuote: quote, invoice: inv, plan, overrideCount, qaSimulated, safetyFeeIncGst: safety.incGst });
}

/** True only when an approved payment option is verified (see paymentGate). */
export async function paymentOptionCleared(jobId: string) {
  return (await paymentGate(jobId)).cleared;
}

/** PIESA request facts: Ready Check complete, verified eligible, current quote approved, payment option verified. */
export async function piesaRequestFacts(jobId: string) {
  const { verifiedEligible } = await import("./verified-eligibility.server");
  const { installerIntakeQualified } = await import("./installer-intake.server");
  const [{ count: rc }, eligible, quote, payment, intake] = await Promise.all([
    admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("to_stage", "ready_check_complete"),
    verifiedEligible(jobId), // current, not-stale office verification only (fails closed)
    currentApprovedQuote(jobId), paymentGate(jobId),
    installerIntakeQualified(jobId).catch(() => false), // fails closed
  ]);
  // Jo 28 Oct: a lapsed window's repeat PIESA waits for the office choice, the owner's acceptance and (owner pays) payment.
  const { repeatPiesaGateBlocker } = await import("./repeat-piesa.core");
  const repeat = await (await import("./repeat-piesa.server")).repeatPiesaContext(jobId).catch(() => null);
  const repeatBlocker = repeat ? repeatPiesaGateBlocker(repeat.state) : "Couldn't read the repeat safety check state.";
  return { readyCheckComplete: (rc ?? 0) > 0, verifiedEligible: eligible, currentQuoteApproved: !!quote, payment, installerIntakeQualified: intake, repeatBlocker };
}

/** The one Ready Check entry blocker that depends on the booking row itself (confirmBooking pre-checks everything else). */
export const READY_CHECK_BOOKING_RECORD_BLOCKER = "Record the Ready Check date, time, assigned installer and installer business before scheduling.";

/** Ready Check pathway guards (pure rules in readycheck.core.ts). */
async function readyCheckBlockers(jobId: string, to: Stage): Promise<string[]> {
  const out: string[] = [];
  if (to === "ready_check_scheduled") {
    const { data: assignment } = await admin.from("job_assignments").select("id, user_id, business_id, businesses(business_type, onboarding_status, is_active, capabilities)").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
    const business = assignment?.businesses as { business_type: string; onboarding_status: string; is_active: boolean; capabilities: string[] | null } | null;
    const certifiedInstaller = !!assignment?.user_id && !!assignment.business_id && !!business?.is_active && business.onboarding_status === "approved"
      && (business.business_type === "eec_installer" || business.capabilities?.includes("installer"));
    if (!certifiedInstaller) out.push("Assign an approved installer before scheduling the Ready Check.");
    const { data: booking } = await admin.from("bookings").select("id, scheduled_start, contractor_id, assignment_id, business_id").eq("job_id", jobId).eq("kind", "ready_check").eq("status", "confirmed").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!booking?.scheduled_start || booking.assignment_id !== assignment?.id || booking.contractor_id !== assignment?.user_id || booking.business_id !== assignment?.business_id) out.push(READY_CHECK_BOOKING_RECORD_BLOCKER);
  }
  // Jo 24 Oct: an Add-a-job job whose Ready Check came from a Mitti form follows the measured route below (form
  // completed + eligibility from the form), like every other Mitti Ready Check.
  const mittiReadyCheck = to === "measured_estimate_ready" && !!(await admin.from("ceiling_measurements").select("id").eq("job_id", jobId).eq("is_current", true).eq("external_source", "mitti").maybeSingle()).data;
  if (to === "measured_estimate_ready" && !mittiReadyCheck && (await (await import("./installer-intake.server")).isIntakeJob(jobId))) {
    // Installer-intake commercial route (Jo, 8 Oct 2026): owner quote stage on office-checked eligibility + qualifying
    // insulation + usable scope + installer quote. Ready Check evidence is deferred, never waived (ready_for_veec).
    const { installerIntakeState } = await import("./installer-intake.server");
    out.push(...(await installerIntakeState(jobId)).readiness.blockers);
  } else if (to === "measured_estimate_ready") {
    const { count } = await admin.from("ceiling_measurements").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("is_current", true).eq("status", "complete").eq("source_role", "installer");
    if (!count) out.push("Ready Check not yet completed by the installer.");
    const { verifiedEligible } = await import("./verified-eligibility.server");
    if (!(await verifiedEligible(jobId))) out.push("Verified eligibility not recorded as eligible by the office for the current Ready Check.");
  }
  // Jo 7 Oct: a PIESA booking never needs a paired install slot. The 30-day PIESA window is checked when the install is booked (install-days / booking.server).
  if (["rectification_scheduling", "installation_scheduling"].includes(to)) {
    const { data: r } = await admin.from("piesa_reconciliations").select("id, requires_customer_approval").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (r?.requires_customer_approval) {
      const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", "electrical_variation_approved").contains("details", { reconciliation_id: r.id });
      if (!count) out.push("Electrical fixes awaiting customer approval.");
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
  if (!m) return "Ready Check missing.";
  if (m.status === "needs_review") return "Ready Check needs review / missing evidence.";
  if (m.status !== "complete") return "Ready Check not yet completed.";
  if (!(Number(m.measured_area_m2) > 0)) return "Accepted ceiling Ready Check has no measured area.";
  return null;
}

export const INSTALL_BOOKING_BLOCKER = "No completed install booking is recorded as unlocking this installation — installation must be booked and completed in the portal.";

/** Gap 4: the install booking that unlocked installation must exist and be the completed one. */
export async function installBookingBlocker(jobId: string): Promise<string | null> {
  const { data: ev } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "install_unlocked_by_booking").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const id = (ev?.details as { booking_id?: string } | null)?.booking_id;
  if (!id) return INSTALL_BOOKING_BLOCKER;
  const { data: b } = await admin.from("bookings").select("status, kind").eq("id", id).maybeSingle();
  if (!b || b.kind !== "installation" || b.status !== "completed") return INSTALL_BOOKING_BLOCKER;
  return null;
}

export const CONFIRMED_INSTALL_BOOKING_BLOCKER = "No confirmed installation booking — the installation must be booked and confirmed in the portal before it can be marked complete.";
export const INSTALL_BOOKING_READ_FAILED = "The installation booking could not be checked — please try again.";

/** P0: the confirmed installation booking that allows "Installation complete". Fails closed on a read error. */
export async function confirmedInstallBooking(jobId: string): Promise<{ booking: { id: string; scheduled_start: string | null } | null; blocker: string | null }> {
  const { data, error } = await admin.from("bookings").select("id, scheduled_start").eq("job_id", jobId).eq("kind", "installation").eq("status", "confirmed").order("scheduled_start", { ascending: false }).limit(1).maybeSingle();
  if (error) return { booking: null, blocker: INSTALL_BOOKING_READ_FAILED };
  if (!data) return { booking: null, blocker: CONFIRMED_INSTALL_BOOKING_BLOCKER };
  return { booking: data as { id: string; scheduled_start: string | null }, blocker: null };
}

export async function stageEntryBlockers(jobId: string, to: Stage, actorId: string | null = null): Promise<string[]> {
  const retired = retiredStageBlocker(to);
  if (retired) return [retired]; // server-side: stale clients / direct calls cannot re-enter the legacy path
  const blockers: string[] = [];
  if (to === "evidence_outstanding") {
    // Completion/direct transitions must re-read the hold even when an earlier pre-start check passed.
    const hold = await (await import("./installer-intake.server")).siteConditionsHoldFor(jobId);
    if (hold.open) {
      const { SITE_HOLD_BLOCKER } = await import("./site-conditions.core");
      return [hold.note ? `${SITE_HOLD_BLOCKER}: ${hold.note}` : SITE_HOLD_BLOCKER];
    }
    // Completion must read current area evidence even after an earlier pre-start check passed.
    const areas = await (await import("./ready-check-draft.server")).rcAreaWorksBlockers(jobId);
    if (areas.length) return areas;
  }
  blockers.push(...(await readyCheckBlockers(jobId, to)));
  // Owner paperwork gates A–D (one rule set for every journey).
  blockers.push(...(await (await import("./owner-gates.server")).ownerGateStageBlockers(jobId, to)));
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
  // Decision 296 (Jo 25 Oct 2026): the install day cannot be booked until the owner has confirmed the current PIESA on their secure link.
  if (to === "installation_booked") {
    const ob = await (await import("./piesa-owner-confirm.server")).ownerPiesaConfirmationBlockerFor(jobId);
    if (ob) blockers.push(ob);
  }
  const piesa = await piesaStatus(jobId);

  if (["awaiting_deposit_payment", "rectification_scheduling", "rectification_booked", "installation_scheduling", "installation_booked"].includes(to)) {
    if (!(await agreementSigned(jobId))) blockers.push(CONSUMER_SIGN_BLOCKER);
  }
  if (["ap_review", "ready_for_veec", "complete"].includes(to)) {
    // Office check for known previous Activity 48 evidence — fails closed when missing or same area.
    const { priorActivityCheck } = await import("./verified-eligibility.server");
    const { priorActivityBlocker } = await import("./verified-eligibility.core");
    const pb = priorActivityBlocker(await priorActivityCheck(jobId));
    if (pb) blockers.push(pb);
  }
  if (to === "ap_review" || to === "ready_for_veec") {
    const ib = await installBookingBlocker(jobId);
    if (ib) blockers.push(ib);
    // Installer declaration is signed inside the Mitti PIISA; no signed record = no AP sign-off.
    const { data: decl } = await admin.from("installer_declarations").select("id, snapshot").eq("job_id", jobId).eq("status", "signed").maybeSingle();
    if (!decl) blockers.push((await import("./piisa-declaration.core")).MISSING_INSTALLER_DECLARATION);
    else {
      const { a3EvidenceGate } = await import("./piisa-a3.core");
      const official = (decl.snapshot as { official?: { a3_evidence?: { actual_product_answers?: unknown } } } | null)?.official;
      blockers.push(...a3EvidenceGate(official));
      if (official?.a3_evidence?.actual_product_answers) {
        const currentProducts = await (await import("./piisa-products.server")).verifiedInstalledProductAnswers(jobId);
        blockers.push(...currentProducts.blockers);
        if (JSON.stringify(currentProducts.answers) !== JSON.stringify(official.a3_evidence.actual_product_answers)) blockers.push("Actual products changed after the signed PIISA; office review required.");
      }
    }
  }
  if (to === "ready_for_veec") {
    const st = await assignmentStatus(jobId);
    if (st === "variation_required") blockers.push("Assignment variation must be reconfirmed by the customer.");
    if (st !== "effective_complete") blockers.push(ASSIGNMENT_VEEC_BLOCKER);
    // Final AP approval must be a real signed-in admin person making this move — automation (null actor) never passes.
    if (!actorId) blockers.push("Final Accredited Person approval must be given by a person in the Final check queue.");
    else { const { data: isAdmin } = await admin.rpc("has_role", { _user_id: actorId, _role: "admin" }); if (!isAdmin) blockers.push("Only an Accredited Person (office admin) can give final approval."); }
    const { isIntakeJob } = await import("./installer-intake.server");
    if (await isIntakeJob(jobId)) {
      // Installer intake route deferred the Ready Check: every required item VERIFIED (uploads, ticks and
      // declarations never count), real initial-condition and existing R-value media verified, and verified eligibility.
      const { rebateEvidenceBlockers, intakeOriginalConditionMedia } = await import("./installer-intake.core");
      const { rcObservedInsulation } = await import("./ready-check-draft.server");
      const media = intakeOriginalConditionMedia(await rcObservedInsulation(jobId));
      if (media.blocker) blockers.push(media.blocker);
      const { data: ev } = await admin.from("evidence_requirements").select("category, label, required, status").eq("job_id", jobId);
      blockers.push(...rebateEvidenceBlockers({ items: (ev ?? []).map((r) => ({ category: r.category, label: r.label, blocking: r.required, status: r.status })), apApprovedBy: actorId, requiredCategories: media.required, notApplicableCategories: media.notApplicable }).filter((b) => !b.startsWith("Final Accredited Person")));
      const { verifiedEligible } = await import("./verified-eligibility.server");
      if (!(await verifiedEligible(jobId))) blockers.push("Ready Check evidence not verified as eligible by the office.");
    }
  }
  if (["piesa_and_install_window_pending", "installation_scheduling", "installation_booked", "evidence_outstanding"].includes(to)) {
    const m = await import("./installer-intake.server");
    if ((await m.isIntakeJob(jobId)) && (await m.reconfirmationOpen(jobId))) blockers.push("Quote facts changed after acceptance — the owner must reconfirm the corrected quote first.");
  }
  if (to === "evidence_outstanding") {
    // Install-day order for intake jobs (Ready Check deferred): initial-condition media BEFORE removal/covering
    // and a passed pre-start check BEFORE PIISA/works.
    const m = await import("./installer-intake.server");
    if (await m.isIntakeJob(jobId)) {
      const { installDayBlockers } = await import("./installer-intake.core");
      const [{ data: before }, { data: ps }] = await Promise.all([
        admin.from("evidence_requirements").select("status").eq("job_id", jobId).eq("category", "before_ceiling_space"),
        admin.from("pre_start_checks").select("passed").eq("job_id", jobId).order("checked_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      blockers.push(...installDayBlockers({ initialConditionCaptured: (before ?? []).some((r) => r.status === "uploaded" || r.status === "verified"), prestartComplete: ps?.passed === true }, "piisa_or_works"));
    }
  }
  if (PIESA_WINDOW_STAGES.includes(to) && piesa?.piesa_expired) {
    blockers.push(
      `PIESA 30-day window expired on ${piesa.install_deadline}. Electrician must record a reassessment before progressing.`,
    );
  }
  // Batch 1 task 6 (Jo 28 Oct 2026): a PIESA made before the job was reopened no longer counts — it never unlocks install.
  if (PIESA_WINDOW_STAGES.includes(to) && piesa?.piesa_date && (await (await import("./repeat-piesa.server")).currentPiesaSupersededByReopen(jobId))) {
    const { PASSING_PIESA_BLOCKER } = await import("./allocation.core");
    blockers.push(PASSING_PIESA_BLOCKER);
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
    else if (rect === 0 && piesa.piesa_outcome !== "pass") blockers.push("Current PIESA has not passed and no electrical fixes scope exists.");
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
  // APPROVED PAYMENT RULE: PIESA request and all scheduling require a verified approved payment option.
  if (to === "piesa_and_install_window_pending" || to === "piesa_scheduled") {
    const { piesaRequestBlockers } = await import("./payment-gate.core");
    blockers.push(...piesaRequestBlockers(await piesaRequestFacts(jobId)));
  }
  if (["rectification_scheduling", "rectification_booked", "installation_scheduling", "installation_booked"].includes(to)) {
    const g = await paymentGate(jobId);
    if (!g.cleared) blockers.push(g.blocker);
  }
  // Decision 366 (audit F03): no fixes visit is booked until the electrical fixes are paid in full.
  if (to === "rectification_booked") {
    const fb = await (await import("./payments.server")).fixesPaymentBlockerFor(jobId);
    if (fb) blockers.push(fb);
  }
  // Jo 26 Oct 2026: no install booking until the 10% install deposit is paid.
  if (to === "installation_booked") {
    const db = await (await import("./payments.server")).installDepositBlockerFor(jobId);
    if (db) blockers.push(db);
  }
  if (to === "installation_scheduling" || to === "installation_booked") {
    // Decision 314 follow-up: open fixes items on an on-site-only job cleared on `electrician_at_start` are done on the
    // install day (read only when fixes items are open, so every other job reads exactly as before).
    const { installEntryElectricalBlockers } = await import("./allocation.core");
    const onsiteStartCleared = rect > 0 ? await (await import("./electrical-clearance.server")).onsiteStartClearedFor(jobId) : false;
    blockers.push(...installEntryElectricalBlockers({ openRectItems: rect, piesaDate: piesa?.piesa_date, piesaOutcome: piesa?.piesa_outcome, onsiteStartCleared }));
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
  // Decision 178: a Mitti PIESA is not complete until its evidence is on the synced form (same pure rule as the sync).
  if (to === "piesa_complete") {
    const { piesaEvidenceHold } = await import("./piesa-evidence.server");
    for (const b of await piesaEvidenceHold(jobId)) blockers.push(`PIESA evidence: ${b}`);
  }
  // PIESA Part 7: an unresolved hazard blocks PIESA completion and installation (evidence_outstanding via piisaPanel).
  if (["piesa_complete", "assessment_complete", "installation_scheduling", "installation_booked"].includes(to)) {
    const { hazardBlockers } = await import("./official-forms.server");
    blockers.push(...(await hazardBlockers(jobId)));
  }
  // PIISA: due on installation day immediately before work starts; canonical gate (fails closed).
  if (to === "evidence_outstanding") {
    const { piisaPanel } = await import("./official-forms.server");
    const { todayMelbourne } = await import("./eligibility.server");
    blockers.push(...(await piisaPanel(jobId, todayMelbourne())).blockers);
  }
  if (to === "ap_review" || to === "ready_for_veec") {
    // P0: mandatory evidence gate fails closed (a read error or a missing installation checklist never passes).
    const { data: reqs, error: reqErr } = await admin
      .from("evidence_requirements")
      .select("label,status,required,gate,category")
      .eq("job_id", jobId)
      .eq("required", true);
    const { evidenceStageBlockers } = await import("./ap-review-evidence.core");
    // Decision 205: Activity Guide v1.2 Table 4 install evidence + Activity 48 product check, in plain words per item.
    const { installEvidenceStageExtras } = await import("./install-evidence.server");
    blockers.push(...evidenceStageBlockers(to, reqs ?? null, !!reqErr, await installEvidenceStageExtras(jobId)));
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
    const { lodgementEvidenceBlockers, veecCompletesJob } = await import("./veec.core");
    blockers.push(...lodgementEvidenceBlockers(v, (await import("./veec.core")).melbourneToday()));
    if (v && !veecCompletesJob(v.status)) blockers.push("VEEC must be registered (approved) before the job can be completed.");
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
  const blockers = await stageEntryBlockers(jobId, to, actorId);
  if (blockers.length) throw new WorkflowError(`Blocked: ${blockers.join(" • ")}`);
  const { error } = await admin.rpc("commit_guarded_stage", {
    _job: jobId,
    _expected: from,
    _to: to,
    _actor: actorId,
    _summary: summary,
    _details: details as Json,
    _next: opts.nextAction ?? STORED_NEXT_ACTION[to],
  } as never);
  // A concurrent stage change is a workflow outcome (re-evaluate), not a crash: callers that tolerate WorkflowError
  // (autoAdvanceJob, sweeps) must not abort or lose retries because two triggers raced.
  if (error) throw /changed concurrently|Terminal job cannot progress/i.test(error.message) ? new WorkflowError(error.message) : new Error(error.message);
  if (to === "piesa_and_install_window_pending" && from !== to) {
    // Quote accepted AND payment gate passed (entry blockers above). Hold only — never a booking.
    const { createInstallHold } = await import("./install-holds.server");
    await createInstallHold(jobId, actorId).catch((e) => console.error("install hold not placed", (e as Error).message));
  }
}

/** Blockers for the job's natural next step (for UI display), plus standing hard blockers. */
export async function nextStepBlockers(jobId: string) {
  const stage = await getStage(jobId);
  let next = TRANSITIONS[stage]?.[0] ?? null;
  if (stage === "awaiting_deposit_payment") next = (await openRectCount(jobId)) > 0 ? "rectification_scheduling" : "installation_scheduling";
  if (stage === "rectification_booked") next = "installation_scheduling";
  // Speed (decision 280): the entry blockers, PIESA status and assignment status are independent reads — one round trip.
  const [blockers, piesa, asgStatus] = await Promise.all([next ? stageEntryBlockers(jobId, next) : Promise.resolve([] as string[]), piesaStatus(jobId), assignmentStatus(jobId)]);
  if (piesa?.piesa_expired && !blockers.some((b) => b.startsWith("PIESA")))
    blockers.unshift(`PIESA 30-day window expired on ${piesa.install_deadline}. Reassessment required.`);
  if (asgStatus === "variation_required" && !blockers.some((b) => b.startsWith("Assignment variation")))
    blockers.unshift("Assignment variation must be reconfirmed by the customer.");
  // A stage move can be unblocked while the work that move implies is still outstanding. The Ready Check is the
  // clearest case: "ready_check_complete" has no entry guard, so Office needs the actual submission state to
  // read alongside the transition hint. Reported as a fact, never folded into `blockers` (no permission change).
  // (Brief O, 43dfc9fb; restored after the bdf1da3c reconcile silently dropped it.)
  const readyCheck = stage === "ready_check_scheduled" || next === "ready_check_complete"
    ? await (await import("./ready-check-draft.server")).readyCheckState(jobId)
    : null;
  return { stage, next, blockers, readyCheck };
}
