import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { declaredExtras, insulationDetailRoute } from "./enquiry.core";
import { normaliseInsulation } from "./eligibility.core";
import { groupBMediaForJob } from "./group-b-media.server";
import { groupBInitialAction } from "./group-b-media.core";
import { automaticLeadEmail, effectiveInsulation, ineligibleReplyBlocker } from "./enquiry-groups.core";

export type LeadEmailRouteResult = { route: "offer_spot" | "request_insulation" | "ineligible" | "none"; sent: boolean; reason: string };

/** Read-only: the single post-Gate-1 selector's choice for this job (null = job not found). Sends nothing.
 *  Shared by the automatic router below and the Office manual-email preparation (STEP 17). */
export async function selectLeadEmailRoute(jobId: string) {
  const [{ data: job }, { data: work }, { data: review }] = await Promise.all([
    admin.from("jobs").select("source, channel, eligibility_outcome, eligibility_decision_source, eligibility_review_required, estimated_area_m2, estimated_area_unknown, properties(enrichment)").eq("id", jobId).maybeSingle(),
    admin.from("post_intake_work").select("id").eq("job_id", jobId).in("status", ["queued", "processing", "retry"]).limit(1).maybeSingle(),
    admin.from("customer_engagement_events").select("metadata").eq("job_id", jobId).eq("event_type", "intake_media_reviewed").order("occurred_at", { ascending: false }).limit(1),
  ]);
  if (!job) return null;
  const latestOutcome = (review?.[0]?.metadata as { outcome?: string } | null | undefined)?.outcome ?? null;
  const property = job.properties as { enrichment: Record<string, unknown> | null } | null;
  const base44 = (property?.enrichment?.["base44"] ?? {}) as { raw?: { answers?: Record<string, unknown> } };
  const extras = declaredExtras(base44.raw?.answers ?? null);
  return automaticLeadEmail({
    source: job.source, channel: job.channel, decisionSource: job.eligibility_decision_source,
    reviewRequired: !!job.eligibility_review_required, outcome: job.eligibility_outcome,
    intakeWorkActive: !!work, declaredInsulation: effectiveInsulation(normaliseInsulation(extras.existing_insulation), latestOutcome),
    ownerEnteredArea: !job.estimated_area_unknown && Number(job.estimated_area_m2) > 0,
    // A recorded Office photo review always outranks the owner's own description.
    insulationDetailRoute: latestOutcome ? null : insulationDetailRoute(extras),
  });
}

