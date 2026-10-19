// Step 3 estimate email send + follow-up worker. Every attempt re-checks: comms switch, owner consent,
// active secure link, current Gate 1 permission, delivery configuration and idempotency. Never fakes a send.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { customerCommsEnabled, hasCurrentOwnerContactConsent, recordCommunication } from "./comms.server";
import { refreshIndicativeEstimate } from "./estimate.server";
import { LINK_PURPOSE, linkAllowed, linkUsable } from "./estimatelink.core";
import { groupBMediaForJob } from "./group-b-media.server";
import { groupBInvitationBlocker } from "./group-b-media.core";
import { type EstimateEmail } from "./estimate-email";
import { renderFollowupEmail } from "./followup-email";
import { JO_RESULT_FALLBACK_URL, renderJoOutcomeEmail, selectJoOutcomeTemplate, type JoInsulation, type JoOutcome } from "./jo-outcome-email.core";
import { clickUrl, CUSTOMER_BASE, dedupe, estimateUrl, isActiveFollowupKind, pixelUrl, planFollowup, planInitialFollowups, retryAt, sendBlocker, type ActiveFollowupKind } from "./engagement.core";
import { issueTrackingTokens, jobSummary, recordEngagement } from "./engagement.server";
import { configuredDeliveryAdapter } from "./delivery.server";
import { referralUrlForJob } from "./referral.server";
import type { DeliveryAdapter } from "./delivery.core";
import { reservationAllowed, statusAfterDelivery, withUnsubscribe } from "./emailsafety.core";
import { testRecipientBoundary } from "./comms-test-recipient.core";
import { suppressionFor, unsubscribeUrlForJob } from "./emailsafety.server";
import { MANUAL_SENT_EVENT, manualSendReference, PREVIEW_LINK_TOKEN } from "./manual-communication.core";

type OfficialOutcome = { kind: "eligible"; mode: "likely" | "onsite" } | { kind: "ineligible"; reason: string | null; decisionSource: "system" | "admin" } | { kind: "hold"; reason: string };

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
  if (job.eligibility_outcome === "does_not_appear_eligible") return { kind: "ineligible", reason: typeof job.eligibility_reason === "string" ? job.eligibility_reason : null, decisionSource: job.eligibility_decision_source };
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

/** This repo's insulation vocabulary -> Jo's. Anything unrecognised stays "unknown" (never assumed). */
function joInsulation(v: string | null | undefined): JoInsulation | null {
  return v === "none" || v === "present" ? v : "unknown";
}

/**
 * P1-R3-S92 (GAP-1): the Jo-approved outcome email for this job, or null when no Jo template applies.
 *
 * The template is chosen by the single canonical selector (`selectJoTemplate`), not by this sender.
 * Jo's placeholders are bound to the EXISTING authorised pages for this customer:
 *   Save my spot  -> /estimate/{token}/campaign   (the existing Save-my-spot page)
 *   Upload media  -> /estimate/{token}/video      (the existing Group B upload page)
 *   Calculator    -> /estimate/{token}/calculator (the customer's own calculator page)
 * Returns null (fail closed) so the caller keeps its existing renderer when Jo has no approved email
 * for this outcome — e.g. an unreviewed existing-insulation home.
 */
