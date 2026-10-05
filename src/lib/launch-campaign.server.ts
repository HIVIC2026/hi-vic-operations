import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { declaredExtras } from "./enquiry.core";
import { normaliseInsulation } from "./eligibility.core";
import { isWellFormedToken, LINK_PURPOSE, linkUsable } from "./estimatelink.core";
import { LAUNCH_BATCH_SIZE, LAUNCH_CAMPAIGN, LAUNCH_COPY_APPROVED, deskCheckReasonError, launchGroup, type DeskCheckOutcome } from "./launch-campaign.core";
import { logEvent } from "./workflow.server";

async function campaignLink(token: unknown) {
  if (!isWellFormedToken(token)) return null;
  const { data: link } = await admin.from("customer_estimate_links").select("id, job_id, status, expires_at").eq("token", token).eq("purpose", LINK_PURPOSE).maybeSingle();
  if (!link || !linkUsable(link)) return null;
  const { data: job } = await admin.from("jobs").select("id, source, stage, eligibility_outcome, eligibility_review_required, properties(enrichment)").eq("id", link.job_id).maybeSingle();
  if (!job || job.eligibility_review_required || job.stage === "cancelled" || job.stage === "complete" || (job.source !== "base44" && job.source !== "qa_test")) return null;
  // Until Jo approves the final copy and explicitly starts the campaign, only isolated qa_test jobs can use it.
  if (!LAUNCH_COPY_APPROVED && job.source !== "qa_test") return null;
  const property = job.properties as { enrichment: Record<string, unknown> | null } | null;
  const base44 = (property?.enrichment?.["base44"] ?? {}) as { raw?: { answers?: Record<string, unknown> } };
  const insulation = normaliseInsulation(declaredExtras(base44.raw?.answers ?? null).existing_insulation);
  const group = launchGroup(job.eligibility_outcome, insulation);
  return group ? { link, job, group } : null;
}

export async function campaignPage(token: unknown, testMode = false) {
  const c = await campaignLink(token);
  if (!c) return null;
  const { resolvePublicEstimate } = await import("./estimatelink.server");
  const [{ data: response }, estimate] = await Promise.all([
    admin.from("lead_campaign_responses").select("spot_saved_at, opted_out_at, media_received_at, desk_check_status").eq("job_id", c.job.id).maybeSingle(),
    resolvePublicEstimate(token, testMode),
  ]);
  return estimate ? { group: c.group, estimate, response: response ?? null } : null;
}

export async function saveCampaignSpot(token: unknown) {
  const c = await campaignLink(token);
  if (!c) throw new Error("This link is no longer available.");
  const now = new Date().toISOString();
  const { data: existing } = await admin.from("lead_campaign_responses").select("opted_out_at").eq("job_id", c.job.id).maybeSingle();
  if (existing?.opted_out_at) throw new Error("This enquiry has already been taken off the list.");
  const { error } = await admin.from("lead_campaign_responses").upsert({
    job_id: c.job.id, estimate_link_id: c.link.id, campaign: LAUNCH_CAMPAIGN, spot_saved_at: now,
    video_requested: c.group === "onsite", desk_check_status: c.group === "onsite" ? "pending" : "not_needed", updated_at: now,
  }, { onConflict: "job_id" });
  if (error) throw new Error("We couldn't save your place. Please try again.");
  await logEvent(c.job.id, null, "campaign_spot_saved", "Owner saved a place for a free Ready Check", { campaign: LAUNCH_CAMPAIGN }, { internal: true });
  return { ok: true as const };
}

export async function optOutCampaign(token: unknown) {
  const c = await campaignLink(token);
  if (!c) throw new Error("This link is no longer available.");
  const now = new Date().toISOString();
  const { unsubscribeUrlForJob, recordUnsubscribe } = await import("./emailsafety.server");
  const url = new URL(await unsubscribeUrlForJob(c.job.id));
  const unsubscribeToken = url.searchParams.get("t");
  if (!unsubscribeToken || !(await recordUnsubscribe(unsubscribeToken))) throw new Error("We couldn't update your preference. Please try again.");
  const { error } = await admin.from("lead_campaign_responses").upsert({
    job_id: c.job.id, estimate_link_id: c.link.id, campaign: LAUNCH_CAMPAIGN, opted_out_at: now, spot_saved_at: null,
    video_requested: c.group === "onsite", desk_check_status: "not_needed", updated_at: now,
  }, { onConflict: "job_id" });
  if (error) throw new Error("We couldn't update your preference. Please try again.");
  await admin.from("jobs").update({ stage: "cancelled", prior_stage: c.job.stage, cancelled_reason: "Owner opted out" }).eq("id", c.job.id).neq("stage", "cancelled");
  const { recordEngagement, suppressFollowups } = await import("./engagement.server");
  await suppressFollowups(c.job.id, "owner_opted_out");
  await recordEngagement({ jobId: c.job.id, linkId: c.link.id, type: "opted_out", source: "launch_campaign", metadata: { reason: "owner_opted_out" }, dedupeKey: `launch_optout:${c.job.id}` });
  await logEvent(c.job.id, null, "stage_changed", "Cancelled: owner opted out", { campaign: LAUNCH_CAMPAIGN }, { from: c.job.stage as never, to: "cancelled" });
  return { ok: true as const };
}

