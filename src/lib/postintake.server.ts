// Durable post-intake processor: initial Property Intelligence (complete/partial/error), then ONE authoritative Gate 1.
// Called by the scheduled worker route and (best-effort) right after the webhook response. Never sends communications.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { addressHash, STALE_AFTER_DAYS } from "./intelligence.core";
import { ACTIVE, LEASE_SECONDS, PROCESSING_NEXT_ACTION, WORK_TYPE, afterFailure, planEnqueue, retryDelayMs } from "./postintake.core";

type Claimed = { id: string; job_id: string; attempts: number; locked_at: string; facts_version: string; reason: string | null };

/** Idempotent per job: unchanged facts never create or reset work; changed facts requeue the single row. */
export async function enqueueInitialGate1(jobId: string, factsVersion: string, reason: string) {
  const { data: existing } = await admin.from("post_intake_work").select("id, status, facts_version, attempts").eq("job_id", jobId).eq("work_type", WORK_TYPE).maybeSingle();
  const plan = planEnqueue(existing, factsVersion);
  if (plan === "insert") {
    const { error } = await admin.from("post_intake_work").insert({ job_id: jobId, work_type: WORK_TYPE, facts_version: factsVersion, reason });
    if (error && !/duplicate/i.test(error.message)) throw new Error(error.message);
  } else if (plan === "requeue") {
    // Clearing locked_at means any in-flight worker's completion no longer matches and is discarded.
    await admin.from("post_intake_work").update({ status: "queued", facts_version: factsVersion, reason, attempts: 0, available_at: new Date().toISOString(), locked_at: null, lease_expires_at: null, last_error: null, completed_at: null }).eq("id", existing!.id);
  }
  if (plan !== "none") {
    const { data: j } = await admin.from("jobs").select("eligibility_decision_source").eq("id", jobId).single();
    if (j?.eligibility_decision_source !== "admin") await admin.from("jobs").update({ next_action: PROCESSING_NEXT_ACTION }).eq("id", jobId);
  }
  return plan;
}

/** True while initial checks are queued/processing/retrying — Gate 1 must not be persisted by other paths meanwhile. */
export async function initialChecksPending(jobId: string): Promise<boolean> {
  const { data } = await admin.from("post_intake_work").select("id").eq("job_id", jobId).in("status", [...ACTIVE]).limit(1);
  return (data ?? []).length > 0;
}

/** Claim due items (SKIP LOCKED lease) and process them. Safe to call concurrently from many workers. */
export async function processPostIntakeWork(opts: { jobId?: string; limit?: number } = {}) {
  const recovered = 0; // property intelligence retired: no runs to recover
  const { data, error } = await admin.rpc("claim_post_intake_work", { _limit: opts.limit ?? 5, _lease_seconds: LEASE_SECONDS, ...(opts.jobId ? { _job: opts.jobId } : {}) });
  if (error) throw new Error(error.message);
  const results: { id: string; job_id: string; status: string; error?: string }[] = [];
  for (const item of (data ?? []) as Claimed[]) results.push(await processItem(item));
  return { recovered, claimed: results.length, results };
}

