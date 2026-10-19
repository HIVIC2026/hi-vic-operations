// Step 3 estimate email send + follow-up worker. Every attempt re-checks: comms switch, owner consent,
// active secure link, current Gate 1 permission, delivery configuration and idempotency. Never fakes a send.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { customerCommsEnabled, hasCurrentOwnerContactConsent, recordCommunication } from "./comms.server";
import { refreshIndicativeEstimate } from "./estimate.server";
import { LINK_PURPOSE, linkAllowed, linkUsable } from "./estimatelink.core";
import { groupBMediaForJob } from "./group-b-media.server";
import { groupBInvitationBlocker } from "./group-b-media.core";
import { renderEstimateEmail } from "./estimate-email";
import { renderFollowupEmail } from "./followup-email";
import { clickUrl, dedupe, estimateUrl, isActiveFollowupKind, pixelUrl, planFollowup, planInitialFollowups, retryAt, sendBlocker, type ActiveFollowupKind } from "./engagement.core";
import { issueTrackingTokens, jobSummary, recordEngagement } from "./engagement.server";
import { configuredDeliveryAdapter } from "./delivery.server";
import { referralUrlForJob } from "./referral.server";
import type { DeliveryAdapter } from "./delivery.core";
import { reservationAllowed, statusAfterDelivery, withUnsubscribe } from "./emailsafety.core";
import { suppressionFor, unsubscribeUrlForJob } from "./emailsafety.server";

type OfficialOutcome = { kind: "eligible"; mode: "likely" | "onsite" } | { kind: "ineligible"; reason: string | null } | { kind: "hold"; reason: string };

/** Delivery may use only a completed, recorded system/admin Gate 1 decision. */
async function officialOutcomeForDelivery(jobId: string): Promise<OfficialOutcome> {
  const [{ data: job }, { data: activeWork }] = await Promise.all([
    admin.from("jobs").select("source, eligibility_outcome, eligibility_reason, eligibility_decision_source, eligibility_review_required").eq("id", jobId).maybeSingle(),
    admin.from("post_intake_work").select("id").eq("job_id", jobId).in("status", ["queued", "processing", "retry"]).limit(1).maybeSingle(),
  ]);
  if (!job) return { kind: "hold", reason: "job_not_found" };
  if (job.source === "qa_test") return { kind: "hold", reason: "test_delivery_blocked" };
  if (activeWork) return { kind: "hold", reason: "initial_checks_pending" };
  if (job.eligibility_decision_source !== "system" && job.eligibility_decision_source !== "admin") return { kind: "hold", reason: "official_decision_not_recorded" };
  if (job.eligibility_review_required) return { kind: "hold", reason: "eligibility_review_required" };
  if (job.eligibility_outcome === "likely_eligible") return { kind: "eligible", mode: "likely" };
  if (job.eligibility_outcome === "needs_onsite_confirmation") return { kind: "eligible", mode: "onsite" };
  if (job.eligibility_outcome === "does_not_appear_eligible") return { kind: "ineligible", reason: typeof job.eligibility_reason === "string" ? job.eligibility_reason : null };
  return { kind: "hold", reason: "official_decision_not_recorded" };
}

async function gatesFor(jobId: string, adapter: DeliveryAdapter | null) {
  const [{ data: link }, commsEnabled, consent, view] = await Promise.all([
    admin.from("customer_estimate_links").select("id, token, status, expires_at").eq("job_id", jobId).eq("purpose", LINK_PURPOSE).eq("status", "active").maybeSingle(),
    customerCommsEnabled(), hasCurrentOwnerContactConsent(jobId), refreshIndicativeEstimate(jobId),
  ]);
  const activeLink = linkUsable(link ?? null);
  return { link: activeLink ? link! : null, view, gates: { commsEnabled, consent, activeLink, eligibilityOk: linkAllowed(view.mode), providerConfigured: !!adapter } };
}

