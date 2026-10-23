// Preliminary email-based Save My Spot – server side (Jo, 22 Oct 2026).
// Flow: an Office reviewer records an append-only preliminary review BOUND to the owner's genuine
// inbound email (job_communications), which also records an immutable individual-reply permission
// bound to that same communication. The approved short invitation is then previewed and individually
// sent through the existing guarded delivery (Resend via the connector gateway, reservation,
// idempotency, uncertain-result handling, immutable job history). Sending is NOT triggered by the
// review alone; spot_saved_at is only ever set by the owner's explicit POST on their secure link.
// Nothing here touches Gate 1, prices, estimates, media reviews or campaigns.
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
  renderPreliminarySaveSpotEmail, renderPreliminarySpotSavedEmail,
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

/** Creates the dedicated no-estimate secure link on demand. Idempotent while an active link exists. */
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

/**
 * Records the Office preliminary review for one owner-email enquiry. Append-only: one
 * customer_engagement_events row (explicitly NOT a photo/media review) plus one immutable
 * owner_contact_consents row granting individual-reply permission bound to the genuine inbound
 * communication. Requires the inbound email to already be recorded on the job. Sends nothing.
 */
export async function recordEmailPreliminaryReview(jobId: string, actorId: string, input: { communicationId: string; reason: string }) {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 3) throw new Error("A reason is required for the preliminary review.");
  const [{ data: job, error: jobError }, { data: comm, error: commError }] = await Promise.all([
    admin.from("jobs").select("id, job_number, source, channel, stage, owner_id, owners(full_name, email)").eq("id", jobId).maybeSingle(),
    admin.from("job_communications").select("id, job_id, direction, channel, subject, sent_at, created_at").eq("id", input.communicationId).maybeSingle(),
  ]);
  if (jobError || !job) throw new Error("Job not found.");
  if (commError || !comm) throw new Error("Record the owner's email on this job first, then offer from it.");
  if (comm.job_id !== jobId) throw new Error("That email does not belong to this job.");
  if (comm.direction !== "inbound") throw new Error("The preliminary review must be linked to the owner's own inbound email.");
  if (job.source !== "base44" && job.source !== "portal") throw new Error("Only website or manual homeowner enquiries can use this invitation.");
  if (job.channel !== "hivic_sourced") throw new Error("Only Home Insulation Victoria-sourced enquiries can use this invitation.");
  if (!PRELIMINARY_STAGES.includes(job.stage ?? "")) throw new Error("This enquiry has already moved on – no preliminary review from here.");
  const owner = job.owners as { full_name: string | null; email: string | null } | null;
  if (!owner?.email?.trim()) throw new Error("No owner email on this job.");
  if (!job.owner_id) throw new Error("Job has no owner record.");
  const emailAt = comm.sent_at ?? comm.created_at ?? null;

  const now = new Date();
  const metadata = preliminaryReviewMetadata({ reason, communicationId: comm.id, emailAt, reviewer: actorId });
  const { data: ev, error: evError } = await admin.from("customer_engagement_events").insert({
    job_id: jobId, event_type: EMAIL_PRELIMINARY_REVIEW_EVENT, occurred_at: now.toISOString(), source: "office",
    metadata, dedupe_key: `${EMAIL_PRELIMINARY_REVIEW_EVENT}:${jobId}:${now.getTime()}`,
  }).select("id").single();
  if (evError || !ev) throw new Error(`The preliminary review could not be saved: ${evError?.message ?? "unknown error"}`);

  const snapshot = preliminaryConsentSnapshot({ communicationId: comm.id, recordedBy: actorId, recordedAt: now.toISOString() });
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(snapshot))))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const consent = { job_id: jobId, owner_id: job.owner_id, source: EMAIL_PRELIMINARY_CONSENT_SOURCE, consent_status: "granted" as const, consent_key: preliminaryConsentKey(comm.id), consented_at: emailAt, source_reference: comm.id, snapshot, sha256 };
  const { data: cons, error: consError } = await admin.from("owner_contact_consents").insert(consent as never).select("id").single();
  if (consError) {
    // Immutable table with UNIQUE(job_id, source, consent_key): re-recording the same communication is a safe no-op.
    if (!/duplicate/i.test(consError.message)) throw new Error(`The reply permission could not be recorded: ${consError.message}`);
  }
  await logEvent(jobId, actorId, "email_preliminary_review_recorded", `Preliminary review recorded from owner email: ${reason}`.slice(0, 500), { communication_id: comm.id, email_at: emailAt, consent_source: EMAIL_PRELIMINARY_CONSENT_SOURCE }, { internal: true }).catch(() => null);
  return { ok: true as const, reviewId: ev.id as string, consentId: (cons?.id as string | undefined) ?? null };
}

