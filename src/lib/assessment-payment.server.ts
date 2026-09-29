// Staging-only pre-assessment acceptance/payment persistence. Deliberately separate from quotes, invoices, deposits and Xero.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { CUSTOMER_PAYMENT_COPY, CUSTOMER_QUOTE_LABELS, CUSTOMER_WHAT_COULD_CHANGE } from "./customer-quote-system";
import { ASSESSMENT_ACCEPTANCE_COPY_VERSION, ASSESSMENT_PAYMENT_AMOUNT, acceptanceIsCurrent, assessmentRemaining, readyForAssessmentNextAction, testPaymentTransition, type AssessmentAcceptanceState, type TestPaymentOutcome } from "./assessment-payment.core";
import { isWellFormedToken, linkUsable, LINK_PURPOSE } from "./estimatelink.core";

type RequestMeta = { ip?: string | null; userAgent?: string | null };

async function secureContext(token: unknown) {
  if (!isWellFormedToken(token)) return null;
  const { data: link } = await admin.from("customer_estimate_links").select("id, job_id, status, expires_at, current_estimate_id").eq("token", token).eq("purpose", LINK_PURPOSE).maybeSingle();
  if (!link || !linkUsable(link) || !link.current_estimate_id) return null;
  const { data: estimate } = await admin.from("indicative_estimates").select("id, job_id, status, input_signature, settings_version, applied_discount, scenarios, snapshot").eq("id", link.current_estimate_id).eq("job_id", link.job_id).maybeSingle();
  if (!estimate || estimate.status !== "current") return null;
  return { link, estimate };
}

function standardTotal(estimate: { scenarios: Json }): number | null {
  const scenarios = Array.isArray(estimate.scenarios) ? estimate.scenarios : [];
  const preferred = scenarios.find((item) => item && typeof item === "object" && "key" in item && item.key === "can_remain") ?? scenarios[0];
  if (!preferred || typeof preferred !== "object" || !("by_access" in preferred)) return null;
  const access = preferred.by_access;
  if (!access || typeof access !== "object" || !("standard" in access)) return null;
  const standard = access.standard;
  if (!standard || typeof standard !== "object" || !("estimated_customer_total" in standard)) return null;
  const total = Number(standard.estimated_customer_total);
  return Number.isFinite(total) && total >= ASSESSMENT_PAYMENT_AMOUNT ? total : null;
}

function publicState(acceptance: Record<string, unknown>, payment: Record<string, unknown>, currentEstimateId: string | null): AssessmentAcceptanceState {
  return {
    acceptanceId: String(acceptance["id"]), estimateId: String(acceptance["estimate_id"]), acceptedAt: String(acceptance["accepted_at"]),
    paymentId: String(payment["id"]), paymentStatus: payment["status"] as AssessmentAcceptanceState["paymentStatus"], amountIncGst: Number(payment["amount_inc_gst"]),
    estimatedRemainingBalanceIncGst: Number(acceptance["estimated_remaining_balance_inc_gst"]), paidAt: payment["paid_at"] ? String(payment["paid_at"]) : null,
    stale: !acceptanceIsCurrent(String(acceptance["estimate_id"]), currentEstimateId),
  };
}

async function loadAcceptance(jobId: string, currentEstimateId: string | null) {
  const { data: acceptance } = await admin.from("assessment_acceptances").select("*").eq("job_id", jobId).order("accepted_at", { ascending: false }).limit(1).maybeSingle();
  if (!acceptance) return null;
  const { data: payment } = await admin.from("assessment_payments").select("*").eq("acceptance_id", acceptance.id).maybeSingle();
  return payment ? publicState(acceptance as Record<string, unknown>, payment as Record<string, unknown>, currentEstimateId) : null;
}

export async function assessmentAcceptanceState(token: unknown) {
  const ctx = await secureContext(token);
  return ctx ? loadAcceptance(ctx.link.job_id, ctx.estimate.id) : null;
}