async function ownerEmail(jobId: string) {
  const { data } = await admin.from("jobs").select("external_enquiry_id, owners(email)").eq("id", jobId).single();
  return { email: (data?.owners as { email: string | null } | null)?.email ?? null, reference: data?.external_enquiry_id ?? null };
}

/** Reserve an idempotency key. Returns the send row id, or null when already sent / in flight. */
async function reserve(jobId: string, linkId: string, purpose: string, key: string) {
  const { data: ex } = await admin.from("customer_email_sends").select("id, status, created_at").eq("idempotency_key", key).maybeSingle();
  // Sent, in flight (any age) or delivered-but-unrecorded never re-calls the provider; only clean failures retry.
  if (ex && !reservationAllowed(ex)) return null;
  if (ex) { await admin.from("customer_email_sends").update({ status: "sending", error: null, created_at: new Date().toISOString() }).eq("id", ex.id); return ex.id; }
  const { data, error } = await admin.from("customer_email_sends").insert({ job_id: jobId, estimate_link_id: linkId, purpose, idempotency_key: key }).select("id").single();
  if (error) return null; // unique race: another worker holds it
  return data.id;
}

async function deliverTracked(x: { jobId: string; linkId: string; linkToken: string; purpose: string; key: string; adapter: DeliveryAdapter; to: string; render: (u: { estimateUrl: string; trackingClickUrl: string; trackingPixelUrl: string; referralUrl: string | null }) => { subject: string; html: string; plainText: string }; actorId: string | null }) {
  const sendId = await reserve(x.jobId, x.linkId, x.purpose, x.key);
  if (!sendId) return { sent: false as const, reason: "already_sent" };
  let delivered = false;
  try {
    const t = await issueTrackingTokens({ jobId: x.jobId, linkId: x.linkId, sendId, purpose: x.purpose });
    const referralUrl = await referralUrlForJob(x.jobId).catch(() => null);
    const mail = withUnsubscribe(x.render({ estimateUrl: estimateUrl(x.linkToken), trackingClickUrl: clickUrl(t.click), trackingPixelUrl: pixelUrl(t.open), referralUrl }), await unsubscribeUrlForJob(x.jobId));
    const r = await x.adapter.deliver({ to: x.to, subject: mail.subject, html: mail.html, text: mail.plainText, idempotencyKey: x.key, purpose: x.purpose });
    delivered = true;
    const communicationId = await recordCommunication({ jobId: x.jobId, direction: "outbound", channel: "email", recipients: [x.to], subject: mail.subject, body: mail.plainText, provider: x.adapter.provider, providerMessageId: r.providerMessageId, visibility: "customer", sourceEvent: x.purpose, sourceReference: x.key, createdBy: x.actorId, deliveryStatus: "sent" });
    await admin.from("customer_email_sends").update({ status: "sent", sent_at: new Date().toISOString(), provider: x.adapter.provider, provider_message_id: r.providerMessageId, communication_id: communicationId }).eq("id", sendId);
    return { sent: true as const, communicationId };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    if (delivered) {
      // Provider accepted it: record as delivered so no retry can send a duplicate.
      await admin.from("customer_email_sends").update({ status: statusAfterDelivery(false), sent_at: new Date().toISOString(), provider: x.adapter.provider, error: `record_failed: ${msg}` }).eq("id", sendId);
      return { sent: false as const, reason: "delivered_unrecorded" };
    }
    const { statusAfterDeliveryError } = await import("./delivery.core");
    if (statusAfterDeliveryError(e) !== "failed") {
      await admin.from("customer_email_sends").update({ status: "delivered_unrecorded", error: `sent_unknown: ${msg}` }).eq("id", sendId);
      return { sent: false as const, reason: "delivered_unrecorded" };
    }
    await admin.from("customer_email_sends").update({ status: "failed", error: msg }).eq("id", sendId);
    await recordEngagement({ jobId: x.jobId, linkId: x.linkId, type: "email_failed", source: x.adapter.provider, metadata: { purpose: x.purpose } });
    return { sent: false as const, reason: "delivery_failed" };
  }
}

