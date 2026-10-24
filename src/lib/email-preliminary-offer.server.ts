// Preliminary email-based Save My Spot – server side (Jo, 22 Oct 2026).
// Flow: an Office reviewer records an append-only preliminary review BOUND to the owner's genuine
// inbound email (job_communications), which also records an immutable individual-reply permission
// bound to that same communication. The approved short invitation is then previewed and individually
// sent through the existing guarded delivery (Resend via the connector gateway, reservation,
// idempotency, uncertain-result handling, immutable job history). Sending is NOT triggered by the
// review alone; spot_saved_at is only ever set by the owner's explicit POST on their secure link.
// Gate 1 and invitation wording stay unchanged; saves prepare the normal estimate and freeze its figures.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { CUSTOMER_BASE } from "./engagement.core";
import { expiryFrom, isWellFormedToken, linkUsable, newToken } from "./estimatelink.core";
import { timeoutSignal } from "./network-timeout.core";
import { SENT_UNKNOWN_PREFIX, UNCERTAIN_SEND_DETAIL } from "./save-spot-delivery.core";
import { SUPPRESSING_EVENTS } from "./emailsafety.core";
import { testRecipientBoundary } from "./comms-test-recipient.core";
import { LAUNCH_CAMPAIGN } from "./launch-campaign.core";
import {
  EMAIL_PRELIMINARY_CONSENT_SOURCE, EMAIL_PRELIMINARY_REVIEW_EVENT, PRELIMINARY_LINK_PURPOSE, PRELIMINARY_SEND_PURPOSE,
  preliminaryConsentKey, preliminaryConsentSnapshot, preliminaryReviewMetadata, preliminarySendBlocker, preliminarySendKey,
  preliminarySavedEstimateSnapshot,
} from "./preliminary-save-spot.core";

export type PreliminarySendResult = { jobId: string; jobNumber: string | null; outcome: "sent" | "skipped" | "blocked" | "failed" | "uncertain"; detail: string; preview?: { to: string; subject: string; html: string; plainText: string; linksReady: boolean }; reviewId?: string; linkToken?: string };

const PRELIMINARY_JOB_SELECT = "id, job_number, source, channel, stage, estimated_area_m2, estimated_area_unknown, owners(full_name, email), properties(address_line, suburb, postcode)";
const PRELIMINARY_STAGES = ["new_enquiry", "eligibility_review", "preliminary_estimate_ready", "ready_check_ready_to_schedule"];

async function latestReview(jobId: string) {
  const { data, error } = await admin.from("customer_engagement_events").select("id, occurred_at, metadata").eq("job_id", jobId).eq("event_type", EMAIL_PRELIMINARY_REVIEW_EVENT).eq("source", "office").order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(1);
  if (error) throw new Error("Could not read the recorded preliminary review. Try again.");
  return data?.[0] ?? null;
}

async function activePreliminaryLink(jobId: string) {
  const { data } = await admin.from("customer_estimate_links").select("id, token, status, expires_at").eq("job_id", jobId).eq("purpose", PRELIMINARY_LINK_PURPOSE).eq("status", "active").maybeSingle();
  return data ?? null;
}

/** Creates the dedicated preliminary secure link on demand. Idempotent while an active link exists. */
async function issuePreliminaryLink(jobId: string) {
  const cur = await activePreliminaryLink(jobId);
  if (cur && linkUsable(cur)) return cur;
  const { data: j } = await admin.from("jobs").select("owner_id").eq("id", jobId).single();
  if (!j?.owner_id) throw new Error("Job has no owner – cannot create the secure link.");
  const { data, error } = await admin.from("customer_estimate_links").insert({ job_id: jobId, owner_id: j.owner_id, purpose: PRELIMINARY_LINK_PURPOSE, token: newToken(), expires_at: expiryFrom() }).select("id, token, status, expires_at").single();
  if (error || !data) throw new Error("Could not create the secure link. Try again.");
  await logEvent(jobId, null, "preliminary_save_spot_link_issued", "Preliminary Save my spot secure link created (not sent)", {}, { internal: true }).catch(() => null);
  return data;
}

/** Jo 23 Oct 2026: the preliminary invitation, its owner-email review and picker are retired and removed.
 *  Only the owner landing/save on already-sent links remains. */
