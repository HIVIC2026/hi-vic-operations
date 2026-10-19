// P0: one bounded, authoritative answer to "which enquiries can be emailed right now?".
// Shared by the dashboard read (so the button's count cannot drift from what a send would do) and by the
// dispatch/retry actions (so the ids are always recomputed server-side, never taken from the browser).
// Scope matches the approved Save-my-spot (Group A) campaign: website (base44) homeowner enquiries that passed
// Gate 1 as likely eligible and are still in the enquiry phase. Group B / review-required / installer-sourced
// enquiries are deliberately NOT included — they need a different email or a human decision.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { LAUNCH_CAMPAIGN } from "@/lib/launch-campaign.core";

/** One HOT_SEND batch. No dashboard action may ever exceed this. */
export const DISPATCH_BATCH = 10;
/** Upper bound on jobs inspected per call, so no dashboard read scans the whole table. */
export const DISPATCH_POOL = 200;
const CHUNK = 100;
/** Enquiry-phase stages where a Save-my-spot reply is still the correct next customer email. A failed automatic
 *  send leaves the job at whichever of these it reached, so all of them belong in the backlog. */
const ENQUIRY_STAGES = [
  "new_enquiry",
  "eligibility_review",
  "preliminary_estimate_ready",
  "ready_check_ready_to_schedule",
] as const;

function chunk<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function fail(what: string): never {
  throw new Error(`Could not check ${what}. Nothing was sent — try again.`);
}

/** Open enquiries in the Save-my-spot scope, oldest first so an old backlog drains before new enquiries.
 *  Email presence is filtered here because an embedded owner filter is unreliable across PostgREST versions. */
export async function candidateJobIds(limit = DISPATCH_POOL): Promise<string[]> {
  const { data, error } = await admin
    .from("jobs")
    .select("id, owners(email)")
    .is("deleted_at", null)
    .eq("source", "base44")
    .eq("channel", "hivic_sourced")
    .eq("eligibility_outcome", "likely_eligible")
    .eq("eligibility_review_required", false)
    .in("stage", ENQUIRY_STAGES)
    .order("created_at", { ascending: true })
    .limit(Math.min(Math.max(limit, 1), DISPATCH_POOL * 2));
  if (error) fail("open enquiries");
  return (data ?? [])
    .filter((j) => {
      const email = (j.owners as { email?: string | null } | null)?.email;
      return !!email && email.trim() !== "";
    })
    .map((j) => j.id);
}

/** Filter candidates down to homes that have not been answered, are not in flight, are not suppressed,
 *  and still hold a current preliminary estimate.
 *  NOTE: the secure estimate link is deliberately NOT required here. It is created/renewed by
 *  `ensureEstimateLinks()` immediately before a send (see dispatchEnquiryBacklog / dispatchableIdsWithLink),
 *  because the 30-day link TTL had silently expired every historical backlog link — the readiness check
 *  required a live link, but nothing ever (re)issued one, so "Ready to send" was permanently 0.
 *  Fails closed: an unreadable history never makes a home look sendable. Order is preserved. */
export async function sendableFrom(candidates: string[]): Promise<string[]> {
  if (candidates.length === 0) return [];
  const sent = new Set<string>();
  const inflight = new Set<string>();
  const suppressed = new Set<string>();
  const hasEstimate = new Set<string>();
  for (const part of chunk(candidates)) {
    const [sends, optouts, responses, estimates] = await Promise.all([
      admin.from("customer_email_sends").select("job_id, status").in("job_id", part),
      admin.from("customer_email_optouts").select("job_id, opted_out_at").in("job_id", part),
      admin.from("lead_campaign_responses").select("job_id, opted_out_at").in("job_id", part),
      admin
        .from("indicative_estimates")
        .select("job_id")
        .eq("status", "current")
        .in("job_id", part),
    ]);
    const error = sends.error ?? optouts.error ?? responses.error ?? estimates.error;
    if (error) fail("who is safe to email");
    for (const s of sends.data ?? []) {
      if (s.status === "sent" || s.status === "delivered_unrecorded") sent.add(s.job_id);
      if (s.status === "sending" || s.status === "queued") inflight.add(s.job_id);
    }
    for (const o of optouts.data ?? []) if (o.opted_out_at) suppressed.add(o.job_id);
    for (const r of responses.data ?? []) if (r.opted_out_at) suppressed.add(r.job_id);
    for (const e of estimates.data ?? []) hasEstimate.add(e.job_id);
  }
  return candidates.filter(
    (id) =>
      !sent.has(id) &&
      !inflight.has(id) &&
      !suppressed.has(id) &&
      hasEstimate.has(id),
  );
}