/** Initial Step 3 estimate email. Idempotent per secure link + current estimate version. */
export async function sendInitialEstimateEmail(jobId: string, actorId: string | null, adapterIn?: DeliveryAdapter | null) {
  const official = await officialOutcomeForDelivery(jobId);
  if (official.kind !== "eligible") return { sent: false as const, reason: official.kind === "hold" ? official.reason : "official_ineligible" };
  if (official.mode === "onsite") {
    const blocker = groupBInvitationBlocker(await groupBMediaForJob(jobId));
    if (blocker) return { sent: false as const, reason: blocker };
  }
  const adapter = adapterIn === undefined ? await configuredDeliveryAdapter() : adapterIn;
  const { link, view, gates } = await gatesFor(jobId, adapter);
  if (view.mode !== official.mode) return { sent: false as const, reason: "eligibility_view_mismatch" };
  const key = `step3_estimate:${link?.id ?? "none"}:${view.estimate?.id ?? "no_area"}`;
  const { data: prior } = await admin.from("customer_email_sends").select("status").eq("idempotency_key", key).maybeSingle();
  const blocked = sendBlocker({ ...gates, alreadySent: prior?.status === "sent" });
  if (blocked) return { sent: false as const, reason: blocked };
  const owner = await ownerEmail(jobId);
  const to = owner.email;
  if (!to) return { sent: false as const, reason: "no_owner_email" };
  const suppressed = await suppressionFor(jobId, "step3_estimate", to);
  if (suppressed) return { sent: false as const, reason: suppressed };
  const e = view.estimate;
  const standard = e?.primary.by_access.standard;
  const settings = view.settings;
  const values = e && standard && settings ? {
    estimatedTotal: standard.estimated_customer_total,
    veuDiscount: e.applied_discount,
    areaM2: e.area.m2,
    installationPrice: standard.installation,
    installationRatePerM2: settings.r5_install_inc_gst_per_m2,
    assessmentFee: settings.piesa_assessment_inc_gst,
    apFee: settings.ap_management_inc_gst,
    grossProjectTotal: standard.pre_discount_total,
    amountPayableNow: settings.piesa_assessment_inc_gst,
    estimatedRemainingBalance: Math.max(0, standard.estimated_customer_total - settings.piesa_assessment_inc_gst),
    areaIsTypical: e.area.source === "typical_default",
  } : {};
  const r = await deliverTracked({ jobId, linkId: link!.id, linkToken: link!.token, purpose: "step3_estimate", key, adapter: adapter!, to, actorId, render: (u) => renderEstimateEmail({ ...u, ...values, outcome: view.mode === "onsite" ? "onsite" : "likely", reasons: view.onsiteDrivers, reference: owner.reference, existingInsulationPresent: view.insulationDeclared === "present" }) });
  if (!r.sent) return r;
  const at = new Date().toISOString();
  await recordEngagement({ jobId, linkId: link!.id, type: "email_sent", source: adapter!.provider, metadata: { purpose: "step3_estimate" }, dedupeKey: dedupe.sent(key), at });
  const summary = await jobSummary(jobId);
  const plan = planInitialFollowups(at, summary);
  if (plan.length) {
    const { data: rows } = await admin.from("customer_followups").upsert(plan.map((p) => ({ job_id: jobId, estimate_link_id: link!.id, ...p })), { onConflict: "job_id,slot", ignoreDuplicates: true }).select("id, kind");
    for (const f of rows ?? []) await recordEngagement({ jobId, type: "followup_queued", metadata: { followup_kind: f.kind }, dedupeKey: dedupe.followup(f.id, "queued") });
  }
  return { sent: true as const, communicationId: r.communicationId };
}

