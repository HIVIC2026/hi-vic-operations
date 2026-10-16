import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { declaredExtras } from "./enquiry.core";
import { normaliseInsulation } from "./eligibility.core";
import { groupBMediaForJob } from "./group-b-media.server";
import { groupBInvitationBlocker } from "./group-b-media.core";
import { automaticLeadEmail } from "./enquiry-groups.core";

export type LeadEmailRouteResult = { route: "offer_spot" | "request_insulation" | "ineligible" | "none"; sent: boolean; reason: string };

/** Read-only: the single post-Gate-1 selector's choice for this job (null = job not found). Sends nothing.
 *  Shared by the automatic router below and the Office manual-email preparation (STEP 17). */
export async function selectLeadEmailRoute(jobId: string) {
  const [{ data: job }, { data: work }] = await Promise.all([
    admin.from("jobs").select("source, channel, eligibility_outcome, eligibility_decision_source, eligibility_review_required, estimated_area_m2, estimated_area_unknown, properties(enrichment)").eq("id", jobId).maybeSingle(),
    admin.from("post_intake_work").select("id").eq("job_id", jobId).in("status", ["queued", "processing", "retry"]).limit(1).maybeSingle(),
  ]);
  if (!job) return null;
  const property = job.properties as { enrichment: Record<string, unknown> | null } | null;
  const base44 = (property?.enrichment?.["base44"] ?? {}) as { raw?: { answers?: Record<string, unknown> } };
  return automaticLeadEmail({
    source: job.source, channel: job.channel, decisionSource: job.eligibility_decision_source,
    reviewRequired: !!job.eligibility_review_required, outcome: job.eligibility_outcome,
    intakeWorkActive: !!work, declaredInsulation: normaliseInsulation(declaredExtras(base44.raw?.answers ?? null).existing_insulation),
    ownerEnteredArea: !job.estimated_area_unknown && Number(job.estimated_area_m2) > 0,
  });
}

/** The single post-Gate-1 email selector. Individual senders retain delivery, consent, opt-out and idempotency guards. */
export async function maybeAutoRouteLeadEmail(jobId: string): Promise<LeadEmailRouteResult> {
  try {
    const route = await selectLeadEmailRoute(jobId);
    if (!route) return { route: "none", sent: false, reason: "Job not found" };
    if (route.email === "none") return { route: "none", sent: false, reason: route.blocker ?? "No email route" };
    if (route.email === "offer_spot") {
      const { syncStep3 } = await import("./estimatelink.server");
      await syncStep3(jobId, null);
      // S102 service-area filter (automatic ONLY): a Save-my-spot email is auto-sent only when service
      // coverage can be POSITIVELY established from existing records. Otherwise the customer is left
      // for Office manual review — never auto-sent. Manual Office sending is not gated here.
      const { serviceCoverageEstablished, SERVICE_AREA_REASON } = await import("./service-coverage.server");
      if (!(await serviceCoverageEstablished(jobId))) return { route: "none", sent: false, reason: SERVICE_AREA_REASON };
      // S103 Office-configurable automatic sending rules: additional restrictions only. Missing,
      // unreadable, invalid or disabled configuration means NOTHING is automatically sent. This gate
      // never authorises delivery on its own — the COM-04 switches and every sender guard still apply
      // inside sendSaveMySpot, and it never widens what the single selector above already allows.
      const { automaticSaveSpotGate } = await import("./save-spot-rules.server");
      const gate = await automaticSaveSpotGate(jobId, { route: "offer_spot", coverageVerified: true });
      if (!gate.allowed) return { route: "none", sent: false, reason: gate.reason };
      const { sendSaveMySpot } = await import("./hot-leads-send.server");
      const result = (await sendSaveMySpot([jobId], null, route.assumedArea ? { automaticInitial: true } : {}))[0];
      return { route: route.email, sent: result?.outcome === "sent", reason: result?.detail ?? "No send result" };
    }
    if (route.email === "request_insulation") {
      const blocker = groupBInvitationBlocker(await groupBMediaForJob(jobId));
      if (blocker) return { route: "none", sent: false, reason: blocker };
      const { syncStep3 } = await import("./estimatelink.server");
      await syncStep3(jobId, null);
      const { sendAutomaticInsulationDetails } = await import("./hot-leads-send.server");
      const result = await sendAutomaticInsulationDetails(jobId);
      return { route: route.email, sent: result.outcome === "sent", reason: result.detail };
    }
    const { sendDecisionIneligibleEmail } = await import("./followups.server");
    const result = await sendDecisionIneligibleEmail(jobId);
    return { route: route.email, sent: result.sent, reason: result.sent ? "Sent" : result.reason };
  } catch (error) {
    console.warn("automatic lead email route failed", (error as Error).message.slice(0, 200));
    return { route: "none", sent: false, reason: "Automatic email failed" };
  }
}