// Staging-only $99 Home Insulation Ready Check acceptance/payment. Separate from quotes, invoices, 50% deposits and Xero.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { CUSTOMER_PAYMENT_COPY, CUSTOMER_QUOTE_LABELS, CUSTOMER_READY_CHECK } from "./customer-quote-system";
import { READY_CHECK_COPY_VERSION, READY_CHECK_FEE, READY_CHECK_PAID_NEXT_ACTION, READY_CHECK_PAID_STAGE, acceptanceIsCurrent, readyCheckRemaining, testPaymentTransition, type ReadyCheckAcceptanceState, type TestPaymentOutcome } from "./readycheck.core";
import { isWellFormedToken, linkUsable, LINK_PURPOSE } from "./estimatelink.core";

type RequestMeta = { ip?: string | null; userAgent?: string | null };

async function secureContext(token: unknown) {
  if (!isWellFormedToken(token)) return null;
  const { data: link } = await admin.from("customer_estimate_links").select("id, job_id, status, expires_at, current_estimate_id").eq("token", token).eq("purpose", LINK_PURPOSE).maybeSingle();
  if (!link || !linkUsable(link) || !link.current_estimate_id) return null;
  const { data: estimate } = await admin.from("indicative_estimates").select("id, job_id, status, input_signature, settings_version, applied_discount, scenarios").eq("id", link.current_estimate_id).eq("job_id", link.job_id).maybeSingle();
  if (!estimate || estimate.status !== "current") return null;
  return { link, estimate };
}

function costAfterDiscount(estimate: { scenarios: Json }): number | null {
  const scenarios = Array.isArray(estimate.scenarios) ? estimate.scenarios : [];
  const preferred = scenarios.find((item) => item && typeof item === "object" && "key" in item && item["key"] === "can_remain") ?? scenarios[0];
  if (!preferred || typeof preferred !== "object" || !("by_access" in preferred)) return null;
  const access = preferred["by_access"];
  if (!access || typeof access !== "object" || !("standard" in access)) return null;
  const standard = access["standard"];
  if (!standard || typeof standard !== "object" || !("estimated_customer_total" in standard)) return null;
  const total = Number(standard["estimated_customer_total"]);
  return Number.isFinite(total) && total >= READY_CHECK_FEE ? total : null;
}

type Identity = { id: string; input_signature: string; settings_version: number } | null;

function publicState(a: Record<string, unknown>, p: Record<string, unknown>, current: Identity): ReadyCheckAcceptanceState {
  return {
    acceptanceId: String(a["id"]), estimateId: String(a["estimate_id"]), acceptedAt: String(a["accepted_at"]),
    paymentId: String(p["id"]), paymentStatus: p["status"] as ReadyCheckAcceptanceState["paymentStatus"], amountIncGst: Number(p["amount_inc_gst"]),
    estimatedRemainingBalanceIncGst: Number(a["estimated_remaining_balance_inc_gst"]), paidAt: p["paid_at"] ? String(p["paid_at"]) : null,
    stale: !current || !acceptanceIsCurrent(String(a["estimate_id"]), current.id)
      || String(a["estimate_input_signature"]) !== current.input_signature
      || Number(a["estimate_settings_version"]) !== current.settings_version,
  };
}

async function loadAcceptance(jobId: string, current: Identity) {
  const { data: a } = await admin.from("ready_check_acceptances").select("*").eq("job_id", jobId).order("accepted_at", { ascending: false }).limit(1).maybeSingle();
  if (!a) return null;
  const { data: p } = await admin.from("ready_check_payments").select("*").eq("acceptance_id", a.id).maybeSingle();
  return p ? publicState(a as Record<string, unknown>, p as Record<string, unknown>, current) : null;
}

export async function readyCheckAcceptanceState(token: unknown) {
  const ctx = await secureContext(token);
  return ctx ? loadAcceptance(ctx.link.job_id, ctx.estimate) : null;
}