/** Hourly worker: claim due follow-ups, recheck everything, deliver only through a configured adapter. */
export async function processDueFollowups(opts: { limit?: number; adapter?: DeliveryAdapter | null } = {}) {
  const adapter = opts.adapter === undefined ? await configuredDeliveryAdapter() : opts.adapter;
  const { data: claimed, error } = await admin.rpc("claim_customer_followups", { _limit: opts.limit ?? 20, _lease_seconds: 300 });
  if (error) throw new Error(error.message);
  const results: Array<{ status: string; reason?: string }> = [];
  for (const f of claimed ?? []) {
    try {
      if (f.slot !== "3d" || !isActiveFollowupKind(f.kind)) {
        await admin.from("customer_followups").update({ status: "suppressed", suppression_reason: "retired_followup_kind", lease_until: null }).eq("id", f.id);
        await recordEngagement({ jobId: f.job_id, type: "followup_suppressed", metadata: { followup_kind: f.kind, reason: "retired_followup_kind" }, dedupeKey: dedupe.followup(f.id, "suppressed") });
        results.push({ status: "suppressed", reason: "retired_followup_kind" }); continue;
      }
      const [{ link, gates, view }, summary] = await Promise.all([gatesFor(f.job_id, adapter), jobSummary(f.job_id)]);
      if (view.mode === "onsite") {
        const blocker = groupBInvitationBlocker(await groupBMediaForJob(f.job_id));
        if (blocker) {
          await admin.from("customer_followups").update({ status: "suppressed", suppression_reason: blocker, lease_until: null }).eq("id", f.id);
          results.push({ status: "suppressed", reason: blocker }); continue;
        }
      }
      const plan = planFollowup(f as never, summary, gates);
      if (plan.action === "suppress") {
        await admin.from("customer_followups").update({ status: "suppressed", suppression_reason: plan.reason, lease_until: null }).eq("id", f.id);
        await recordEngagement({ jobId: f.job_id, type: "followup_suppressed", metadata: { followup_kind: f.kind, reason: plan.reason }, dedupeKey: dedupe.followup(f.id, "suppressed") });
        results.push({ status: "suppressed", reason: plan.reason }); continue;
      }
      if (plan.action === "block") {
        await admin.from("customer_followups").update({ status: "pending", blocked_reason: plan.reason, lease_until: null }).eq("id", f.id);
        results.push({ status: "blocked", reason: plan.reason }); continue;
      }
      const to = (await ownerEmail(f.job_id)).email;
      if (!to) { await admin.from("customer_followups").update({ status: "pending", blocked_reason: "no_owner_email", lease_until: null }).eq("id", f.id); results.push({ status: "blocked", reason: "no_owner_email" }); continue; }
      const suppressed = await suppressionFor(f.job_id, "followup", to);
      if (suppressed === "backlog_cutoff_not_set") { await admin.from("customer_followups").update({ status: "pending", blocked_reason: suppressed, lease_until: null, due_at: retryAt(Date.now(), f.attempts ?? 0) }).eq("id", f.id); results.push({ status: "blocked", reason: suppressed }); continue; }
      if (suppressed) {
        await admin.from("customer_followups").update({ status: "suppressed", suppression_reason: suppressed, lease_until: null }).eq("id", f.id);
        await recordEngagement({ jobId: f.job_id, type: "followup_suppressed", metadata: { followup_kind: f.kind, reason: suppressed }, dedupeKey: dedupe.followup(f.id, "suppressed") });
        results.push({ status: "suppressed", reason: suppressed }); continue;
      }
      const { data: fresh } = await admin.from("customer_followups").select("status").eq("id", f.id).maybeSingle();
      if (!fresh || fresh.status !== "queued") { results.push({ status: "suppressed", reason: "changed_after_claim" }); continue; }
      const kind: ActiveFollowupKind = plan.kind;
      await admin.from("customer_followups").update({ kind, reason: kind }).eq("id", f.id);
      const r = await deliverTracked({ jobId: f.job_id, linkId: link!.id, linkToken: link!.token, purpose: kind, key: `followup:${f.id}`, adapter: adapter!, to, actorId: null, render: (u) => renderFollowupEmail({ kind, ...u }) });
      if (r.sent) {
        await admin.from("customer_followups").update({ status: "sent", sent_at: new Date().toISOString(), communication_id: r.communicationId, blocked_reason: null, lease_until: null }).eq("id", f.id);
        await recordEngagement({ jobId: f.job_id, linkId: link!.id, type: "followup_sent", source: adapter!.provider, metadata: { followup_kind: kind }, dedupeKey: dedupe.followup(f.id, "sent") });
        results.push({ status: "sent" });
      } else {
        const failed = f.attempts >= 5;
        await admin.from("customer_followups").update({ status: failed ? "failed" : "pending", last_error: r.reason, due_at: failed ? f.due_at : retryAt(Date.now(), f.attempts ?? 0), lease_until: null }).eq("id", f.id);
        results.push({ status: failed ? "failed" : "retry", reason: r.reason });
      }
    } catch (e) {
      await admin.from("customer_followups").update({ status: "pending", last_error: (e as Error).message.slice(0, 300), due_at: retryAt(Date.now(), f.attempts ?? 0), lease_until: null }).eq("id", f.id);
      results.push({ status: "error" });
    }
  }
  return { claimed: (claimed ?? []).length, results };
}