/** Landing read for the owner's secure link. Read-only: never mutates anything. */
export async function preliminarySavePage(token: unknown) {
  if (!isWellFormedToken(token)) return null;
  const { data: l } = await admin.from("customer_estimate_links").select("id, job_id, status, expires_at").eq("token", token).eq("purpose", PRELIMINARY_LINK_PURPOSE).maybeSingle();
  if (!l || !linkUsable(l)) return null;
  const { jobDeletedBlocker } = await import("./job-live.server");
  if (await jobDeletedBlocker(l.job_id)) return null;
  const [{ data: job }, { data: resp }] = await Promise.all([
    admin.from("jobs").select("stage, owners(full_name)").eq("id", l.job_id).maybeSingle(),
    admin.from("lead_campaign_responses").select("spot_saved_at, opted_out_at").eq("job_id", l.job_id).maybeSingle(),
  ]);
  if (!job || job.stage === "cancelled" || job.stage === "complete") return null;
  const owner = job.owners as { full_name: string | null } | null;
  return { firstName: owner?.full_name?.trim().split(/\s+/)[0] ?? null, saved: !!resp?.spot_saved_at };
}

/**
 * Owner's explicit POST on their secure link. Saves the normal estimate figures exactly once;
 * repeated saves never reprice the saved snapshot. Confirmation uses the normal Version 1 email.
 */
export async function savePreliminarySpot(token: unknown) {
  if (!isWellFormedToken(token)) throw new Error("This link is no longer available.");
  const { data: l } = await admin.from("customer_estimate_links").select("id, job_id, status, expires_at").eq("token", token).eq("purpose", PRELIMINARY_LINK_PURPOSE).maybeSingle();
  if (!l || !linkUsable(l)) throw new Error("This link is no longer available.");
  const jobId = l.job_id;
  const { jobDeletedBlocker } = await import("./job-live.server");
  if (await jobDeletedBlocker(jobId)) throw new Error("This link is no longer available.");
  const [{ data: job, error: jobError }, { data: resp, error: respError }] = await Promise.all([
    admin.from("jobs").select("stage, owners(full_name, email)").eq("id", jobId).maybeSingle(),
    admin.from("lead_campaign_responses").select("opted_out_at, spot_saved_at").eq("job_id", jobId).maybeSingle(),
  ]);
  if (jobError || !job || job.stage === "cancelled" || job.stage === "complete") throw new Error("This enquiry is no longer active.");
  if (respError) throw new Error("We couldn't check your records. Please try again.");
  if (resp?.opted_out_at) throw new Error("This enquiry has already been taken off the list.");
  const consent = await (await import("./comms.server")).hasCurrentOwnerContactConsent(jobId);
  if (!consent) throw new Error("Please contact our office so we can help you save your spot.");
  const now = new Date().toISOString();
  let firstSave = false;
  if (!resp?.spot_saved_at) {
    // Normal preparation uses the address, entered ceiling size and current pricing; it never sends.
    const { syncStep3 } = await import("./estimatelink.server");
    await syncStep3(jobId);
    const [{ data: est, error: estimateError }, { data: estLink, error: linkError }] = await Promise.all([
      admin.from("indicative_estimates").select("id, area_m2, insulation_declared, scenarios").eq("job_id", jobId).eq("status", "current").maybeSingle(),
      admin.from("customer_estimate_links").select("id, token, status, expires_at").eq("job_id", jobId).eq("purpose", "step3_estimate").eq("status", "active").maybeSingle(),
    ]);
    if (estimateError || linkError || !estLink || !linkUsable(estLink)) throw new Error("Your estimate is not ready. Please contact our office before saving your spot.");
    const snapshot = preliminarySavedEstimateSnapshot(est ?? null, estLink.token);
    const ins = await admin.from("lead_campaign_responses").upsert({ job_id: jobId, estimate_link_id: estLink.id, campaign: LAUNCH_CAMPAIGN, spot_saved_at: now, video_requested: false, desk_check_status: "not_needed", updated_at: now, ...snapshot }, { onConflict: "job_id", ignoreDuplicates: true }).select("id");
    firstSave = !ins.error && (ins.data?.length ?? 0) > 0;
    if (!firstSave) {
      const upd = await admin.from("lead_campaign_responses").update({ spot_saved_at: now, updated_at: now, estimate_link_id: estLink.id, ...snapshot }).eq("job_id", jobId).is("opted_out_at", null).is("spot_saved_at", null).select("id");
      firstSave = !upd.error && (upd.data?.length ?? 0) > 0;
    }
  }
  const { data: row } = await admin.from("lead_campaign_responses").select("opted_out_at, spot_saved_at").eq("job_id", jobId).maybeSingle();
  if (row?.opted_out_at) throw new Error("This enquiry has already been taken off the list.");
  if (!row?.spot_saved_at) throw new Error("We couldn't save your place. Please try again.");
  if (firstSave) {
    await logEvent(jobId, null, "campaign_spot_saved", "Owner saved a place for a free Ready Check (preliminary email invitation)", { campaign: LAUNCH_CAMPAIGN, preliminary_email: true }, { internal: true });
    // Spot saved → free Ready Check next, same transition as every other save.
    const { data: j } = await admin.from("jobs").select("stage").eq("id", jobId).maybeSingle();
    if (j && ["preliminary_estimate_ready", "new_enquiry", "eligibility_review"].includes(j.stage)) {
      const { transition } = await import("./workflow.server");
      const flag = (to: string) => (e: unknown) => logEvent(jobId, null, "campaign_spot_advance_blocked", `Spot saved but the job could not move to ${to}: ${(e as Error)?.message ?? e}`, { to }, { internal: true }).catch(() => null);
      if (j.stage !== "preliminary_estimate_ready") await transition(jobId, "preliminary_estimate_ready", null, "Owner saved their spot – preliminary queue qualification; final onsite verification required").catch(flag("preliminary_estimate_ready"));
      await transition(jobId, "ready_check_ready_to_schedule", null, "Owner saved their spot – free Ready Check next").catch(flag("ready_check_ready_to_schedule"));
    }
    await queuePreliminarySpotSavedConfirmation(jobId);
  }
  return { ok: true as const };
}