function joOutcomeMail(
  input: { outcome: JoOutcome; insulation: JoInsulation | null; ceilingSizeKnown: boolean; deskCheckStatus: string | null | undefined;
    figures: import("./jo-outcome-email.core").JoOutcomeEmailInput["figures"]; reason?: string | null;
    readyCheckFeeIncGst?: number | null; pricingCohort?: "pre_cutover" | "legacy_saved_spot" | "current"; installationRatePerM2?: number | null },
  u: { estimateUrl: string },
  recipient: { firstName: string | null; address: string | null; reference: string | null },
): EstimateEmail | null {
  const desk = input.deskCheckStatus === "looks_eligible" ? ("looks_eligible" as const) : null;
  return renderJoOutcomeEmail({
    outcome: input.outcome,
    insulation: input.insulation,
    ceilingSizeKnown: input.ceilingSizeKnown,
    ...(desk ? { deskCheckStatus: desk } : {}),
    recipient: {
      firstName: recipient.firstName?.trim().split(/\s+/)[0] ?? "there",
      propertyAddress: recipient.address ?? "your property",
      enquiryReference: recipient.reference ?? "",
    },
    ...(input.figures ? { figures: input.figures } : {}),
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    links: {
      saveMySpotUrl: `${u.estimateUrl.replace(/\/$/, "")}/campaign`,
      uploadMediaUrl: `${u.estimateUrl.replace(/\/$/, "")}/video`,
      reviewResultUrl: u.estimateUrl.replace(/\/$/, ""),
      calculatorUrl: `${u.estimateUrl.replace(/\/$/, "")}/calculator`,
    },
    ...(input.readyCheckFeeIncGst === undefined || input.readyCheckFeeIncGst === null ? {} : { readyCheckFeeIncGst: input.readyCheckFeeIncGst }),
    ...(input.pricingCohort ? { pricingCohort: input.pricingCohort } : {}),
    ...(input.installationRatePerM2 === undefined || input.installationRatePerM2 === null ? {} : { installationRatePerM2: input.installationRatePerM2 }),
  });
}