/** Fallback scan: eligible links and confirmed-ineligible jobs. Each sender rechecks official Gate 1 and idempotency. */
export async function processPendingInitialEstimateEmails(limit = 20, adapterIn?: DeliveryAdapter | null) {
  const adapter = adapterIn === undefined ? await configuredDeliveryAdapter() : adapterIn;
  const counts = { scanned: 0, sent: 0, blocked: 0 };
  // Both global locks first: nothing to do while comms are OFF or delivery is disabled.
  if (!adapter || !(await customerCommsEnabled())) return counts;
  const { data: links } = await admin.from("customer_estimate_links").select("id, job_id, status, expires_at").eq("purpose", LINK_PURPOSE).eq("status", "active").order("created_at", { ascending: true }).limit(200);
  const usable = (links ?? []).filter((l) => linkUsable(l));
  const { data: sent } = usable.length ? await admin.from("customer_email_sends").select("estimate_link_id").eq("purpose", "step3_estimate").in("status", ["sent", "delivered_unrecorded", "sending"]).in("estimate_link_id", usable.map((l) => l.id)) : { data: [] };
  const done = new Set((sent ?? []).map((s) => s.estimate_link_id));
  for (const l of usable.filter((x) => !done.has(x.id)).slice(0, limit)) {
    counts.scanned++;
    if (!(await hasCurrentOwnerContactConsent(l.job_id))) { counts.blocked++; continue; }
    try {
      const r = await sendInitialEstimateEmail(l.job_id, null, adapter); // rechecks Gate 1 mode, link, consent, idempotency key
      if (r.sent) counts.sent++; else counts.blocked++;
    } catch { counts.blocked++; }
  }
  const remaining = Math.max(0, limit - counts.scanned);
  if (!remaining) return counts;
  const { data: ineligible } = await admin.from("jobs").select("id").eq("eligibility_outcome", "does_not_appear_eligible").in("eligibility_decision_source", ["system", "admin"]).eq("eligibility_review_required", false).order("created_at", { ascending: true }).limit(Math.min(200, remaining));
  const candidates = ineligible ?? [];
  const { data: ineligibleSent } = candidates.length ? await admin.from("customer_email_sends").select("job_id").eq("purpose", INELIGIBLE_PURPOSE).in("status", ["sent", "delivered_unrecorded", "sending"]).in("job_id", candidates.map((j) => j.id)) : { data: [] };
  const completedJobs = new Set((ineligibleSent ?? []).map((s) => s.job_id));
  for (const j of candidates.filter((x) => !completedJobs.has(x.id)).slice(0, remaining)) {
    counts.scanned++;
    try {
      const r = await sendPreliminaryIneligibleEmail(j.id, null, adapter);
      if (r.sent) counts.sent++; else counts.blocked++;
    } catch { counts.blocked++; }
  }
  return counts;
}

export const INELIGIBLE_PURPOSE = "preliminary_ineligible" as const;
export const ineligibleKey = (jobId: string) => `${INELIGIBLE_PURPOSE}:${jobId}`;

