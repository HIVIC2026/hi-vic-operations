// Office one-job no-insulation Save your spot offer after a recorded "no insulation" photo review. Uses the approved
// T1/T2 Save my spot sender (sendSaveMySpot) and its once-per-home key, consent, opt-out and switch guards.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { noInsulationOfferBlocker } from "./enquiry-response.core";
import type { HotSendResult } from "./hot-leads-send.server";

export type NoInsulationOfferResult = HotSendResult & { needsEstimate?: boolean };

export async function noInsulationOffer(jobId: string, actorId: string | null, mode: "preview" | "prepare" | "send"): Promise<NoInsulationOfferResult> {
  const [job, review, estimate] = await Promise.all([
    admin.from("jobs").select("job_number, source, stage, eligibility_outcome, eligibility_decision_source, eligibility_review_required").eq("id", jobId).maybeSingle(),
    admin.from("customer_engagement_events").select("metadata").eq("job_id", jobId).eq("event_type", "intake_media_reviewed").eq("source", "office").order("occurred_at", { ascending: false }).limit(1),
    admin.from("indicative_estimates").select("insulation_declared").eq("job_id", jobId).eq("status", "current").maybeSingle(),
  ]);
  const base = { jobId, jobNumber: job.data?.job_number ?? null };
  if (job.error || review.error || estimate.error || !job.data) return { ...base, outcome: "blocked", detail: "Could not verify the enquiry. Nothing sent; try again." };
  const blocker = noInsulationOfferBlocker({ source: job.data.source, stage: job.data.stage, outcome: job.data.eligibility_outcome, decisionSource: job.data.eligibility_decision_source, reviewRequired: !!job.data.eligibility_review_required, latestReview: (review.data?.[0]?.metadata as { outcome?: string } | null)?.outcome ?? null });
  if (blocker) return { ...base, outcome: "blocked", detail: blocker };
  const estimateReady = estimate.data?.insulation_declared === "none";
  if (mode === "prepare") {
    // Explicit Office step: recalculates the estimate on the reviewed no-insulation fact (raw answer untouched). No email.
    const { refreshIndicativeEstimate } = await import("./estimate.server");
    const { syncStep3 } = await import("./estimatelink.server");
    await refreshIndicativeEstimate(jobId);
    await syncStep3(jobId, actorId);
    return { ...base, outcome: "skipped", detail: "Estimate updated to no insulation. No email sent — preview, then send." };
  }
  if (!estimateReady) return { ...base, outcome: "blocked", needsEstimate: true, detail: "The estimate still uses the homeowner’s original insulation answer. Update the estimate first (no email is sent)." };
  const { sendSaveMySpot } = await import("./hot-leads-send.server");
  const [result] = await sendSaveMySpot([jobId], actorId, mode === "preview" ? { mode: "preview" } : {});
  return result ?? { ...base, outcome: "failed", detail: "No send result" };
}
