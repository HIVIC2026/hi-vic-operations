// Retry scheduling only. The existing router and senders remain the sole delivery boundary, including their
// consent, activation, same-home, exclusion and uncertain-outcome guards. A durable due-time queue prevents held
// older jobs from taking every tick. Atomic token claims fence concurrent workers; every RPC error is visible.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { sweepEligible } from "./automatic-first-response.core";

export const SWEEP_BATCH = 5;
export const HELD_EVENT = "automatic_first_response_held";

type RetryClaim = {
  job_id: string; job_number: string | null; created_at: string; source: string; channel: string;
  business_unit: string; office_bucket: string; needs_first_response: boolean; claim_token: string;
};

async function retryRpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  // The pending migration's RPCs are service-only. Regenerate database types when that migration is registered.
  const { data, error } = await admin.rpc(name as never, args as never);
  if (error) throw new Error(`First-response retry ${name} failed: ${error.message}`);
  return data;
}

async function finish(claim: RetryClaim, outcome: "sent" | "held", route: string, reason: string) {
  // Ledger completion and a changed internal held-reason event commit in one database transaction.
  // Do not swallow failures: the claim remains recoverable and the worker reports failure.
  const saved = await retryRpc("finish_first_response_retry", {
    p_job_id: claim.job_id, p_claim_token: claim.claim_token, p_outcome: outcome,
    p_route: route, p_reason: reason,
  });
  if (saved !== true) throw new Error("First-response retry outcome was not recorded.");
}

export async function sweepUnansweredFirstResponses(limit = SWEEP_BATCH) {
  if (!Number.isInteger(limit) || limit < 1 || limit > SWEEP_BATCH) throw new Error("First-response retry limit must be between 1 and 5.");
  const { readAutomaticRules } = await import("./save-spot-rules.server");
  const rules = await readAutomaticRules();
  if (rules.state !== "ok") throw new Error(`First-response retry rules unavailable: ${rules.reason}`);
  if (!rules.config.enabled || !rules.config.activatedAt) return { checked: 0, sent: 0 };
  const activatedAt = rules.config.activatedAt;
  if (!Number.isFinite(Date.parse(activatedAt))) throw new Error("First-response activation time is invalid.");
  const claimed = await retryRpc("claim_first_response_retries", { p_activated_at: activatedAt, p_limit: limit });
  if (!Array.isArray(claimed)) throw new Error("First-response retry claims could not be read.");
  const { maybeAutoRouteLeadEmail } = await import("./lead-email-routing.server");
  let checked = 0, sent = 0;
  for (const claim of claimed as RetryClaim[]) {
    // Defence in depth against an unexpected RPC shape or an enquiry ageing out after selection.
    if (!claim.job_id || !claim.claim_token) throw new Error("First-response retry returned an invalid claim.");
    if (claim.channel !== "hivic_sourced" || claim.business_unit !== "hivic" ||
      !sweepEligible(claim, activatedAt) || Date.parse(claim.created_at) > Date.now()) {
      await finish(claim, "held", "none", "Enquiry is no longer in the automatic first-response scope.");
      continue;
    }
    // Recheck current scope and active intake, and renew only THIS unexpired claim before the existing router.
    const ready = await retryRpc("start_first_response_retry", {
      p_job_id: claim.job_id, p_claim_token: claim.claim_token, p_activated_at: activatedAt,
    });
    if (ready === false) {
      await finish(claim, "held", "none", "Enquiry is no longer eligible, or initial intake is still active.");
      continue;
    }
    if (ready !== true) throw new Error("First-response retry safety recheck was unavailable.");
    checked++;
    let result: Awaited<ReturnType<typeof maybeAutoRouteLeadEmail>>;
    try {
      result = await maybeAutoRouteLeadEmail(claim.job_id);
    } catch (error) {
      await finish(claim, "held", "none", "The guarded response router failed; review the worker error before retrying.");
      throw error;
    }
    await finish(claim, result.sent ? "sent" : "held", result.route, result.reason);
    if (result.sent) sent++;
  }
  return { checked, sent };
}