/** Inbound owner emails recorded on the job, for the Office "offer from owner email" picker. Read-only. */
export async function listJobInboundEmails(jobId: string) {
  const { data, error } = await admin.from("job_communications").select("id, subject, recipients, sent_at, created_at, source_event").eq("job_id", jobId).eq("direction", "inbound").eq("channel", "email").order("created_at", { ascending: false }).limit(20);
  if (error) throw new Error("Could not read the job's emails.");
  return (data ?? []).map((r) => ({ id: r.id as string, subject: r.subject as string | null, at: (r.sent_at ?? r.created_at) as string | null }));
}

/**
 * Preview or send Jo's approved preliminary invitation for one job. Preview never sends, never
 * creates links/tokens and never reserves a delivery. Send requires the recorded review, re-checks
 * every guard, reserves once (idempotency key), and records the exact sent content in job history.
 */
export async function preliminarySaveSpotOffer(jobId: string, actorId: string, mode: "preview" | "send", shownReviewId?: string): Promise<PreliminarySendResult> {
  const { data: job, error: jobError } = await admin.from("jobs").select(PRELIMINARY_JOB_SELECT).eq("id", jobId).maybeSingle();
  if (jobError) return { jobId, jobNumber: null, outcome: "blocked", detail: "Could not read the job. Try again; nothing sent." };
  if (!job) return { jobId, jobNumber: null, outcome: "failed", detail: "Job not found" };
  const r = (outcome: PreliminarySendResult["outcome"], detail: string): PreliminarySendResult => ({ jobId, jobNumber: job.job_number, outcome, detail });
  const owner = job.owners as { full_name: string | null; email: string | null } | null;
  const to = owner?.email?.trim().toLowerCase() ?? null;
  const [{ data: opt, error: optError }, { data: resp, error: respError }, review] = await Promise.all([
    admin.from("customer_email_optouts").select("opted_out_at").eq("job_id", jobId).maybeSingle(),
    admin.from("lead_campaign_responses").select("opted_out_at, spot_saved_at").eq("job_id", jobId).maybeSingle(),
    latestReview(jobId),
  ]);
  if (optError || respError) return r("blocked", "Could not verify opt-out and saved-spot records. Try again; nothing sent.");
  const realOn = mode === "send" ? await (await import("./hot-leads-send.server")).realSendingOn() : false;
  const blocker = preliminarySendBlocker({
    source: job.source, channel: job.channel, stage: job.stage, ownerEmail: to,
    spotSaved: !!resp?.spot_saved_at, optedOut: !!(opt?.opted_out_at || resp?.opted_out_at),
    latestReviewId: (review?.id as string | undefined) ?? null, shownReviewId: shownReviewId ?? null, mode, realOn,
  });
  if (blocker) return r(blocker === "Spot already saved." || blocker === "Owner opted out." ? "skipped" : "blocked", blocker);
  if (mode === "send") {
    const boundary = testRecipientBoundary(to, job.source);
    if (boundary.status === "blocked") return r("blocked", boundary.reason);
    const { jobDeletedBlocker } = await import("./job-live.server");
    const del = await jobDeletedBlocker(jobId);
    if (del) return r("blocked", del);
  }
  const firstName = owner?.full_name?.trim().split(/\s+/)[0] ?? null;

  // Preview: render only. Reuse existing links where present; otherwise placeholders (never issue tokens).
  if (mode === "preview") {
    const link = await activePreliminaryLink(jobId);
    const previewLinks = await import("./preview-links.server");
    const existing = await previewLinks.existingUnsubscribeUrl(jobId);
    const linksReady = !!link?.token && !!existing;
    const mail = renderPreliminarySaveSpotEmail({ firstName, saveUrl: link?.token ? `${CUSTOMER_BASE}/save-spot-preliminary/${link.token}` : `${CUSTOMER_BASE}/save-spot-preliminary/PREVIEW-TOKEN`, unsubscribeUrl: existing ?? previewLinks.PREVIEW_UNSUBSCRIBE_URL });
    return { ...r("sent", "Preview only — not sent"), preview: { to: to!, subject: mail.subject, html: mail.html, plainText: mail.plainText, linksReady }, reviewId: review?.id as string };
  }

  // Send: issue the secure link, reserve once, render with the real unsubscribe URL, deliver.
  const link = await issuePreliminaryLink(jobId);
  const { unsubscribeUrlForJob } = await import("./emailsafety.server");
  const unsubscribeUrl = await unsubscribeUrlForJob(jobId);
  const mail = renderPreliminarySaveSpotEmail({ firstName, saveUrl: `${CUSTOMER_BASE}/save-spot-preliminary/${link.token}`, unsubscribeUrl });

  const key = preliminarySendKey(jobId);
  const { data: ex, error: exError } = await admin.from("customer_email_sends").select("id, status, created_at").eq("idempotency_key", key).maybeSingle();
  if (exError) return r("blocked", "Could not check previous delivery. Nothing sent; try again.");
  if (ex && ex.status !== "failed") return r("skipped", ex.status === "sent" || ex.status === "delivered_unrecorded" ? "Already sent to this home." : "Already being sent.");
  let sendId = ex?.id ?? null;
  let reservedAt: string | null = null;
  if (ex) {
    const at = new Date().toISOString();
    const { data: again, error: againError } = await admin.from("customer_email_sends").update({ status: "sending", error: null, created_at: at }).eq("id", ex.id).eq("status", "failed").select("id");
    if (againError || !again?.length) return r("skipped", "Already being sent.");
    reservedAt = at;
  } else {
    const { data, error } = await admin.from("customer_email_sends").insert({ job_id: jobId, estimate_link_id: link.id, purpose: PRELIMINARY_SEND_PURPOSE, idempotency_key: key }).select("id, created_at").single();
    if (error || !data) return r("skipped", "Already being sent.");
    sendId = data.id;
    reservedAt = (data as { created_at?: string | null }).created_at ?? null;
  }
  const finish = async (status: string, provider: string, error: string | null, providerMessageId: string | null = null) => {
    if (!sendId) throw new Error("Email reservation is missing — nothing sent.");
    const write = admin.from("customer_email_sends").update({ status, provider, error, sent_at: status === "sent" ? new Date().toISOString() : null, ...(providerMessageId ? { provider_message_id: providerMessageId } : {}) }).eq("id", sendId);
    const { data: written, error: writeError } = await (reservedAt ? write.eq("created_at", reservedAt) : write).select("id");
    if (writeError) throw new Error("Could not record email outcome; check delivery history before retrying.");
    if (reservedAt && Array.isArray(written) && written.length === 0) throw new Error("This email attempt was already resolved or replaced; its late result was not recorded.");
  };
  let mayHaveSent = false;
  let acceptedId: string | null | undefined;
  try {
    // Final re-read of the binding review and customer restrictions immediately before delivery.
    const [finalReview, optout, response, consent, suppress] = await Promise.all([
      latestReview(jobId),
      admin.from("customer_email_optouts").select("opted_out_at").eq("job_id", jobId).maybeSingle(),
      admin.from("lead_campaign_responses").select("opted_out_at, spot_saved_at").eq("job_id", jobId).maybeSingle(),
      (await import("./comms.server")).hasCurrentOwnerContactConsent(jobId),
      admin.from("customer_engagement_events").select("id").eq("job_id", jobId).in("event_type", SUPPRESSING_EVENTS).limit(1).maybeSingle(),
    ]);
    const finalBlocker = (finalReview?.id ?? null) !== (review?.id ?? null) ? "The recorded review changed; nothing sent."
      : suppress.error ? "Could not verify the owner's communication records; nothing sent."
      : suppress.data?.id ? "The owner has a suppressing record (decline, bounce, complaint or opt-out); nothing sent."
      : !consent ? "No current contact consent or reply permission."
      : optout.error || response.error ? "Could not verify current customer contact restrictions."
      : optout.data?.opted_out_at || response.data?.opted_out_at || response.data?.spot_saved_at ? "Owner response or contact restriction changed; nothing sent."
      : !(await (await import("./hot-leads-send.server")).realSendingOn()) ? "Sending was switched off before delivery."
      : null;
    if (finalBlocker) { await finish("failed", "not_sent", finalBlocker); return r("blocked", finalBlocker); }
    mayHaveSent = true;
    const { resendSend } = await import("./hot-leads-send.server");
    const d = await resendSend(to!, mail.subject, mail.html, mail.plainText, key, unsubscribeUrl);
    if (d.outcome === "rejected" || d.outcome === "not_attempted") { mayHaveSent = false; await finish("failed", "resend", d.detail); return r("failed", d.detail); }
    if (d.outcome === "uncertain") {
      await finish("delivered_unrecorded", "resend", `${SENT_UNKNOWN_PREFIX}${d.detail}`.slice(0, 300));
      await logEvent(jobId, actorId, "email_preliminary_save_spot_outcome_unknown", `Preliminary Save my spot email outcome unknown – not retried automatically. ${d.detail}`.slice(0, 500), { idempotency_key: key }, { internal: true }).catch(() => null);
      return r("uncertain", UNCERTAIN_SEND_DETAIL);
    }
    acceptedId = d.id;
    await finish("sent", "resend", null, d.id);
    const { recordCommunication } = await import("./comms.server");
    await recordCommunication({ jobId, direction: "outbound", channel: "email", recipients: [to!], subject: mail.subject, body: mail.plainText, provider: "resend", providerMessageId: d.id, visibility: "customer", sourceEvent: PRELIMINARY_SEND_PURPOSE, sourceReference: key, createdBy: actorId, deliveryStatus: "sent" } as never).catch(() => null);
  } catch (e) {
    const message = (e as Error).message;
    if (mayHaveSent) {
      const accepted = acceptedId !== undefined ? `Accepted by the email service${acceptedId ? ` (id ${acceptedId})` : ""} but the result could not be recorded: ` : "";
      await finish("delivered_unrecorded", "resend", `${SENT_UNKNOWN_PREFIX}${accepted}${message}`.slice(0, 300), acceptedId ?? null).catch(() => null);
      await logEvent(jobId, actorId, "email_preliminary_save_spot_outcome_unknown", `Preliminary Save my spot email outcome unknown – not retried automatically. ${message}`.slice(0, 500), { idempotency_key: key }, { internal: true }).catch(() => null);
      return r("uncertain", UNCERTAIN_SEND_DETAIL);
    }
    await finish("failed", "resend", message.slice(0, 300));
    return r("failed", message);
  }
  await logEvent(jobId, actorId, "email_preliminary_save_spot_sent", "Preliminary Save my spot invitation sent from recorded owner-email review", { review_id: review?.id, idempotency_key: key }, { internal: true }).catch(() => null);
  return { ...r("sent", "Sent"), reviewId: review?.id as string, linkToken: link.token };
}

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
 * Owner's explicit POST on their secure link. Saves the spot exactly once; records NO estimate,
 * area or rebate snapshot (there is none for this path) and never a made-up figure. The owner
 * receives the approved rebate-free confirmation.
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
    const ins = await admin.from("lead_campaign_responses").upsert({ job_id: jobId, estimate_link_id: l.id, campaign: LAUNCH_CAMPAIGN, spot_saved_at: now, video_requested: false, desk_check_status: "not_needed", updated_at: now }, { onConflict: "job_id", ignoreDuplicates: true }).select("id");
    firstSave = !ins.error && (ins.data?.length ?? 0) > 0;
    if (!firstSave) {
      const upd = await admin.from("lead_campaign_responses").update({ spot_saved_at: now, updated_at: now }).eq("job_id", jobId).is("opted_out_at", null).is("spot_saved_at", null).select("id");
      firstSave = !upd.error && (upd.data?.length ?? 0) > 0;
    }
  }
  const { data: row } = await admin.from("lead_campaign_responses").select("opted_out_at, spot_saved_at").eq("job_id", jobId).maybeSingle();
  if (row?.opted_out_at) throw new Error("This enquiry has already been taken off the list.");
  if (!row?.spot_saved_at) throw new Error("We couldn't save your place. Please try again.");
  if (firstSave) {
    await logEvent(jobId, null, "campaign_spot_saved", "Owner saved a place for a free Ready Check (preliminary email invitation)", { campaign: LAUNCH_CAMPAIGN, preliminary_email: true, no_estimate: true }, { internal: true });
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

/** Rebate-free "spot saved" confirmation for this path. Queued once; TEST homes go to the allowlist. */
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
  const email = renderPreliminarySpotSavedEmail({ firstName: owner?.full_name?.trim().split(/\s+/)[0] ?? null, myJobUrl: usable ? `${CUSTOMER_BASE}/my-job/${usable}` : null });
  const now = new Date().toISOString();
  // Real homes (Jo 23 Oct): the approved rebate-free email really goes while the Spot saved email switch is on.
  if (job.source !== "qa_test") {
    await logEvent(jobId, null, "spot_saved_confirmation_queued", "Spot saved email prepared", { email: !!owner?.email, preliminary_email: true }, { internal: true });
    const r = await (await import("./spot-saved-send.server")).sendSpotSavedConfirmation(jobId, { token: usable ?? undefined }).catch((e) => ({ email: { status: "failed", detail: (e as Error).message } }));
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
    const t = await sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: true, label: "preliminary_spot_saved_confirmation", actorId: null } as never, owner.email, email.subject, email.html, email.text).catch((e) => ({ status: "failed", detail: (e as Error).message }));
    await logEvent(jobId, null, "spot_saved_test_email", `Spot saved confirmation (TEST) ${t.status}: ${t.detail}`, {}, { internal: true }).catch(() => null);
  }
  await logEvent(jobId, null, "spot_saved_confirmation_queued", "Spot saved email queued (sending is off)", { email: !!owner?.email, preliminary_email: true }, { internal: true });
}

void timeoutSignal; // kept for the shared timeout module's import discipline
