// Durable retry for automatic INITIAL enquiry responses. The post-intake worker routes each enquiry once; anything held
// then (media still importing, a transient read failure, a confirmed provider failure) is re-routed here on each worker
// tick until it is answered or ages out. Every send still goes through maybeAutoRouteLeadEmail and its senders, so all
// activation, consent, opt-out, exclusion, duplicate, media and once-per-home guards apply. Held reasons are recorded
// on the job (internal event, only when the reason changes) so nothing is silently held forever.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { sweepEligible } from "./automatic-first-response.core";

export const SWEEP_BATCH = 5;
export const HELD_EVENT = "automatic_first_response_held";

export async function sweepUnansweredFirstResponses(limit = SWEEP_BATCH) {
  const { readAutomaticRules } = await import("./save-spot-rules.server");
  const rules = await readAutomaticRules();
  if (rules.state !== "ok" || !rules.config.enabled || !rules.config.activatedAt) return { checked: 0, sent: 0 };
  const activatedAt = rules.config.activatedAt;
  const since = new Date(Math.max(Date.parse(activatedAt), Date.now() - 14 * 86_400_000)).toISOString();
  const { data, error } = await admin.from("office_enquiry_index")
    .select("id, job_number, created_at, needs_first_response, office_bucket, source")
    .eq("source", "base44").eq("channel", "hivic_sourced").eq("office_bucket", "enquiry").eq("needs_first_response", true)
    .gte("created_at", since).order("created_at", { ascending: true }).limit(50);
  if (error) throw new Error(`First-response sweep could not read enquiries: ${error.message}`);
  const { maybeAutoRouteLeadEmail } = await import("./lead-email-routing.server");
  const { logEvent } = await import("./workflow.server");
  let checked = 0, sent = 0;
  for (const row of (data ?? []).filter((r) => sweepEligible(r, activatedAt))) {
    if (checked >= limit) break;
    if (!row.id) continue;
    // Intake still running: the worker routes it when complete.
    const work = await admin.from("post_intake_work").select("id").eq("job_id", row.id).in("status", ["queued", "processing", "retry"]).limit(1);
    if (work.error || work.data?.length) continue;
    checked++;
    const result = await maybeAutoRouteLeadEmail(row.id);
    if (result.sent) { sent++; continue; }
    const last = await admin.from("workflow_events").select("details").eq("job_id", row.id).eq("event_type", HELD_EVENT).order("created_at", { ascending: false }).limit(1);
    const lastReason = (last.data?.[0]?.details as { reason?: string } | null)?.reason;
    if (!last.error && lastReason !== result.reason) {
      await logEvent(row.id, null, HELD_EVENT, `Automatic first response not sent yet: ${result.reason}`.slice(0, 300), { reason: result.reason, route: result.route }, { internal: true }).catch(() => null);
    }
  }
  return { checked, sent };
}