/** The owner's name/address/reference for Jo's greeting, read read-only. Shared with the T8 invitation. */
export async function joRecipientFacts(jobId: string, fallbackReference: string | null) {
  const { data } = await admin.from("jobs").select("external_enquiry_id, owners(full_name), properties(address_line, suburb, postcode)").eq("id", jobId).maybeSingle();
  const owner = data?.owners as { full_name: string | null } | { full_name: string | null }[] | null;
  const prop = data?.properties as { address_line: string | null; suburb: string | null; postcode: string | null } | { address_line: string | null; suburb: string | null; postcode: string | null }[] | null;
  const p = Array.isArray(prop) ? prop[0] : prop;
  const { fullAddress } = await import("./address");
  const address = p ? fullAddress(p.address_line, p.suburb, p.postcode) : null;
  return {
    firstName: (Array.isArray(owner) ? owner[0]?.full_name : owner?.full_name)?.trim().split(/\s+/)[0] ?? null,
    address: address || null,
    reference: data?.external_enquiry_id ?? fallbackReference,
  };
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
  // COM-04 test-recipient boundary (S102): in non-production, a real Step-3 send must target the
  // allow-list (fail closed without one). qa_test jobs are already held earlier
  // (officialOutcomeForDelivery), so a null source is treated as a real send. Inactive in production.
  const boundary = testRecipientBoundary(to, null);
  if (boundary.status === "blocked") return { sent: false as const, reason: "test_recipient_boundary" };
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
  // P1-R3-S92 (GAP-1): the outcome email is chosen by selectJoTemplate(). Jo's templates 1–6 replace the
  // legacy renderer; when none applies (fail closed) the existing renderer is untouched.
  const { data: deskRow } = await admin.from("lead_campaign_responses").select("desk_check_status").eq("job_id", jobId).maybeSingle();
  const areaSource = (e?.area?.source ?? null) as string | null;
  // Same rule as Save my spot: owner size -> "based on the size you provided"; no size -> labelled 150 m² only.
  const { joAreaBasis } = await import("./jo-area-basis.core");
  const { data: ownerArea } = await admin.from("jobs").select("estimated_area_m2, estimated_area_unknown").eq("id", jobId).maybeSingle();
  const areaBasis = joAreaBasis({ areaSource, areaM2: e?.area?.m2 ?? null, ownerAreaM2: ownerArea?.estimated_area_unknown ? null : Number(ownerArea?.estimated_area_m2) || null });
  if (!areaBasis.ok) return { sent: false as const, reason: "area_basis_mismatch" };
  const joFacts = {
    outcome: (view.mode === "onsite" ? "needs_onsite_confirmation" : "likely_eligible") as JoOutcome,
    insulation: joInsulation(view.insulationDeclared),
    ceilingSizeKnown: areaBasis.ceilingSizeKnown,
    deskCheckStatus: (deskRow as { desk_check_status?: string | null } | null)?.desk_check_status ?? null,
    figures: e && standard && settings ? {
      veuRebate: e.applied_discount,
      customerTotal: standard.estimated_customer_total,
      totalBeforeRebate: standard.pre_discount_total,
      installation: standard.installation,
      piesaFee: settings.piesa_assessment_inc_gst,
      apFee: settings.ap_management_inc_gst,
      ceilingAreaM2: areaBasis.areaM2,
      areaEstimated: areaBasis.areaEstimated,
    } : undefined,
    // The Ready Check is always free, so Jo's copy is rendered untouched.
    ...(settings && typeof settings.r5_install_inc_gst_per_m2 === "number" ? { installationRatePerM2: settings.r5_install_inc_gst_per_m2 } : {}),
  };
  void values;
  // P1-S77: Jo's approved template is the ONLY email this sender can deliver. Checked BEFORE any reservation, so an
  // enquiry no Jo template covers (or without itemised figures) is held for manual review — never sent the old email.
  if (!joFacts.figures || !selectJoOutcomeTemplate({ ...joFacts, deskCheckStatus: joFacts.deskCheckStatus === "looks_eligible" ? "looks_eligible" : null })) {
    return { sent: false as const, reason: "no_jo_template_manual_review" };
  }
  const who = await joRecipientFacts(jobId, owner.reference);
  const r = await deliverTracked({ jobId, linkId: link!.id, linkToken: link!.token, purpose: "step3_estimate", key, adapter: adapter!, to, actorId, render: (u) => {
    const jo = joOutcomeMail(joFacts as never, u, who);
    if (!jo) throw new Error("No approved Jo template applies — held for manual review; nothing sent.");
    return jo;
  } });
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
      if (suppressed === "backlog_cutoff_not_set") { await admin.from("customer_followups").update({ status: "pending", blocked_reason: suppressed, lease_until: null, due_at: retryAt() }).eq("id", f.id); results.push({ status: "blocked", reason: suppressed }); continue; }
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
        await admin.from("customer_followups").update({ status: failed ? "failed" : "pending", last_error: r.reason, due_at: failed ? f.due_at : retryAt(), lease_until: null }).eq("id", f.id);
        results.push({ status: failed ? "failed" : "retry", reason: r.reason });
      }
    } catch (e) {
      await admin.from("customer_followups").update({ status: "pending", last_error: (e as Error).message.slice(0, 300), lease_until: null }).eq("id", f.id);
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

/** S20-R01: the automatic reply to ONE enquiry's official ineligible decision (lead-email-routing only – never the
 *  scheduled backlog worker). Master switch on: the existing path, unchanged. Master switch off: only a NEW enquiry
 *  while automatic enquiry emails are on (enquiry-auto-reply.core.ts), delivered through the same email service (Resend)
 *  Save my spot already uses – never the Base44 bridge, whose unclear outcomes are recorded as retryable refusals.
 *  Every sender rule below still applies. */
export async function sendDecisionIneligibleEmail(jobId: string, ctx: import("./manual-backlog.core").LeadRouteContext = {}) {
  const { isManualBacklog } = await import("./manual-backlog.core");
  // Manually-approved ENQ_01 backlog only: the master switch must be on (no new-enquiry gate fallback).
  if (isManualBacklog(ctx)) return (await customerCommsEnabled()) ? sendPreliminaryIneligibleEmail(jobId, null, undefined, { manualBacklog: ctx.manualBacklog! }) : { sent: false as const, reason: "comms_disabled" };
  if (await customerCommsEnabled()) return sendPreliminaryIneligibleEmail(jobId, null);
  const { newEnquiryAutoReplyGate } = await import("./enquiry-auto-reply.server");
  const gate = await newEnquiryAutoReplyGate(jobId);
  if (!gate.allowed) return { sent: false as const, reason: gate.reason };
  const adapter = (await import("./hot-leads-send.server")).resendDeliveryAdapter();
  return sendPreliminaryIneligibleEmail(jobId, null, adapter, { newEnquiryAutoReply: true });
}

/** Legacy export name retained. Sends only a confirmed official ineligible result; never schedules follow-ups or resends. */
export async function sendPreliminaryIneligibleEmail(jobId: string, actorId: string | null = null, adapterIn?: DeliveryAdapter | null, opts: { newEnquiryAutoReply?: boolean; manualBacklog?: import("./manual-backlog.core").ManualBacklogTrust } = {}) {
  const official = await officialOutcomeForDelivery(jobId);
  if (official.kind !== "ineligible") return { sent: false as const, reason: official.kind === "hold" ? official.reason : "official_not_ineligible" };
  const adapter = adapterIn === undefined ? await configuredDeliveryAdapter() : adapterIn;
  // The master switch, or (S20-R01, decision trigger only) the new-enquiry gate re-checked here – the flag alone never permits.
  if (!(await customerCommsEnabled()) && !(opts.newEnquiryAutoReply === true && (await (await import("./enquiry-auto-reply.server")).newEnquiryAutoReplyGate(jobId)).allowed)) return { sent: false as const, reason: "comms_disabled" };
  if (!(await hasCurrentOwnerContactConsent(jobId))) return { sent: false as const, reason: "no_consent" };
  if (!adapter) return { sent: false as const, reason: "provider_not_configured" };
  const key = ineligibleKey(jobId);
  const owner = await ownerEmail(jobId);
  const to = owner.email;
  if (!to) return { sent: false as const, reason: "no_owner_email" };
  const suppressed = await suppressionFor(jobId, "preliminary_ineligible", to, opts.manualBacklog ? { manualBacklog: opts.manualBacklog } : {});
  if (suppressed) return { sent: false as const, reason: suppressed };
  // STEP 17: Office already sent this email by hand (recorded "Sent manually") – never send it again.
  const { data: manual, error: manualError } = await admin.from("job_communications").select("id").eq("job_id", jobId).eq("source_event", MANUAL_SENT_EVENT).eq("source_reference", manualSendReference("ineligible_result")).limit(1).maybeSingle();
  if (manualError || manual) return { sent: false as const, reason: manualError ? "manual_send_check_failed" : "manual_send_recorded" };
  const { data: ex } = await admin.from("customer_email_sends").select("id, status, created_at").eq("idempotency_key", key).maybeSingle();
  if (ex?.status === "sent") return { sent: false as const, reason: "already_sent" };
  if (ex && !reservationAllowed(ex)) return { sent: false as const, reason: "already_sent" };
  let sendId = ex?.id ?? null;
  if (ex) {
    // S20-R01: re-reserve a confirmed failure atomically (as Save my spot does) – two decisions that read the same failed
    // row at the same moment can't both send.
    const { data: again, error: againError } = await admin.from("customer_email_sends").update({ status: "sending", error: null, created_at: new Date().toISOString() }).eq("id", ex.id).eq("status", "failed").select("id");
    if (againError || !again?.length) return { sent: false as const, reason: "already_sent" };
  } else {
    const { data, error } = await admin.from("customer_email_sends").insert({ job_id: jobId, estimate_link_id: null, purpose: INELIGIBLE_PURPOSE, idempotency_key: key }).select("id").single();
    if (error) return { sent: false as const, reason: "already_sent" };
    sendId = data.id;
  }
  let delivered = false;
  try {
    // S20-R01: an automatic reply to an OFFICE decision never includes the Office's free-text reason (an internal note,
    // not reviewed for the customer); the email uses its standard wording. System Gate 1 reasons are unchanged.
    const reason = opts.newEnquiryAutoReply === true && official.decisionSource !== "system" ? null : official.reason;
    const mail = await renderPreliminaryIneligibleMail(jobId, reason, owner.reference);
    if (!mail) {
      // No approved T7 render is possible (usually no secure link yet). Fail closed, release the reservation so the
      // Office can retry once the link exists, and leave the reason visible for the queue.
      await admin.from("customer_email_sends").update({ status: "failed", error: "no_approved_template: no secure estimate link for T7" }).eq("id", sendId!);
      return { sent: false as const, reason: "no_approved_template" };
    }
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

/** The exact ineligible email the sender delivers; shared so the Office copy below can never drift from it.
 *  `links` (preview only) supplies existing or placeholder links instead of creating tokens. */
/** Jo's T7 only. Returns null when the approved template cannot be rendered, so the caller can fail closed —
 *  the legacy ineligible renderer is deliberately never used for a customer send (Jo: no old templates).
 *  P1-S77: T7 does NOT need a secure estimate link. Gate 1 never allows (and syncStep3 revokes) an estimate link for
 *  an ineligible job, so requiring one refused EVERY ineligible reply. "Review my result" opens the customer's link
 *  when one exists, otherwise the public homeowner page the previous ineligible email used; the calculator line
 *  opens the public calculator. Preview and send use the same rule, so the Office copy equals the sent email. */
async function renderPreliminaryIneligibleMail(jobId: string, reason: string | null, reference: string | null, links?: { referralUrl: string; unsubscribeUrl: string }) {
  const { safeReason } = await import("./ineligible-email");
  const who = await joRecipientFacts(jobId, reference);
  const { data: link } = await admin.from("customer_estimate_links").select("token").eq("job_id", jobId).eq("purpose", LINK_PURPOSE).eq("status", "active").maybeSingle();
  const base = link?.token ? `${CUSTOMER_BASE}/estimate/${link.token}` : null;
  const jo = renderJoOutcomeEmail({
    outcome: "does_not_appear_eligible",
    insulation: null,
    ceilingSizeKnown: false,
    recipient: {
      firstName: who.firstName ?? "there",
      propertyAddress: who.address ?? "your property",
      enquiryReference: who.reference ?? "",
    },
    // Only a short customer-safe reason is shown (internal codes/markup are dropped → Jo's standard wording).
    reason: safeReason(reason),
    links: {
      saveMySpotUrl: "",
      uploadMediaUrl: "",
      reviewResultUrl: base ?? JO_RESULT_FALLBACK_URL,
      calculatorUrl: "",
    },
  });
  if (!jo) return null;
  return withUnsubscribe(jo, links ? links.unsubscribeUrl : await unsubscribeUrlForJob(jobId));
}

/** STEP 17/32 (A1 manual sending): render-only twin of sendPreliminaryIneligibleEmail for Office to copy. Same official
 *  result, consent, owner and renderer; it never reserves a key, delivers or records anything. By default it creates no
 *  link token (existing links or placeholders, linksReady=false when any is missing); `issueLinks` is the explicit
 *  Office "Create sending links" step. The global lock and contact suppression are applied by the caller
 *  (manual-communication.server.ts). */
export async function prepareIneligibleEmailForOffice(jobId: string, opts: { issueLinks?: boolean } = {}): Promise<{ ok: true; to: string; subject: string; html: string; plainText: string; linksReady: boolean } | { ok: false; reason: string }> {
  const official = await officialOutcomeForDelivery(jobId);
  if (official.kind !== "ineligible") return { ok: false, reason: official.kind === "hold" ? official.reason : "official_not_ineligible" };
  if (!(await hasCurrentOwnerContactConsent(jobId))) return { ok: false, reason: "no_consent" };
  const owner = await ownerEmail(jobId);
  if (!owner.email) return { ok: false, reason: "no_owner_email" };
  let links: { referralUrl: string; unsubscribeUrl: string } | undefined;
  let linksReady = true;
  if (!opts.issueLinks) {
    const p = await import("./preview-links.server");
    const [referral, unsubscribe] = await Promise.all([p.existingReferralUrl(jobId), p.existingUnsubscribeUrl(jobId)]);
    linksReady = !!referral && !!unsubscribe;
    links = { referralUrl: referral ?? p.PREVIEW_REFERRAL_URL, unsubscribeUrl: unsubscribe ?? p.PREVIEW_UNSUBSCRIBE_URL };
  }
  // Same render rule as the real send (P1-S77), so the Office copy is the email the customer would receive.
  const mail = await renderPreliminaryIneligibleMail(jobId, official.reason, owner.reference, links);
  if (!mail) return { ok: false, reason: "no_approved_template" };
  return { ok: true, to: owner.email, subject: mail.subject, html: mail.html, plainText: mail.plainText, linksReady };
}