/** The single post-Gate-1 email selector. Individual senders retain delivery, consent, opt-out and idempotency guards. */
export async function maybeAutoRouteLeadEmail(jobId: string, ctx: import("./manual-backlog.core").LeadRouteContext = {}): Promise<LeadEmailRouteResult> {
  try {
    const { readAutomaticRules } = await import('./save-spot-rules.server');
    const { automaticFirstResponseStatus, automaticFirstResponseBlocker } = await import('./automatic-first-response.core');
    const activation = await readAutomaticRules();
    const status = automaticFirstResponseStatus(activation.state === 'ok' && activation.config.enabled, activation.state === 'ok' ? activation.config.activatedAt : null);
    if (!status.on) return { route: 'none', sent: false, reason: status.reason };
    const { EXPLICITLY_EXCLUDED_JOBS } = await import('./automatic-first-response.core');
    const { initialResponseHistoryBlocker } = await import('./initial-response-history.server');
    // Any own-job send (any purpose), uncertain attempt or customer-visible outbound correspondence blocks a resend.
    const [creation, historyBlocker] = await Promise.all([
      admin.from('jobs').select('created_at, job_number').eq('id', jobId).maybeSingle(),
      initialResponseHistoryBlocker(jobId),
    ]);
    if (creation.error) return { route: 'none', sent: false, reason: 'Could not verify first-response safety facts.' };
    if ((EXPLICITLY_EXCLUDED_JOBS as readonly string[]).includes(creation.data?.job_number ?? '')) return { route: 'none', sent: false, reason: 'Explicitly excluded by Jo' };
    const initialBlocker = automaticFirstResponseBlocker({ activatedAt: activation.state === 'ok' ? activation.config.activatedAt : null, createdAt: creation.data?.created_at ?? null, held: false, confirmed: false })
      ?? historyBlocker;
    if (initialBlocker) return { route: 'none', sent: false, reason: initialBlocker };
    const held = await admin.from('post_intake_work').select('id').eq('job_id', jobId).eq('reason', 'ENQUIRY_BACKLOG_MANUAL').eq('facts_version', 'enquiry-backlog-manual').eq('status', 'failed').limit(1);
    if (held.error || held.data?.length) return { route: 'none', sent: false, reason: 'Backlog held for explicit Office release.' };
    const latestReview = await admin.from('customer_engagement_events').select('metadata').eq('job_id', jobId).eq('event_type', 'intake_media_reviewed').eq('source', 'office').order('occurred_at', { ascending: false }).limit(1);
    if (latestReview.error || (latestReview.data?.[0]?.metadata as { manualOnly?: boolean } | undefined)?.manualOnly) return { route: 'none', sent: false, reason: 'Office review recorded; manual next action only.' };
    const { isManualBacklog } = await import("./manual-backlog.core");
    const manualBacklog = isManualBacklog(ctx);
    // Legacy exclusion lists (explicit owner decisions) are checked BEFORE any route or sender call.
    const { data: numbered } = await admin.from("jobs").select("job_number").eq("id", jobId).maybeSingle();
    const { legacyExclusionReason } = await import("./hot-leads.core");
    const excluded = legacyExclusionReason(numbered?.job_number);
    if (excluded) return { route: "none", sent: false, reason: excluded };
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
      const gate = await automaticSaveSpotGate(jobId, { route: "offer_spot", coverageVerified: true, ...(manualBacklog ? { manualBacklog: ctx.manualBacklog } : {}) });
      if (!gate.allowed) return { route: "none", sent: false, reason: gate.reason };
      const { sendSaveMySpot } = await import("./hot-leads-send.server");
      const result = (await sendSaveMySpot([jobId], null, { automaticInitial: true, ...(manualBacklog ? { manualBacklog: ctx.manualBacklog } : {}) }))[0];
      return { route: route.email, sent: result?.outcome === "sent", reason: result?.detail ?? "No send result" };
    }
    if (route.email === "request_insulation") {
      // Re-read both office-owned review facts before requesting evidence again. Missing/error reads
      // never establish approval; the existing media blocker still holds received/uncertain uploads.
      const [response, reviews] = await Promise.all([
        admin.from("lead_campaign_responses").select("desk_check_status").eq("job_id", jobId).maybeSingle(),
        admin.from("customer_engagement_events").select("metadata").eq("job_id", jobId).eq("event_type", "intake_media_reviewed").order("occurred_at", { ascending: false }).limit(1),
      ]);
      if (response.error || reviews.error) return { route: "none", sent: false, reason: "Could not verify insulation review — held for Office review" };
      const latest = reviews.data?.[0]?.metadata as { outcome?: string } | null | undefined;
      if (response.data?.desk_check_status === "looks_eligible" && latest?.outcome === "below_r2") {
        // Reuse the guarded follow-up, not the invitation. It rechecks current review, consent,
        // estimate/link, switches and prior attempts; no trust/date exceptions are forwarded.
        const { sendExistingInsulationSaveSpot } = await import("./hot-leads-send.server");
        const result = await sendExistingInsulationSaveSpot(jobId, null, false);
        return { route: "offer_spot", sent: result.outcome === "sent", reason: result.detail };
      }
      // Received media → approved received-media acknowledgement (no repeat upload, no eligibility decision).
      const initial = groupBInitialAction(await groupBMediaForJob(jobId));
      if ("held" in initial) return { route: "none", sent: false, reason: initial.held };
      const { syncStep3 } = await import("./estimatelink.server");
      await syncStep3(jobId, null);
      const { sendAutomaticInsulationDetails } = await import("./hot-leads-send.server");
      const result = await sendAutomaticInsulationDetails(jobId);
      return { route: route.email, sent: result.outcome === "sent", reason: result.detail };
    }
    // Jo's rule for an automatic ineligible reply: it must state the VERIFIED reason (see ineligibleReplyBlocker).
    const { data: decided } = await admin
      .from("jobs")
      .select("eligibility_outcome, eligibility_reason, eligibility_decision_source, eligibility_review_required")
      .eq("id", jobId)
      .maybeSingle();
    const blocker = ineligibleReplyBlocker({
      outcome: decided?.eligibility_outcome ?? null,
      decisionSource: decided?.eligibility_decision_source ?? null,
      reviewRequired: !!decided?.eligibility_review_required,
      reason: decided?.eligibility_reason ?? null,
    });
    if (blocker) {
      return {
        route: "none",
        sent: false,
        reason: blocker === "ineligible_reason_not_recorded"
          ? "Ineligible reason is not recorded — held for Office review; nothing sent."
          : `Ineligible reply held: ${blocker}`,
      };
    }
    // T7 carries the customer's own secure estimate link; create/refresh it before rendering so the approved
    // template is always available and no legacy copy is needed to fall back to.
    const { syncStep3 } = await import("./estimatelink.server");
    await syncStep3(jobId, null);
    const { sendDecisionIneligibleEmail } = await import("./followups.server");
    const result = await sendDecisionIneligibleEmail(jobId, manualBacklog ? ctx : {});
    return { route: route.email, sent: result.sent, reason: result.sent ? "Sent" : result.reason };
  } catch (error) {
    console.warn("automatic lead email route failed", (error as Error).message.slice(0, 200));
    return { route: "none", sent: false, reason: "Automatic email failed" };
  }
}