async function processItem(item: Claimed) {
  const mine = (patch: TablesUpdate<"post_intake_work">) => admin.from("post_intake_work").update(patch).eq("id", item.id).eq("locked_at", item.locked_at);
  try {
    const { data: p } = await admin.from("jobs").select("properties(address_line, suburb, postcode)").eq("id", item.job_id).single();
    const pr = p?.properties as { address_line: string; suburb: string | null; postcode: string | null } | null;
    if (pr) {
      // Property intelligence retired (4 Oct 2026): no remote lookups; Gate 1 uses homeowner answers only.
      try { const { regenerateEscNotification } = await import("./esc.server"); await regenerateEscNotification(item.job_id, null); } catch { /* never block Gate 1 */ }
    }
    // The ONE official initial categorisation, after the intelligence attempt, then safe progression.
    const { autoDecideEligibility } = await import("./eligibility.server");
    await autoDecideEligibility(item.job_id, { initialProcessor: true });
    // Step 3 preparation after the official Gate 1 decision, BEFORE completing. A failure retries the item; Gate 1 is never rolled back.
    const { syncStep3 } = await import("./estimatelink.server");
    await syncStep3(item.job_id, null);
    const { error: ce } = await mine({ status: "complete", completed_at: new Date().toISOString(), locked_at: null, lease_expires_at: null, last_error: null });
    if (ce) throw new Error(ce.message);
    // The item is already complete: follow-ups are best-effort and must never be reported as a retry that can no
    // longer happen (the retry update would match no row once locked_at is cleared). Failures are logged; the job is
    // picked up again by the next trigger or the office sweep.
    try {
      const { maybeAutoRouteLeadEmail } = await import("./lead-email-routing.server");
      await maybeAutoRouteLeadEmail(item.job_id); // one automatic route; best-effort and idempotent
    } catch (e) { console.error("post-intake lead email route failed", item.job_id, (e as Error).message); }
    try {
      const { autoAdvanceJob } = await import("./autoadvance.server");
      await autoAdvanceJob(item.job_id, null, "initial checks complete");
    } catch (e) { console.error("post-intake auto-advance failed", item.job_id, (e as Error).message); }
    return { id: item.id, job_id: item.job_id, status: "complete" };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 500);
    const status = afterFailure(item.attempts);
    await mine({ status, last_error: msg, available_at: new Date(Date.now() + retryDelayMs(item.attempts)).toISOString(), locked_at: null, lease_expires_at: null });
    return { id: item.id, job_id: item.job_id, status, error: msg };
  }
}

/** Admin observability for one job. */
export async function postIntakeStatus(jobId: string) {
  const { data } = await admin.from("post_intake_work").select("status, attempts, last_error, available_at, updated_at, completed_at, reason").eq("job_id", jobId).eq("work_type", WORK_TYPE).maybeSingle();
  return data ?? null;
}

/** Record one worker tick so admins can see the scheduler is alive. */
export async function recordWorkerRun(result: { recovered: number; claimed: number; failed: number }, error?: string) {
  await admin.from("external_sync_logs").insert({
    system: "post_intake_worker", direction: "inbound", entity_type: "worker_run",
    status: error ? "error" : "synced", error: error ?? null,
    payload: { recovered: result.recovered, claimed: result.claimed, failed: result.failed },
  });
}

/** Admin health snapshot: queue counts by state + latest worker tick. */
export async function postIntakeHealth() {
  const now = new Date().toISOString();
  const { data: rows } = await admin.from("post_intake_work").select("status, lease_expires_at, available_at").eq("work_type", WORK_TYPE);
  const counts = { queued: 0, running: 0, stale: 0, failed: 0, retry_waiting: 0, complete: 0 };
  for (const r of rows ?? []) {
    if (r.status === "processing") {
      if (r.lease_expires_at && r.lease_expires_at < now) counts.stale++;
      else counts.running++;
    } else if (r.status === "queued") counts.queued++;
    else if (r.status === "retry") counts.retry_waiting++;
    else if (r.status === "failed") counts.failed++;
    else if (r.status === "complete") counts.complete++;
  }
  const { data: last } = await admin.from("external_sync_logs").select("created_at, status, error, payload").eq("system", "post_intake_worker").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return { counts, lastWorkerRun: last ?? null };
}

/** Best-effort customer email after Step 3 preparation. Blocked states (comms OFF, delivery disabled, no consent) are normal. Never throws. */
export async function attemptCustomerEmail(jobId: string) {
  try {
    const { refreshIndicativeEstimate } = await import("./estimate.server");
    const { linkAllowed } = await import("./estimatelink.core");
    const f = await import("./followups.server");
    const view = await refreshIndicativeEstimate(jobId);
    if (linkAllowed(view.mode)) return await f.sendInitialEstimateEmail(jobId, null);
    if (view.mode === "none_ineligible") return await f.sendPreliminaryIneligibleEmail(jobId, null);
    return { sent: false as const, reason: view.mode === "withheld_review" ? "eligibility_review_required" : "official_decision_not_recorded" };
  } catch (e) {
    console.warn("post-intake customer email attempt failed (ignored)", (e as Error).message.slice(0, 200));
    return { sent: false as const, reason: "error" };
  }
}