/** (Re)issue the secure Step-3 estimate link for each id, then return only the ids that now hold a usable
 *  link. Idempotent and never sends anything: `syncStep3` reuses a live link and otherwise issues a fresh
 *  one (its 30-day TTL is the only reason historical backlog links stop working). A failure is contained to
 *  that one home — the caller still gets a per-home outcome instead of a whole-batch abort. */
export async function ensureEstimateLinks(jobIds: string[], actorId: string | null = null): Promise<Set<string>> {
  if (jobIds.length === 0) return new Set();
  const { syncStep3 } = await import("./estimatelink.server");
  const { linkUsable } = await import("./estimatelink.core");
  const now = Date.now();
  for (const id of jobIds) {
    try { await syncStep3(id, actorId); } catch { /* contained per-home; verified below */ }
  }
  const { data, error } = await admin
    .from("customer_estimate_links")
    .select("job_id, status, expires_at")
    .eq("purpose", "step3_estimate")
    .in("job_id", jobIds);
  if (error) fail("the prepared estimate links");
  const usable = new Set<string>();
  for (const l of data ?? []) if (linkUsable(l, now)) usable.add(l.job_id);
  return usable;
}

/** The exact ids one dispatch would attempt, capped to a single batch. */
export async function dispatchableJobIds(limit = DISPATCH_BATCH): Promise<string[]> {
  const cap = Math.min(Math.max(limit, 1), DISPATCH_BATCH);
  return (await sendableFrom(await candidateJobIds(DISPATCH_POOL))).slice(0, cap);
}

/** A retry is only ever allowed for a confirmed failed initial attempt that is still in the same scope,
 *  so the retry button can never become a generic "email this home" endpoint. */
export async function isRetryable(jobId: string): Promise<{ ok: boolean; reason: string }> {
  const { data: job, error } = await admin
    .from("jobs")
    .select("deleted_at, source, channel, stage, eligibility_outcome, eligibility_review_required")
    .eq("id", jobId)
    .maybeSingle();
  if (error) fail("this enquiry");
  if (!job || job.deleted_at)
    return { ok: false, reason: "This enquiry is no longer open — nothing was sent." };
  if (
    job.source !== "base44" ||
    job.channel !== "hivic_sourced" ||
    job.eligibility_outcome !== "likely_eligible" ||
    job.eligibility_review_required
  ) {
    return {
      ok: false,
      reason:
        "This enquiry is not in the Save-my-spot scope (review required, Group B or installer-sourced) — nothing was sent.",
    };
  }
  if (!(ENQUIRY_STAGES as readonly string[]).includes(job.stage)) {
    return { ok: false, reason: "This enquiry is past the enquiry stage — nothing was sent." };
  }
  const { data: sends, error: sendError } = await admin
    .from("customer_email_sends")
    .select("id, status")
    .eq("job_id", jobId)
    .eq("purpose", LAUNCH_CAMPAIGN);
  if (sendError) fail("the previous send record");
  if (!(sends ?? []).some((r) => r.status === "failed")) {
    return {
      ok: false,
      reason: "There is no failed send recorded for this home — nothing was sent.",
    };
  }
  return { ok: true, reason: "" };
}