/** Legacy export name retained. Sends only a confirmed official ineligible result; never schedules follow-ups or resends. */
export async function sendPreliminaryIneligibleEmail(jobId: string, actorId: string | null = null, adapterIn?: DeliveryAdapter | null) {
  const official = await officialOutcomeForDelivery(jobId);
  if (official.kind !== "ineligible") return { sent: false as const, reason: official.kind === "hold" ? official.reason : "official_not_ineligible" };
  const adapter = adapterIn === undefined ? await configuredDeliveryAdapter() : adapterIn;
  if (!(await customerCommsEnabled())) return { sent: false as const, reason: "comms_disabled" };
  if (!(await hasCurrentOwnerContactConsent(jobId))) return { sent: false as const, reason: "no_consent" };
  if (!adapter) return { sent: false as const, reason: "provider_not_configured" };
  const key = ineligibleKey(jobId);
  const owner = await ownerEmail(jobId);
  const to = owner.email;
  if (!to) return { sent: false as const, reason: "no_owner_email" };
  const suppressed = await suppressionFor(jobId, "preliminary_ineligible", to);
  if (suppressed) return { sent: false as const, reason: suppressed };
  const { data: ex } = await admin.from("customer_email_sends").select("id, status, created_at").eq("idempotency_key", key).maybeSingle();
  if (ex?.status === "sent") return { sent: false as const, reason: "already_sent" };
  if (ex && !reservationAllowed(ex)) return { sent: false as const, reason: "already_sent" };
  let sendId = ex?.id ?? null;
  if (ex) await admin.from("customer_email_sends").update({ status: "sending", error: null, created_at: new Date().toISOString() }).eq("id", ex.id);
  else {
    const { data, error } = await admin.from("customer_email_sends").insert({ job_id: jobId, estimate_link_id: null, purpose: INELIGIBLE_PURPOSE, idempotency_key: key }).select("id").single();
    if (error) return { sent: false as const, reason: "already_sent" };
    sendId = data.id;
  }
  let delivered = false;
  try {
    const { renderIneligibleEmail } = await import("./ineligible-email");
    const mail = withUnsubscribe(renderIneligibleEmail({ referralUrl: await referralUrlForJob(jobId), reason: official.reason, reference: owner.reference }), await unsubscribeUrlForJob(jobId));
    const r = await adapter.deliver({ to, subject: mail.subject, html: mail.html, text: mail.plainText, idempotencyKey: key, purpose: INELIGIBLE_PURPOSE });
    delivered = true;
    const communicationId = await recordCommunication({ jobId, direction: "outbound", channel: "email", recipients: [to], subject: mail.subject, body: mail.plainText, provider: adapter.provider, providerMessageId: r.providerMessageId, visibility: "customer", sourceEvent: INELIGIBLE_PURPOSE, sourceReference: key, createdBy: actorId, deliveryStatus: "sent" });
    await admin.from("customer_email_sends").update({ status: "sent", sent_at: new Date().toISOString(), provider: adapter.provider, provider_message_id: r.providerMessageId, communication_id: communicationId }).eq("id", sendId!);
    return { sent: true as const, communicationId };
  } catch (e) {
    if (delivered) {
      await admin.from("customer_email_sends").update({ status: statusAfterDelivery(false), sent_at: new Date().toISOString(), provider: adapter.provider, error: `record_failed: ${(e as Error).message.slice(0, 280)}` }).eq("id", sendId!);
      return { sent: false as const, reason: "delivered_unrecorded" };
    }
    const { statusAfterDeliveryError } = await import("./delivery.core");
    const st = statusAfterDeliveryError(e);
    await admin.from("customer_email_sends").update({ status: st, error: `${st === "failed" ? "" : "sent_unknown: "}${(e as Error).message.slice(0, 280)}` }).eq("id", sendId!);
    return { sent: false as const, reason: st === "failed" ? "delivery_failed" : "delivered_unrecorded" };
  }
}
