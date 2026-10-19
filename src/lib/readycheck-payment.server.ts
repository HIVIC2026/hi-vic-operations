// Free Home Insulation Ready Check request. Separate from quotes, invoices, deposits and Xero.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { CUSTOMER_PAYMENT_COPY, CUSTOMER_QUOTE_LABELS, CUSTOMER_READY_CHECK } from "./customer-quote-system";
import { READY_CHECK_COPY_VERSION, READY_CHECK_FEE, READY_CHECK_PAID_NEXT_ACTION, READY_CHECK_PAID_STAGE, acceptanceIsCurrent, readyCheckRemaining, type ReadyCheckAcceptanceState, type TestPaymentOutcome } from "./readycheck.core";
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

function publicState(a: Record<string, unknown>, current: Identity): ReadyCheckAcceptanceState {
  return {
    acceptanceId: String(a["id"]), estimateId: String(a["estimate_id"]), acceptedAt: String(a["accepted_at"]),
    paymentId: null, paymentStatus: "accepted", amountIncGst: READY_CHECK_FEE,
    estimatedRemainingBalanceIncGst: readyCheckRemaining(Number(a["cost_after_discount_inc_gst"])), paidAt: null,
    stale: !current || !acceptanceIsCurrent(String(a["estimate_id"]), current.id)
      || String(a["estimate_input_signature"]) !== current.input_signature
      || Number(a["estimate_settings_version"]) !== current.settings_version,
  };
}

async function loadAcceptance(jobId: string, current: Identity) {
  const { data: a } = await admin.from("ready_check_acceptances").select("*").eq("job_id", jobId).order("accepted_at", { ascending: false }).limit(1).maybeSingle();
  if (!a) return null;
  return publicState(a as Record<string, unknown>, current);
}

export async function readyCheckAcceptanceState(token: unknown) {
  const ctx = await secureContext(token);
  return ctx ? loadAcceptance(ctx.link.job_id, ctx.estimate) : null;
}

/** Job for a usable estimate link (owner no-login pages). */
export async function jobIdForToken(token: unknown): Promise<string | null> {
  const ctx = await secureContext(token);
  return ctx?.link.job_id ?? null;
}

type WindowPick = { date: string; slot: import("./piesa-windows.core").PiesaSlot };

/** Idempotent per job + estimate. A changed estimate requires reconfirmation.
 *  picks: the owner's 3–5 Ready Check times, validated BEFORE anything is recorded. */
export async function acceptReadyCheck(token: unknown, meta: RequestMeta = {}, picks?: WindowPick[]) {
  const ctx = await secureContext(token);
  if (!ctx) throw new Error("Estimate unavailable");
  const existing = await loadAcceptance(ctx.link.job_id, ctx.estimate);
  if (existing && !existing.stale) return existing;
  const cost = costAfterDiscount(ctx.estimate);
  if (cost == null) throw new Error("The current estimate cannot be accepted.");
  // Price seen first: this link must have shown the estimate (view recorded) before booking.
  const { priceSeenBlocker } = await import("./readycheck-booking.core");
  const { data: lv } = await admin.from("customer_estimate_links").select("view_count").eq("id", ctx.link.id).maybeSingle();
  const seen = priceSeenBlocker({ hasEstimate: true, estimateViewed: (lv?.view_count ?? 0) > 0 });
  if (seen) throw new Error(seen);
  if (picks) {
    const { piesaWindowBlockers } = await import("./piesa-windows.core");
    const b = piesaWindowBlockers(picks);
    if (b.length) throw new Error(b.join(" "));
  }
  const fee = READY_CHECK_FEE;
  const remaining = readyCheckRemaining(cost, fee);
  const snapshot = {
    estimate_id: ctx.estimate.id, estimate_input_signature: ctx.estimate.input_signature, settings_version: ctx.estimate.settings_version,
    cost_after_discount_inc_gst: cost, estimated_discount_inc_gst: Number(ctx.estimate.applied_discount), ready_check_amount_inc_gst: fee,
    estimated_remaining_balance_inc_gst: remaining, labels: CUSTOMER_QUOTE_LABELS, payment_copy: CUSTOMER_PAYMENT_COPY, ready_check: CUSTOMER_READY_CHECK,
  };
  const { error } = await admin.from("ready_check_acceptances").insert({
    job_id: ctx.link.job_id, estimate_id: ctx.estimate.id, estimate_input_signature: ctx.estimate.input_signature,
    estimate_settings_version: ctx.estimate.settings_version, cost_after_discount_inc_gst: cost,
    estimated_discount_inc_gst: Number(ctx.estimate.applied_discount), ready_check_amount_inc_gst: fee,
    estimated_remaining_balance_inc_gst: remaining, copy_version: READY_CHECK_COPY_VERSION, snapshot: snapshot as unknown as Json,
    accepted_ip: meta.ip ?? null, accepted_user_agent: meta.userAgent ?? null,
  });
  if (error) throw new Error(error.message);
  const created = await loadAcceptance(ctx.link.job_id, ctx.estimate);
  if (!created) throw new Error("Ready Check acceptance unavailable");
  await advanceAfterReadyCheckAcceptance(ctx.link.job_id, created.acceptanceId);
  if (picks) {
    try {
      const { submitReadyCheckWindows } = await import("./readycheck-booking.server");
      await submitReadyCheckWindows(ctx.link.job_id, picks);
    } catch (e) {
      const { logEvent } = await import("./workflow.server");
      await logEvent(ctx.link.job_id, null, "ready_check_windows_not_saved", `Owner's Ready Check times could not be saved: ${(e as Error).message}`, {}, { internal: true });
    }
  }
  return created;
}

/** Retained only to fail old preview callers safely. */
export async function simulateReadyCheckPayment(_token: unknown, _outcome: TestPaymentOutcome, _idempotencyKey: string) {
  throw new Error("The Ready Check is free. No payment is required.");
}

/** Advances ONCE to Ready Check scheduling. Never touches PIESA, quotes, Xero or deposits. */
async function advanceAfterReadyCheckAcceptance(jobId: string, acceptanceId: string) {
  const { transition, getStage, WorkflowError } = await import("./workflow.server");
  const from = await getStage(jobId);
  if (from === READY_CHECK_PAID_STAGE) return;
  try {
    if (from === "new_enquiry" || from === "eligibility_review") await transition(jobId, "preliminary_estimate_ready", null, "Preliminary estimate issued", { audit_key: `preliminary_ready:${acceptanceId}` });
    await transition(jobId, READY_CHECK_PAID_STAGE, null, "Free Ready Check requested — ready to schedule", { acceptance_id: acceptanceId, audit_key: `ready_check_ready:${acceptanceId}` }, { nextAction: READY_CHECK_PAID_NEXT_ACTION });
  } catch (e) {
    if (!(e instanceof WorkflowError)) throw e;
    const { logEvent } = await import("./workflow.server");
    await logEvent(jobId, null, "ready_check_advance_blocked", `Free Ready Check requested but job could not advance from ${from}`, { acceptance_id: acceptanceId, reason: e.message }, { internal: true });
  }
}