/** Normal saved-estimate email for this path. Queued once; TEST homes go to the allowlist. */
async function queuePreliminarySpotSavedConfirmation(jobId: string) {
  const { data: done } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", "spot_saved_confirmation_queued").limit(1).maybeSingle();
  if (done) return;
  const { data: job } = await admin.from("jobs").select("source, owners(full_name, phone, email)").eq("id", jobId).maybeSingle();
  if (!job) return;
  const owner = job.owners as { full_name: string | null; email: string | null } | null;
  // /my-job only accepts the estimate link purpose, so link it only when the owner already has one;
  // the preliminary token itself would 404 there. Never invent a working link.
  const { data: estLink } = await admin.from("customer_estimate_links").select("token, status, expires_at").eq("job_id", jobId).eq("purpose", "step3_estimate").eq("status", "active").maybeSingle();
  const usable = estLink && (!estLink.expires_at || new Date(estLink.expires_at).getTime() > Date.now()) ? (estLink.token as string) : null;
  const { buildSpotSavedMessages } = await import("./spot-saved-send.server");
  const msgs = usable ? await buildSpotSavedMessages(jobId, usable) : null;
  if (!msgs) throw new Error("The saved estimate confirmation could not be prepared.");
  const email = msgs.email;
  const now = new Date().toISOString();
  // Retain this path's email-only delivery and every existing confirmation safeguard.
  if (job.source !== "qa_test") {
    await logEvent(jobId, null, "spot_saved_confirmation_queued", "Spot saved email prepared", { email: !!owner?.email, preliminary_email: true }, { internal: true });
    const r = await (await import("./spot-saved-send.server")).sendSpotSavedConfirmation(jobId, { token: usable ?? undefined, emailOnly: true }).catch((e) => ({ email: { status: "failed", detail: (e as Error).message } }));
    if (r.email.status === "skipped") await admin.from("job_communications").insert({ job_id: jobId, direction: "outbound", channel: "email", recipients: owner?.email ? [owner.email] : [], subject: email.subject, body: email.text, provider: "not_sent", sent_at: null, delivery_status: "blocked_prelaunch", visibility: "customer", source_event: "spot_saved:email", source_reference: `Not sent: ${r.email.detail}`.slice(0, 200), created_at: now } as never);
    return;
  }
  const { testSendBlocker } = await import("./test-send.core");
  const allow = testSendBlocker({ channel: "email", to: owner?.email ?? null, jobSource: job.source, partnerIsTest: false });
  await admin.from("job_communications").insert({
    job_id: jobId, direction: "outbound", channel: "email", recipients: owner?.email ? [owner.email] : [], subject: email.subject, body: email.text, provider: "queued",
    sent_at: null, delivery_status: "queued", visibility: "customer", source_event: "spot_saved:email",
    source_reference: allow ? `Queued (sending off). Allowlist: ${allow}` : "Queued (sending off). On TEST allowlist", created_at: now,
  } as never);
  if (job.source === "qa_test" && owner?.email) {
    const { sendTestEmail } = await import("./test-send.server");
    const t = await sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: true, label: "preliminary_spot_saved_confirmation", actorId: null } as never, owner.email, email.subject, email.html ?? "", email.text).catch((e) => ({ status: "failed", detail: (e as Error).message }));
    await logEvent(jobId, null, "spot_saved_test_email", `Spot saved confirmation (TEST) ${t.status}: ${t.detail}`, {}, { internal: true }).catch(() => null);
  }
  await logEvent(jobId, null, "spot_saved_confirmation_queued", "Spot saved email queued (sending is off)", { email: !!owner?.email, preliminary_email: true }, { internal: true });
}

void timeoutSignal; // kept for the shared timeout module's import discipline
