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
  const { data: job } = await admin.from("jobs").select("id, source, stage, eligibility_outcome, eligibility_review_required, estimated_area_m2, owners(full_name), properties(address_line, suburb, state, postcode, enrichment)").eq("id", link.job_id).maybeSingle();
  if (!job || job.eligibility_review_required || job.stage === "cancelled" || job.stage === "complete" || (job.source !== "base44" && job.source !== "qa_test")) return null;
  // Until Jo approves the final copy and explicitly starts the campaign, only isolated qa_test jobs can use it.
  if (!LAUNCH_COPY_APPROVED && job.source !== "qa_test") return null;
  const property = job.properties as { enrichment: Record<string, unknown> | null } | null;
  const base44 = (property?.enrichment?.["base44"] ?? {}) as { raw?: { answers?: Record<string, unknown> } };
  const insulation = normaliseInsulation(declaredExtras(base44.raw?.answers ?? null).existing_insulation);
  const group = launchGroup(job.eligibility_outcome, insulation);
  if (!group) return null;
  const { data: response } = await admin.from("lead_campaign_responses").select("opted_out_at").eq("job_id", job.id).maybeSingle();
  if (!response?.opted_out_at) {
    const { data: consent } = await admin.from("owner_contact_consents").select("consent_status").eq("job_id", job.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (consent?.consent_status !== "granted") return null;
  }
  return { link, job, group };
}

export async function campaignPage(token: unknown, testMode = false) {
  const c = await campaignLink(token);
  if (!c) return null;
  const { resolvePublicEstimate } = await import("./estimatelink.server");
  const [{ data: response }, estimate] = await Promise.all([
    admin.from("lead_campaign_responses").select("spot_saved_at, opted_out_at, media_received_at, desk_check_status, queue_priority").eq("job_id", c.job.id).maybeSingle(),
    resolvePublicEstimate(token, testMode),
  ]);
  const owner = c.job.owners as { full_name: string | null } | null;
  const property = c.job.properties as { address_line: string | null; suburb: string | null; state: string | null; postcode: string | null; enrichment: Record<string, unknown> | null } | null;
  const base44 = (property?.enrichment?.["base44"] ?? {}) as { raw?: { answers?: Record<string, unknown> } };
  const insulation = normaliseInsulation(declaredExtras(base44.raw?.answers ?? null).existing_insulation);
  const address = [property?.address_line, property?.suburb, property?.state, property?.postcode].filter(Boolean).join(", ");
  const { data: availability } = await admin.from("customer_delivery_settings").select("ready_check_available_postcodes").eq("id", 1).maybeSingle();
  return estimate ? JSON.stringify({ group: c.group, estimate, response: response ?? null, bookingAvailable: !!property?.postcode && (availability?.ready_check_available_postcodes ?? []).includes(property.postcode), owner: { firstName: owner?.full_name?.trim().split(/\s+/)[0] ?? null }, initialValues: { address, areaM2: c.job.estimated_area_m2 == null ? null : Number(c.job.estimated_area_m2), insulation } }) : null;
}

export async function saveCampaignSpot(token: unknown) {
  const c = await campaignLink(token);
  if (!c) throw new Error("This link is no longer available.");
  const now = new Date().toISOString();
  const { data: existing } = await admin.from("lead_campaign_responses").select("opted_out_at, spot_saved_at").eq("job_id", c.job.id).maybeSingle();
  if (existing?.opted_out_at) throw new Error("This enquiry has already been taken off the list.");
  if (existing?.spot_saved_at) return { ok: true as const };
  const { error } = existing
    ? await admin.from("lead_campaign_responses").update({ spot_saved_at: now, updated_at: now }).eq("job_id", c.job.id).is("opted_out_at", null).is("spot_saved_at", null)
    : await admin.from("lead_campaign_responses").insert({ job_id: c.job.id, estimate_link_id: c.link.id, campaign: LAUNCH_CAMPAIGN, spot_saved_at: now, video_requested: c.group === "onsite", desk_check_status: c.group === "onsite" ? "pending" : "not_needed", updated_at: now });
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
  const { data: job } = await admin.from("jobs").select("source, stage, eligibility_outcome, eligibility_review_required, properties(enrichment)").eq("id", jobId).maybeSingle();
  if (!job || !["base44", "qa_test"].includes(job.source ?? "") || (!LAUNCH_COPY_APPROVED && job.source !== "qa_test") || job.eligibility_review_required || ["cancelled", "complete"].includes(job.stage)) return;
  const property = job.properties as { enrichment: Record<string, unknown> | null } | null;
  const base44 = (property?.enrichment?.["base44"] ?? {}) as { raw?: { answers?: Record<string, unknown> } };
  if (launchGroup(job.eligibility_outcome, normaliseInsulation(declaredExtras(base44.raw?.answers ?? null).existing_insulation)) !== "onsite") return;
  const { data: link } = await admin.from("customer_estimate_links").select("id").eq("id", linkId).eq("job_id", jobId).maybeSingle();
  if (!link) return;
  const now = new Date().toISOString();
  const { data: existing } = await admin.from("lead_campaign_responses").select("desk_check_status, media_received_at, spot_saved_at").eq("job_id", jobId).maybeSingle();
  const patch = { media_received_at: existing?.media_received_at ?? now, spot_saved_at: existing?.spot_saved_at ?? now, queue_priority: "video", updated_at: now, ...(existing && !["not_needed", "pending"].includes(existing.desk_check_status) ? {} : { desk_check_status: "pending" }) };
  if (existing) await admin.from("lead_campaign_responses").update(patch).eq("job_id", jobId);
  else await admin.from("lead_campaign_responses").insert({ job_id: jobId, estimate_link_id: linkId, campaign: LAUNCH_CAMPAIGN, video_requested: true, ...patch });
}

export async function launchCampaignOffice() {
  const [{ data: rows, error }, { data: sends }, { data: events }] = await Promise.all([
    admin.from("lead_campaign_responses").select("id, job_id, spot_saved_at, opted_out_at, media_received_at, desk_check_status, desk_check_reason, queue_priority, created_at, jobs(job_number, owners(full_name), properties(address_line, suburb, postcode))").order("queue_priority", { ascending: false }).order("spot_saved_at", { ascending: true, nullsFirst: false }),
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
      return { id: r.id, jobId: r.job_id, jobNumber: job?.job_number ?? null, owner: job?.owners?.full_name ?? null, property: [job?.properties?.address_line, job?.properties?.suburb, job?.properties?.postcode].filter(Boolean).join(", "), spotSavedAt: r.spot_saved_at, optedOutAt: r.opted_out_at, mediaReceivedAt: r.media_received_at, queuePriority: r.queue_priority, deskCheckStatus: r.desk_check_status, deskCheckReason: r.desk_check_reason };
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