/** Idempotent per job + estimate. A changed estimate requires reconfirmation; a paid Ready Check is never re-charged. */
export async function acceptReadyCheck(token: unknown, meta: RequestMeta = {}) {
  const ctx = await secureContext(token);
  if (!ctx) throw new Error("Estimate unavailable");
  const existing = await loadAcceptance(ctx.link.job_id, ctx.estimate);
  if (existing && !existing.stale) return existing;
  if (existing?.paymentStatus === "paid") throw new Error("Your Ready Check payment is already recorded and will be credited toward your project.");
  const cost = costAfterDiscount(ctx.estimate);
  if (cost == null) throw new Error("The current estimate cannot be accepted.");
  const remaining = readyCheckRemaining(cost);
  const snapshot = {
    estimate_id: ctx.estimate.id, estimate_input_signature: ctx.estimate.input_signature, settings_version: ctx.estimate.settings_version,
    cost_after_discount_inc_gst: cost, estimated_discount_inc_gst: Number(ctx.estimate.applied_discount), ready_check_amount_inc_gst: READY_CHECK_FEE,
    estimated_remaining_balance_inc_gst: remaining, labels: CUSTOMER_QUOTE_LABELS, payment_copy: CUSTOMER_PAYMENT_COPY, ready_check: CUSTOMER_READY_CHECK,
  };
  const { error } = await admin.rpc("accept_ready_check_test", {
    _job_id: ctx.link.job_id, _estimate_id: ctx.estimate.id, _estimate_input_signature: ctx.estimate.input_signature,
    _estimate_settings_version: ctx.estimate.settings_version, _cost_after_discount: cost, _estimated_discount: Number(ctx.estimate.applied_discount),
    _estimated_remaining: remaining, _copy_version: READY_CHECK_COPY_VERSION, _snapshot: snapshot as unknown as Json,
    _accepted_ip: meta.ip ?? undefined, _accepted_user_agent: meta.userAgent ?? "",
  });
  if (error) throw new Error(error.message);
  const created = await loadAcceptance(ctx.link.job_id, ctx.estimate);
  if (!created) throw new Error("Ready Check acceptance unavailable");
  return created;
}

/** Test-only state machine. No card data, no gateway, no Xero, no invoice, no deposit, no PIESA. */
export async function simulateReadyCheckPayment(token: unknown, outcome: TestPaymentOutcome, idempotencyKey: string) {
  const ctx = await secureContext(token);
  if (!ctx) throw new Error("Estimate unavailable");
  const state = await loadAcceptance(ctx.link.job_id, ctx.estimate);
  if (!state) throw new Error("Accept the Ready Check before payment.");
  if (state.stale) throw new Error("Your estimate changed. Please review and accept the updated estimate before paying.");
  if (state.paymentStatus === "paid") return state;
  const next = testPaymentTransition(state.paymentStatus, outcome);
  const { data: result, error } = await admin.rpc("apply_ready_check_test_payment", { _payment_id: state.paymentId, _idempotency_key: idempotencyKey, _outcome: outcome });
  if (error) throw new Error(error.message);
  if (next === "paid" && result?.[0]?.changed) await advanceAfterReadyCheckPayment(ctx.link.job_id, state.paymentId);
  const updated = await loadAcceptance(ctx.link.job_id, ctx.estimate);
  if (!updated) throw new Error("Ready Check payment unavailable");
  return updated;
}

/** Advances ONCE to Ready Check scheduling. Uses the central transition(); never touches PIESA, quotes, Xero or deposits. */
async function advanceAfterReadyCheckPayment(jobId: string, paymentId: string) {
  const { transition, getStage, WorkflowError } = await import("./workflow.server");
  const from = await getStage(jobId);
  if (from === READY_CHECK_PAID_STAGE) return;
  try {
    if (from === "new_enquiry" || from === "eligibility_review") await transition(jobId, "preliminary_estimate_ready", null, "Preliminary estimate issued", { audit_key: `preliminary_ready:${paymentId}` });
    await transition(jobId, READY_CHECK_PAID_STAGE, null, "$99 Ready Check paid — ready to schedule", { payment_id: paymentId, audit_key: `ready_check_ready:${paymentId}` }, { nextAction: READY_CHECK_PAID_NEXT_ACTION });
  } catch (e) {
    if (!(e instanceof WorkflowError)) throw e;
    const { logEvent } = await import("./workflow.server");
    await logEvent(jobId, null, "ready_check_advance_blocked", `Ready Check paid but job could not advance from ${from}`, { payment_id: paymentId, reason: e.message }, { internal: true });
  }
}