export async function markCampaignMediaReceived(jobId: string, linkId: string) {
  const now = new Date().toISOString();
  await admin.from("lead_campaign_responses").upsert({ job_id: jobId, estimate_link_id: linkId, campaign: LAUNCH_CAMPAIGN, video_requested: true, media_received_at: now, desk_check_status: "pending", updated_at: now }, { onConflict: "job_id" });
}

export async function launchCampaignOffice() {
  const [{ data: rows, error }, { data: sends }, { data: events }] = await Promise.all([
    admin.from("lead_campaign_responses").select("id, job_id, spot_saved_at, opted_out_at, media_received_at, desk_check_status, desk_check_reason, created_at, jobs(job_number, owners(full_name), properties(address_line, suburb, postcode))").order("spot_saved_at", { ascending: true, nullsFirst: false }),
    admin.from("customer_email_sends").select("status").eq("purpose", LAUNCH_CAMPAIGN),
    admin.from("customer_engagement_events").select("event_type").eq("source", "launch_campaign"),
  ]);
  if (error) throw new Error(error.message);
  const count = (xs: { status?: string; event_type?: string }[] | null, key: "status" | "event_type", value: string) => (xs ?? []).filter((x) => x[key] === value).length;
  return {
    sendingLocked: !LAUNCH_COPY_APPROVED,
    batchSize: LAUNCH_BATCH_SIZE,
    counts: {
      sent: count(sends, "status", "sent") + count(sends, "status", "delivered_unrecorded"), opened: count(events, "event_type", "email_opened"),
      spotSaved: (rows ?? []).filter((r) => r.spot_saved_at && !r.opted_out_at).length, optedOut: (rows ?? []).filter((r) => r.opted_out_at).length,
      videosUploaded: (rows ?? []).filter((r) => r.media_received_at).length,
      looksEligible: (rows ?? []).filter((r) => r.desk_check_status === "looks_eligible").length,
      notEligible: (rows ?? []).filter((r) => r.desk_check_status === "not_eligible").length,
      needsOnsite: (rows ?? []).filter((r) => r.desk_check_status === "needs_onsite_check").length,
    },
    rows: (rows ?? []).map((r) => {
      const job = r.jobs as { job_number: string | null; owners: { full_name: string | null } | null; properties: { address_line: string | null; suburb: string | null; postcode: string | null } | null } | null;
      return { id: r.id, jobId: r.job_id, jobNumber: job?.job_number ?? null, owner: job?.owners?.full_name ?? null, property: [job?.properties?.address_line, job?.properties?.suburb, job?.properties?.postcode].filter(Boolean).join(", "), spotSavedAt: r.spot_saved_at, optedOutAt: r.opted_out_at, mediaReceivedAt: r.media_received_at, deskCheckStatus: r.desk_check_status, deskCheckReason: r.desk_check_reason };
    }),
  };
}

export async function recordDeskCheck(responseId: string, outcome: DeskCheckOutcome, reason: string, actorId: string) {
  const issue = deskCheckReasonError(outcome, reason);
  if (issue) throw new Error(issue);
  const now = new Date().toISOString();
  const { data, error } = await admin.from("lead_campaign_responses").update({ desk_check_status: outcome, desk_check_reason: reason.trim() || null, desk_checked_at: now, desk_checked_by: actorId, updated_at: now }).eq("id", responseId).eq("desk_check_status", "pending").select("job_id").maybeSingle();
  if (error || !data) throw new Error("This desktop check has already been completed or is unavailable.");
  const summary = outcome === "looks_eligible" ? "Desktop insulation check: looks eligible (under R2.0)" : outcome === "not_eligible" ? `Desktop insulation check: not eligible – ${reason.trim()}` : "Desktop insulation check: needs onsite check";
  await logEvent(data.job_id, actorId, "desktop_insulation_check", summary, { outcome, reason: reason.trim() }, { internal: true });
  return { ok: true as const };
}