/** Idempotent per job + estimate. A changed estimate requires a new explicit acceptance. */
export async function acceptAssessment(token: unknown, meta: RequestMeta = {}) {
  const ctx = await secureContext(token);
  if (!ctx) throw new Error("Estimate unavailable");
  const existing = await loadAcceptance(ctx.link.job_id, ctx.estimate.id);
  if (existing && !existing.stale) return existing;
  if (existing?.paymentStatus === "paid") throw new Error("The paid assessment acceptance is already recorded.");
  const total = standardTotal(ctx.estimate);
  if (total == null) throw new Error("The current estimate cannot be accepted.");
  const remaining = assessmentRemaining(total);
  const snapshot = {
    estimate_id: ctx.estimate.id, estimate_input_signature: ctx.estimate.input_signature, settings_version: ctx.estimate.settings_version,
    customer_total_inc_gst: total, estimated_discount_inc_gst: Number(ctx.estimate.applied_discount), assessment_amount_inc_gst: ASSESSMENT_PAYMENT_AMOUNT,
    estimated_remaining_balance_inc_gst: remaining, labels: CUSTOMER_QUOTE_LABELS, payment_copy: CUSTOMER_PAYMENT_COPY, what_could_change: CUSTOMER_WHAT_COULD_CHANGE,
  };
  const { error } = await admin.rpc("accept_pre_assessment_test", {
    _job_id: ctx.link.job_id, _estimate_id: ctx.estimate.id, _estimate_input_signature: ctx.estimate.input_signature,
    _estimate_settings_version: ctx.estimate.settings_version, _customer_total: total, _estimated_discount: Number(ctx.estimate.applied_discount),
    _estimated_remaining: remaining, _copy_version: ASSESSMENT_ACCEPTANCE_COPY_VERSION, _snapshot: snapshot as unknown as Json,
    _accepted_ip: meta.ip ?? undefined, _accepted_user_agent: meta.userAgent ?? undefined,
  });
  if (error) throw new Error(error.message);
  const created = await loadAcceptance(ctx.link.job_id, ctx.estimate.id);
  if (!created) throw new Error("Assessment acceptance unavailable");
  return created;
}

async function logOnce(jobId: string, auditKey: string, eventType: string, summary: string, details: Record<string, unknown>) {
  const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).contains("details", { audit_key: auditKey });
  if (count) return;
  const { logEvent } = await import("./workflow.server");
  await logEvent(jobId, null, eventType, summary, { ...details, audit_key: auditKey }, { internal: true });
}

/** Test-only state machine. No card data and no external payment provider. */
export async function simulateAssessmentPayment(token: unknown, outcome: TestPaymentOutcome, idempotencyKey: string) {
  const ctx = await secureContext(token);
  if (!ctx) throw new Error("Estimate unavailable");
  const state = await loadAcceptance(ctx.link.job_id, ctx.estimate.id);
  if (!state) throw new Error("Accept the current estimate before payment.");
  if (state.stale) throw new Error("Your estimate changed. Please review and accept the updated estimate before paying.");
  if (state.paymentStatus === "paid") return state;
  const next = testPaymentTransition(state.paymentStatus, outcome);
  const { data: result, error } = await admin.rpc("apply_pre_assessment_test_payment", { _payment_id: state.paymentId, _idempotency_key: idempotencyKey, _outcome: outcome });
  if (error) throw new Error(error.message);
  const transition = result?.[0];
  if (next === "paid" && transition?.changed) await advanceAfterAssessmentPayment(ctx.link.job_id, state.paymentId);
  const updated = await loadAcceptance(ctx.link.job_id, ctx.estimate.id);
  if (!updated) throw new Error("Assessment payment unavailable");
  return updated;
}

async function advanceAfterAssessmentPayment(jobId: string, paymentId: string) {
  const { autoAdvanceJob } = await import("./autoadvance.server");
  await autoAdvanceJob(jobId, null, "pre-assessment payment received");
  const { data: job } = await admin.from("jobs").select("stage").eq("id", jobId).single();
  if (!job || !["awaiting_electrician", "assessment_booking", "assessment_booked"].includes(job.stage)) return;
  const { error } = await admin.from("jobs").update({ next_action: readyForAssessmentNextAction(job.stage) }).eq("id", jobId);
  if (error) throw new Error(error.message);
  await logOnce(jobId, `pre_assessment_ready:${paymentId}`, "pre_assessment_ready", "Job ready for Measure + PIESA assignment or scheduling", { payment_id: paymentId });
}