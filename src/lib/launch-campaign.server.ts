import { fullAddress } from "./address";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { declaredExtras } from "./enquiry.core";
import { normaliseInsulation } from "./eligibility.core";
import { effectiveInsulation } from './enquiry-groups.core';
import { isWellFormedToken, LINK_PURPOSE, linkUsable } from "./estimatelink.core";
import { LAUNCH_BATCH_SIZE, LAUNCH_CAMPAIGN, LAUNCH_COPY_APPROVED, officeSpotSavedCount, campaignSaveAllowed, campaignSendCounts, deskCheckReasonError, launchGroup, ownerCalculatorChangeNote, savedPriceFromCalculator, savedPriceFromEstimate, savedPriceLabel, type DeskCheckOutcome } from "./launch-campaign.core";
import { logEvent } from "./workflow.server";
import { groupBMediaForJob } from "./group-b-media.server";
import { whatIfEstimate } from "./estimate.core";
import { removalFromScenario } from "./estimate-removal.core";
import { joAreaBasis } from "./jo-area-basis.core";
import { INSULATION_REVIEW_OPTIONS, declarationCriteriaPassed, qualifyingDeclaration, insulationDeclarationRecord, type InsulationDeclaration } from "./insulation-review.core";

export async function campaignLink(token: unknown) {
  if (!isWellFormedToken(token)) return null;
  const { data: link } = await admin.from("customer_estimate_links").select("id, job_id, status, expires_at").eq("token", token).eq("purpose", LINK_PURPOSE).maybeSingle();
  if (!link || !linkUsable(link)) return null;
  const { data: job } = await admin.from("jobs").select("id, source, stage, eligibility_outcome, eligibility_review_required, eligibility_decision_source, eligibility_decision_rules, estimated_area_m2, owners(full_name), properties(address_line, suburb, state, postcode, enrichment)").eq("id", link.job_id).maybeSingle();
  if (!job || job.eligibility_review_required || job.stage === "cancelled" || job.stage === "complete" || (job.source !== "base44" && job.source !== "qa_test")) return null;
  // Until Jo approves the final copy and explicitly starts the campaign, only isolated qa_test jobs can use it.
  if (!LAUNCH_COPY_APPROVED && job.source !== "qa_test") return null;
  const property = job.properties as { enrichment: Record<string, unknown> | null } | null;
  const base44 = (property?.enrichment?.["base44"] ?? {}) as { raw?: { answers?: Record<string, unknown> } };
  const { data: mediaReviews, error: mediaReviewError } = await admin.from("customer_engagement_events").select("metadata").eq("job_id", job.id).eq("event_type", "intake_media_reviewed").eq('source', 'office').order("occurred_at", { ascending: false }).order('id', { ascending: false }).limit(1);
  if (mediaReviewError) throw new Error("We couldn't check your evidence review. Please try again.");
  const mediaReview = (mediaReviews?.[0]?.metadata as { outcome?: string } | null)?.outcome ?? null;
  // Keep the homeowner's declaration intact. A reviewed no-insulation offer must open its matching
  // campaign lane; the recorded official eligibility outcome is still required by launchGroup.
  const insulation = effectiveInsulation(normaliseInsulation(declaredExtras(base44.raw?.answers ?? null).existing_insulation), mediaReview);
  const group = launchGroup(job.eligibility_outcome, insulation);
  if (!group) return null;
  const { data: response } = await admin.from("lead_campaign_responses").select("opted_out_at").eq("job_id", job.id).maybeSingle();
  if (!response?.opted_out_at) {
    const { data: consent } = await admin.from("owner_contact_consents").select("consent_status").eq("job_id", job.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (consent?.consent_status !== "granted") return null;
  }
  const { data: optout, error: optError } = await admin.from("customer_email_optouts").select("opted_out_at").eq("job_id", job.id).maybeSingle();
  if (response?.opted_out_at || optout?.opted_out_at || optError) return null;
  let criteriaPassed = false;
  let ownerQualified = false;
  if (group === "onsite") {
    if (!["new_enquiry", "eligibility_review", "preliminary_estimate_ready", "ready_check_ready_to_schedule"].includes(job.stage)) return null;
    const { data: work, error: workError } = await admin.from("post_intake_work").select("job_id").eq("job_id", job.id).in("status", ["queued", "processing", "retry"]);
    criteriaPassed = !workError && declarationCriteriaPassed({ outcome: job.eligibility_outcome, decisionSource: job.eligibility_decision_source, reviewRequired: job.eligibility_review_required, audit: job.eligibility_decision_rules as import("./enquiry-groups.core").StoredAudit, insulation, intakeActive: !!work?.length });
    const { data: events, error: eventsError } = await admin.from("workflow_events").select("event_type, details").eq("job_id", job.id).in("event_type", ["owner_insulation_loose_fill_only_declared", "owner_insulation_below_r2_declared"]);
    if (eventsError) throw new Error("We couldn't check your declaration. Please try again.");
    ownerQualified = criteriaPassed && qualifyingDeclaration(events ?? []);
  }
  const media = group === "onsite" ? await groupBMediaForJob(job.id) : null;
  return { link, job, group, ownerQualified, criteriaPassed, media, mediaReview };
}

export function campaignPermission(c: NonNullable<Awaited<ReturnType<typeof campaignLink>>>, deskStatus: string | null | undefined) {
  if (["not_eligible", "needs_onsite_check"].includes(deskStatus ?? "") || c.mediaReview === "over_r2" || c.mediaReview === "unclear") return false;
  if (c.mediaReview === "below_r2" && c.criteriaPassed) return true;
  if (c.media?.excluded) return deskStatus === "looks_eligible" && c.criteriaPassed;
  return campaignSaveAllowed(c.group, deskStatus, c.ownerQualified);
}

export async function campaignPage(token: unknown, testMode = false) {
  const c = await campaignLink(token);
  if (!c) return null;
  const { resolvePublicEstimate } = await import("./estimatelink.server");
  const [{ data: response }, estimate] = await Promise.all([
    admin.from("lead_campaign_responses").select("spot_saved_at, opted_out_at, media_received_at, desk_check_status, queue_priority, saved_total, saved_veu_discount").eq("job_id", c.job.id).maybeSingle(),
    resolvePublicEstimate(token, testMode),
  ]);
  const owner = c.job.owners as { full_name: string | null } | null;
  const property = c.job.properties as { address_line: string | null; suburb: string | null; state: string | null; postcode: string | null; enrichment: Record<string, unknown> | null } | null;
  const base44 = (property?.enrichment?.["base44"] ?? {}) as { raw?: { answers?: Record<string, unknown> } };
  const insulation = normaliseInsulation(declaredExtras(base44.raw?.answers ?? null).existing_insulation);
  const address = fullAddress(property?.address_line, property?.suburb, property?.postcode);
  const booking = await (await import('./ready-check-booking-access.server')).readyCheckBookingAccess(c.job.id);
  // v8: the page carries the full approved design, so it gets the same snapshot numbers the email used.
  const [{ data: est }, { data: cfg }] = await Promise.all([
    admin.from("indicative_estimates").select("id, area_source, area_m2, insulation_declared, scenarios, snapshot").eq("job_id", c.job.id).eq("status", "current").maybeSingle(),
    admin.from("retail_estimator_settings").select("indicative_veec_value, piesa_assessment_inc_gst, ap_management_inc_gst, r5_install_inc_gst_per_m2, removal_inc_gst_per_m2").eq("is_current", true).maybeSingle(),
  ]);
  const basis = joAreaBasis({ areaSource: est?.area_source, areaM2: est?.area_m2, ownerAreaM2: c.job.estimated_area_m2 });
  const p = basis.ok ? savedPriceFromEstimate(est ?? null) : null;
  const removal = removalFromScenario(Array.isArray(est?.scenarios) ? est.scenarios[0] : null);
  const veecValue = Number(cfg?.indicative_veec_value) || 70;
  const snapshot = est?.snapshot as { settings?: { piesa_assessment_inc_gst?: number; ap_management_inc_gst?: number; r5_install_inc_gst_per_m2?: number; indicative_veec_value?: number } } | null;
  const fees = snapshot?.settings ?? cfg;
  const assessmentFee = Number(fees?.piesa_assessment_inc_gst ?? 349), apFee = Number(fees?.ap_management_inc_gst ?? 349);
  const snapshotVeec = Number(fees?.indicative_veec_value ?? veecValue);
  const pricingInsulation = p ? (p.insulation ?? est?.insulation_declared ?? null) : null;
  const { removalUpTo } = await import("./estimate-removal-upto.core");
  const pricing = p && p.areaM2 ? { gross: p.gross, discount: p.discount, total: p.total, areaM2: p.areaM2, areaAssumed: basis.ok && basis.areaEstimated, assessmentFee, apFee, ratePerM2: Number(fees?.r5_install_inc_gst_per_m2 ?? 30), installation: p.gross - assessmentFee - apFee - (removal.kind === "included" ? removal.amount : 0), removal, veecs: Math.round(p.discount / snapshotVeec), veecValue: snapshotVeec, address, insulation: pricingInsulation, removalUpTo: removalUpTo({ insulation: pricingInsulation, areaM2: p.areaM2, ratePerM2: cfg?.removal_inc_gst_per_m2, removalItemised: removal.kind === "included" }) } : null;
  const { referralUrlForJob } = await import("./referral.server");
  const referralUrl = await referralUrlForJob(c.job.id);
  return estimate ? JSON.stringify({ group: c.group, saveAllowed: campaignPermission(c, response?.desk_check_status), media: c.media, mediaReview: c.mediaReview, ownerQualified: c.ownerQualified, estimate, pricing, response: response ?? null, referralUrl, bookingAvailable: booking.allowed, owner: { firstName: owner?.full_name?.trim().split(/\s+/)[0] ?? null }, home: { suburb: property?.suburb ?? null, short: [property?.address_line, property?.suburb].filter(Boolean).join(", ") || null }, initialValues: { address, areaM2: c.job.estimated_area_m2 == null ? null : Number(c.job.estimated_area_m2), insulation } }) : null;
}

export async function saveCampaignSpot(token: unknown, calc?: { areaM2: number; insulation: "none" | "present" | "unknown" | null } | null) {
  const c = await campaignLink(token);
  if (!c) throw new Error("This link is no longer available.");
  const { data: review, error: reviewError } = await admin.from("lead_campaign_responses").select("desk_check_status").eq("job_id", c.job.id).maybeSingle();
  if (reviewError || !campaignPermission(c, review?.desk_check_status)) throw new Error("Our office needs to check your insulation before offering Save my spot.");
  const now = new Date().toISOString();
  const { data: est } = await admin.from("indicative_estimates").select("id, area_source, area_m2, insulation_declared, scenarios").eq("job_id", c.job.id).eq("status", "current").maybeSingle();
  const basis = joAreaBasis({ areaSource: est?.area_source, areaM2: est?.area_m2, ownerAreaM2: c.job.estimated_area_m2 });
  if (!calc && !basis.ok) throw new Error("Your estimate is being updated. Please check the size before saving your spot.");
  let price = savedPriceFromEstimate(est ?? null);
  if (c.group === "onsite" && calc?.insulation === "none") throw new Error("Keep your existing-insulation answer for this estimate. A declaration or preliminary review does not mean insulation is absent.");
  // Owner calculator: snapshot exactly what the calculator showed, recomputed server-side from the same pure core.
  if (calc) {
    const { resolvePublicEstimate } = await import("./estimatelink.server");
    const pub = await resolvePublicEstimate(token, false) as { estimate?: { calc?: { location: never; settings: never } | null } } | null;
    const cc = pub?.estimate?.calc;
    const shown = cc ? whatIfEstimate(calc.areaM2, cc.location, calc.insulation, cc.settings) : null;
    price = savedPriceFromCalculator(shown as never, calc.areaM2, calc.insulation) ?? price;
    const property = c.job.properties as { enrichment: Record<string, unknown> | null } | null;
    const base44 = (property?.enrichment?.["base44"] ?? {}) as { raw?: { answers?: Record<string, unknown> } };
    const { data: prev } = await admin.from("lead_campaign_responses").select("saved_insulation").eq("job_id", c.job.id).maybeSingle();
    const beforeIns = prev?.saved_insulation ?? normaliseInsulation(declaredExtras(base44.raw?.answers ?? null).existing_insulation);
    const note = ownerCalculatorChangeNote({ areaM2: c.job.estimated_area_m2 == null ? null : Number(c.job.estimated_area_m2), insulation: beforeIns }, calc);
    if (note) {
      // Store the new size on the EXISTING job only — never a new job or enquiry.
      await admin.from("jobs").update({ estimated_area_m2: calc.areaM2 }).eq("id", c.job.id);
      await logEvent(c.job.id, null, "owner_calculator_change", note, { area_m2: calc.areaM2, insulation: calc.insulation, previous_area_m2: c.job.estimated_area_m2, estimate: price }, { internal: true });
    }
  }
  const snapshot = { saved_estimate_id: price?.estimateId ?? null, saved_total: price?.total ?? null, saved_veu_discount: price?.discount ?? null, saved_gross_total: price?.gross ?? null, saved_area_m2: price?.areaM2 ?? null, saved_insulation: price?.insulation ?? null, saved_estimate_url: `/estimate/${String(token)}/${calc ? "calculator" : "campaign"}` };
  // Idempotent: ON CONFLICT (job_id) DO NOTHING, then fill an existing unsaved row. Double taps / two devices both succeed.
  const ins = await admin.from("lead_campaign_responses").upsert({ job_id: c.job.id, estimate_link_id: c.link.id, campaign: LAUNCH_CAMPAIGN, spot_saved_at: now, video_requested: c.group === "onsite", desk_check_status: c.group === "onsite" ? "pending" : "not_needed", updated_at: now, ...snapshot }, { onConflict: "job_id", ignoreDuplicates: true }).select("id");
  let firstSave = !ins.error && (ins.data?.length ?? 0) > 0;
  if (!firstSave) {
    let query = admin.from("lead_campaign_responses").update({ spot_saved_at: now, updated_at: now, ...snapshot }).eq("job_id", c.job.id).is("opted_out_at", null).is("spot_saved_at", null);
    if (c.group === "onsite" && c.mediaReview !== "below_r2") query = c.ownerQualified ? query.in("desk_check_status", ["not_needed", "pending", "looks_eligible"]) : query.eq("desk_check_status", "looks_eligible");
    const upd = await query.select("id");
    firstSave = !upd.error && (upd.data?.length ?? 0) > 0;
  }
  const { data: row } = await admin.from("lead_campaign_responses").select("opted_out_at, spot_saved_at").eq("job_id", c.job.id).maybeSingle();
  if (row?.opted_out_at) throw new Error("This enquiry has already been taken off the list.");
  if (!row?.spot_saved_at) throw new Error("We couldn't save your place. Please try again.");
  if (firstSave) await logEvent(c.job.id, null, "campaign_spot_saved", price ? `Owner saved a place for a free Ready Check at $${Math.floor(price.total)} (rebate $${Math.floor(price.discount)})` : "Owner saved a place for a free Ready Check", { campaign: LAUNCH_CAMPAIGN, area_assumed: !calc && basis.ok && basis.areaEstimated, ...snapshot }, { internal: true });
  // Spot saved → only now does the job move on to the free Ready Check (Jo, 8 Oct).
  {
    const { data: j, error: je } = await admin.from("jobs").select("stage").eq("id", c.job.id).maybeSingle();
    if (je) await logEvent(c.job.id, null, "campaign_spot_advance_blocked", `Spot saved but the job stage could not be read: ${je.message}`, {}, { internal: true }).catch(() => console.error("advance check failed", c.job.id, je.message));
    if (j && ["preliminary_estimate_ready", "new_enquiry", "eligibility_review"].includes(j.stage)) {
      const { transition } = await import("./workflow.server");
      // The spot itself is saved; a refused stage move must not fail the owner's request, but office must see it.
      const flag = (to: string) => (e: unknown) => logEvent(c.job.id, null, "campaign_spot_advance_blocked", `Spot saved but the job could not move to ${to}: ${(e as Error)?.message ?? e}`, { to }, { internal: true }).catch((le) => console.error("campaign_spot_advance_blocked not logged", c.job.id, to, (le as Error)?.message));
      if (j.stage !== "preliminary_estimate_ready") await transition(c.job.id, "preliminary_estimate_ready", null, "Owner saved their spot – preliminary queue qualification; final onsite verification required").catch(flag("preliminary_estimate_ready"));
      await transition(c.job.id, "ready_check_ready_to_schedule", null, "Owner saved their spot – free Ready Check next").catch(flag("ready_check_ready_to_schedule"));
    }
  }
  // Queued only after the stage move: this step is slow, and a request cut off here used to leave the job
  // saved but stuck at the estimate stage with nothing logged (HV-3022, 21 Oct).
  if (firstSave) await queueSpotSavedConfirmations(c.job.id, String(token));
  return { ok: true as const };
}

/** Saved price for the office job page, compared with the current estimate. */
export async function savedSpotForJob(jobId: string) {
  const [{ data: r }, { data: cur }] = await Promise.all([
    admin.from("lead_campaign_responses").select("spot_saved_at, opted_out_at, queue_priority, saved_estimate_id, saved_total, saved_veu_discount, saved_gross_total, saved_area_m2, saved_insulation").eq("job_id", jobId).maybeSingle(),
    admin.from("indicative_estimates").select("id, area_m2, insulation_declared, scenarios").eq("job_id", jobId).eq("status", "current").maybeSingle(),
  ]);
  if (!r?.spot_saved_at || r.opted_out_at) return null;
  const now = savedPriceFromEstimate(cur ?? null);
  const label = savedPriceLabel({ total: r.saved_total == null ? null : Number(r.saved_total), discount: r.saved_veu_discount == null ? null : Number(r.saved_veu_discount), savedAt: r.spot_saved_at, estimateId: r.saved_estimate_id }, now);
  return { savedAt: r.spot_saved_at, video: r.queue_priority === "video", label: label?.text ?? null, changeNote: label?.changeNote ?? null, areaM2: r.saved_area_m2 == null ? null : Number(r.saved_area_m2), insulation: r.saved_insulation, gross: r.saved_gross_total == null ? null : Number(r.saved_gross_total) };
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
  const { data: existing, error: readError } = await admin.from("lead_campaign_responses").select("desk_check_status, media_received_at, spot_saved_at, opted_out_at").eq("job_id", jobId).maybeSingle();
  if (readError) throw new Error("Your file was received but the office review could not be queued. Please try again.");
  if (existing?.opted_out_at) return;
  const patch = { media_received_at: existing?.media_received_at ?? now, queue_priority: "video", updated_at: now, ...(existing && !["not_needed", "pending"].includes(existing.desk_check_status) ? {} : { desk_check_status: "pending" }) };
  const result = existing ? await admin.from("lead_campaign_responses").update(patch).eq("job_id", jobId) : await admin.from("lead_campaign_responses").insert({ job_id: jobId, estimate_link_id: linkId, campaign: LAUNCH_CAMPAIGN, video_requested: true, ...patch });
  if (result.error) throw new Error("Your file was received but the office review could not be queued. Please try again.");
}

export async function recordInsulationDeclaration(token: unknown, declarationType?: InsulationDeclaration, confirmed: boolean = false) {
  const type = declarationType ?? "below_r2";
  const record = insulationDeclarationRecord(type, confirmed);
  const c = await campaignLink(token);
  if (c?.media?.excluded) throw new Error(c.media.received ? "We already have your enquiry photos/video. They are with our office for review." : "We are checking your original enquiry uploads. Please contact our office.");
  if (!c || c.group !== "onsite" || !c.criteriaPassed) throw new Error("The other initial checks must pass before you can save a spot. Please contact our office.");
  if (!["new_enquiry", "eligibility_review", "preliminary_estimate_ready", "ready_check_ready_to_schedule"].includes(c.job.stage)) throw new Error("This enquiry has already moved on. Please contact our office.");
  const { data: existing, error: readError } = await admin.from("lead_campaign_responses").select("id, opted_out_at, desk_check_status, desk_checked_at").eq("job_id", c.job.id).maybeSingle();
  if (readError || existing?.opted_out_at || ["not_eligible", "needs_onsite_check"].includes(existing?.desk_check_status ?? "")) throw new Error("This enquiry needs an office check before you can save a spot.");
  const { data: recorded, error: eventError } = await admin.from("workflow_events").select("id, event_type, details").eq("job_id", c.job.id).eq("event_type", record.eventType);
  if (eventError) throw new Error("We couldn't check your submission. Please try again.");
  if (!qualifyingDeclaration(recorded ?? [])) await logEvent(c.job.id, null, record.eventType, record.reviewReason, { declaration: record.declaration, question: INSULATION_REVIEW_OPTIONS.find((item) => item.id === type)?.label, answer: "yes", declaration_type: type, basis: record.basis, answered_at: new Date().toISOString(), preliminary_queue_qualification: true }, { internal: true });
  // No invented office reviewer/time. Historical office decisions are retained.
  if (!existing) {
    const { error } = await admin.from("lead_campaign_responses").upsert({ job_id: c.job.id, estimate_link_id: c.link.id, campaign: LAUNCH_CAMPAIGN, desk_check_status: "not_needed", desk_check_reason: record.reviewReason, updated_at: new Date().toISOString() }, { onConflict: "job_id", ignoreDuplicates: true });
    if (error) throw new Error("We couldn't record your answer. Please try again.");
  } else if (!existing.desk_checked_at) {
    const { error } = await admin.from("lead_campaign_responses").update({ desk_check_status: "not_needed", desk_check_reason: record.reviewReason, updated_at: new Date().toISOString() }).eq("job_id", c.job.id).is("opted_out_at", null).is("desk_checked_at", null).in("desk_check_status", ["pending", "not_needed"]);
    if (error) throw new Error("We couldn't record your answer. Please try again.");
  }
  return { ok: true as const };
}

export async function launchCampaignOffice() {
  const [{ data: rows, error }, { data: sends }, { data: events }, spotSaved] = await Promise.all([
    admin.from("lead_campaign_responses").select("id, job_id, spot_saved_at, opted_out_at, media_received_at, desk_check_status, desk_check_reason, queue_priority, queue_rank, saved_total, saved_veu_discount, saved_estimate_id, created_at, jobs!inner(job_number, source, owners(full_name), properties(address_line, suburb, postcode), indicative_estimates(id, status, area_m2, insulation_declared, scenarios))").neq("jobs.source", "qa_test").order("queue_rank", { ascending: false }).order("spot_saved_at", { ascending: true, nullsFirst: false }),
    admin.from("customer_email_sends").select("status, idempotency_key, jobs!inner(source)").eq("purpose", LAUNCH_CAMPAIGN),
    admin.from("customer_engagement_events").select("event_type").eq("source", "launch_campaign"),
    officeSpotsSaved(),
  ]);
  if (error) throw new Error(error.message);
  const count = (xs: { status?: string; event_type?: string }[] | null, key: "status" | "event_type", value: string) => (xs ?? []).filter((x) => x[key] === value).length;
  return {
    sendingLocked: !LAUNCH_COPY_APPROVED,
    batchSize: LAUNCH_BATCH_SIZE,
    counts: {
      ...campaignSendCounts((sends ?? []).map((s) => ({ status: s.status, idempotency_key: s.idempotency_key, source: (s.jobs as { source: string | null } | null)?.source ?? null }))),
      sent: count(sends, "status", "sent") + count(sends, "status", "delivered_unrecorded"), opened: count(events, "event_type", "email_opened"),
      spotSaved, optedOut: (rows ?? []).filter((r) => r.opted_out_at).length,
      videosUploaded: (rows ?? []).filter((r) => r.media_received_at).length,
      looksEligible: (rows ?? []).filter((r) => r.desk_check_status === "looks_eligible").length,
      notEligible: (rows ?? []).filter((r) => r.desk_check_status === "not_eligible").length,
      needsOnsite: (rows ?? []).filter((r) => r.desk_check_status === "needs_onsite_check").length,
    },
    rows: (rows ?? []).map((r) => {
      const job = r.jobs as { job_number: string | null; owners: { full_name: string | null } | null; properties: { address_line: string | null; suburb: string | null; postcode: string | null } | null; indicative_estimates?: { id: string; status: string; area_m2: number | null; insulation_declared: string | null; scenarios: unknown }[] | null } | null;
      const cur = savedPriceFromEstimate((job?.indicative_estimates ?? []).find((e) => e.status === "current") ?? null);
      const price = savedPriceLabel({ total: r.saved_total == null ? null : Number(r.saved_total), discount: r.saved_veu_discount == null ? null : Number(r.saved_veu_discount), savedAt: r.spot_saved_at, estimateId: r.saved_estimate_id }, cur);
      return { id: r.id, jobId: r.job_id, jobNumber: job?.job_number ?? null, owner: job?.owners?.full_name ?? null, property: fullAddress(job?.properties?.address_line, job?.properties?.suburb, job?.properties?.postcode), spotSavedAt: r.spot_saved_at, optedOutAt: r.opted_out_at, mediaReceivedAt: r.media_received_at, queuePriority: r.queue_priority, savedPrice: price?.text ?? null, priceChanged: price?.changeNote ?? null, deskCheckStatus: r.desk_check_status, deskCheckReason: r.desk_check_reason };
    }),
  };
}

/** Shared read-only office headline, independent of campaign and operational lane. */
export async function officeSpotsSaved() {
  let total = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from("lead_campaign_responses")
      .select("id, spot_saved_at, opted_out_at, jobs!inner(source, stage)")
      .not("spot_saved_at", "is", null).is("opted_out_at", null)
      .or("source.is.null,source.neq.qa_test", { referencedTable: "jobs" })
      .neq("jobs.stage", "cancelled").order("id").range(from, from + 999);
    if (error) throw new Error(error.message);
    total += officeSpotSavedCount((data ?? []).map((row) => ({
      spot_saved_at: row.spot_saved_at, opted_out_at: row.opted_out_at,
      source: row.jobs.source, stage: row.jobs.stage,
    })));
    if (!data || data.length < 1000) return total;
  }
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

const OWNER_BASE = "https://estimate.homeinsulationvictoria.com.au";
/**
 * Jo-approved "Spot saved" text + email. Queued ONCE per job (never on a second tap, a second device,
 * a calculator save or a video upload after saving). Sending is off, so both are recorded as queued only;
 * the TEST allowlist still decides who could ever receive them.
 */
export async function queueSpotSavedConfirmations(jobId: string, token: string) {
  const { data: done } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", "spot_saved_confirmation_queued").limit(1).maybeSingle();
  if (done) return { queued: false as const };
  const [{ data: job }, { data: r }] = await Promise.all([
    admin.from("jobs").select("source, owners(full_name, phone, email), properties(address_line, suburb, postcode)").eq("id", jobId).maybeSingle(),
    admin.from("lead_campaign_responses").select("saved_veu_discount, saved_gross_total, saved_total, saved_area_m2").eq("job_id", jobId).maybeSingle(),
  ]);
  if (!job) return { queued: false as const };
  const { renderSpotSavedEmail, renderSpotSavedSms, addressBits } = await import("./spot-saved-messages.core");
  const { testSendBlocker } = await import("./test-send.core");
  const { unsubscribeUrlForJob } = await import("./emailsafety.server");
  const { referralUrlForJob } = await import("./referral.server");
  const owner = job.owners as { full_name: string | null; phone: string | null; email: string | null } | null;
  const prop = job.properties as { address_line: string | null; suburb: string | null } | null;
  const bits = addressBits(prop?.address_line ?? null, prop?.suburb ?? null);
  const input = { firstName: owner?.full_name?.trim().split(/\s+/)[0] ?? null, rebate: Number(r?.saved_veu_discount ?? 0), suburb: bits.suburb, shortAddress: bits.short, myJobUrl: `${OWNER_BASE}/my-job/${token}`, optOutUrl: await unsubscribeUrlForJob(jobId), referralUrl: await referralUrlForJob(jobId), estimate: r?.saved_gross_total ? { gross: Number(r.saved_gross_total), customer: Number(r.saved_total), areaM2: Number(r.saved_area_m2), address: bits.short ? `${bits.short} VIC${(prop as { postcode?: string | null } | null)?.postcode ? ` ${(prop as { postcode?: string | null }).postcode}` : ""}` : null, calculatorUrl: `${OWNER_BASE}/estimate/${token}/calculator` } : null };
  const sms = renderSpotSavedSms(input);
  const email = renderSpotSavedEmail(input);
  const now = new Date().toISOString();
  const rows = [
    { channel: "sms", to: owner?.phone ?? null, subject: null, body: sms },
    { channel: "email", to: owner?.email ?? null, subject: email.subject, body: email.text },
  ] as const;
  for (const m of rows) {
    const allow = testSendBlocker({ channel: m.channel, to: m.to, jobSource: job.source, partnerIsTest: false });
    await admin.from("job_communications").insert({
      job_id: jobId, direction: "outbound", channel: m.channel, recipients: m.to ? [m.to] : [], subject: m.subject, body: m.body, provider: "queued",
      sent_at: null, delivery_status: "queued", visibility: "customer", source_event: `spot_saved:${m.channel}`,
      source_reference: allow ? `Queued (sending off). Allowlist: ${allow}` : "Queued (sending off). On TEST allowlist", created_at: now,
    } as never);
  }
  // TEST homes only: deliver the confirmation email to Jo's allowlisted inbox via the test sender.
  if (job.source === "qa_test" && owner?.email) {
    const { sendTestEmail } = await import("./test-send.server");
    const html = (email as { html?: string }).html ?? `<pre>${email.text.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))}</pre>`;
    const t = await sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: true, label: "spot_saved_confirmation", actorId: null } as never, owner.email, email.subject, html, email.text).catch((e) => ({ status: "failed", detail: (e as Error).message }));
    await logEvent(jobId, null, "spot_saved_test_email", `Spot saved confirmation (TEST) ${t.status}: ${t.detail}`, {}, { internal: true }).catch(() => null);
  }
  // Real homes: the ONE real sender. Stays blocked (and logged) until every switch, consent and the AU number are in place.
  if (job.source !== "qa_test" && owner?.phone) {
    const { sendRealSms } = await import("./sms.server");
    await sendRealSms({ type: "spot_saved", idempotencyKey: `spot-saved:${jobId}`, to: owner.phone, body: sms, jobId }).catch(() => null);
  }
  await logEvent(jobId, null, "spot_saved_confirmation_queued", "Spot saved text and email queued (sending is off)", { sms: !!owner?.phone, email: !!owner?.email }, { internal: true });
  return { queued: true as const };
}
