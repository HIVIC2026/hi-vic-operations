// Step 3 estimate email send + follow-up worker. Every attempt re-checks: comms switch, owner consent,
// active secure link, current Gate 1 permission, delivery configuration and idempotency. Never fakes a send.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { customerCommsEnabled, hasCurrentOwnerContactConsent, recordCommunication } from "./comms.server";
import { refreshIndicativeEstimate } from "./estimate.server";
import { LINK_PURPOSE, linkAllowed, linkUsable } from "./estimatelink.core";
import { renderEstimateEmail } from "./estimate-email";
import { renderFollowupEmail } from "./followup-email";
import { clickUrl, dedupe, estimateUrl, pixelUrl, planFollowup, planInitialFollowups, retryAt, sendBlocker, type FollowupKind } from "./engagement.core";
import { issueTrackingTokens, jobSummary, recordEngagement } from "./engagement.server";
import { configuredDeliveryAdapter } from "./delivery.server";
import type { DeliveryAdapter } from "./delivery.core";

async function gatesFor(jobId: string, adapter: DeliveryAdapter | null) {
  const [{ data: link }, commsEnabled, consent, view] = await Promise.all([
    admin.from("customer_estimate_links").select("id, token, status, expires_at").eq("job_id", jobId).eq("purpose", LINK_PURPOSE).eq("status", "active").maybeSingle(),
    customerCommsEnabled(), hasCurrentOwnerContactConsent(jobId), refreshIndicativeEstimate(jobId),
  ]);
  const activeLink = linkUsable(link ?? null);
  return { link: activeLink ? link! : null, view, gates: { commsEnabled, consent, activeLink, eligibilityOk: linkAllowed(view.mode), providerConfigured: !!adapter } };
}

async function ownerEmail(jobId: string) {
  const { data } = await admin.from("jobs").select("owners(email)").eq("id", jobId).single();
  return (data?.owners as { email: string | null } | null)?.email ?? null;
}

/** Reserve an idempotency key. Returns the send row id, or null when already sent / in flight. */
async function reserve(jobId: string, linkId: string, purpose: string, key: string) {
  const { data: ex } = await admin.from("customer_email_sends").select("id, status, created_at").eq("idempotency_key", key).maybeSingle();
  if (ex?.status === "sent") return null;
  if (ex?.status === "sending" && Date.now() - Date.parse(ex.created_at) < 10 * 60_000) return null;
  if (ex) { await admin.from("customer_email_sends").update({ status: "sending", error: null, created_at: new Date().toISOString() }).eq("id", ex.id); return ex.id; }
  const { data, error } = await admin.from("customer_email_sends").insert({ job_id: jobId, estimate_link_id: linkId, purpose, idempotency_key: key }).select("id").single();
  if (error) return null; // unique race: another worker holds it
  return data.id;
}

async function deliverTracked(x: { jobId: string; linkId: string; linkToken: string; purpose: string; key: string; adapter: DeliveryAdapter; to: string; render: (u: { estimateUrl: string; trackingClickUrl: string; trackingPixelUrl: string }) => { subject: string; html: string; plainText: string }; actorId: string | null }) {
  const sendId = await reserve(x.jobId, x.linkId, x.purpose, x.key);
  if (!sendId) return { sent: false as const, reason: "already_sent" };
  try {
    const t = await issueTrackingTokens({ jobId: x.jobId, linkId: x.linkId, sendId, purpose: x.purpose });
    const mail = x.render({ estimateUrl: estimateUrl(x.linkToken), trackingClickUrl: clickUrl(t.click), trackingPixelUrl: pixelUrl(t.open) });
    const r = await x.adapter.deliver({ to: x.to, subject: mail.subject, html: mail.html, text: mail.plainText, idempotencyKey: x.key, purpose: x.purpose });
    const communicationId = await recordCommunication({ jobId: x.jobId, direction: "outbound", channel: "email", recipients: [x.to], subject: mail.subject, body: mail.plainText, provider: x.adapter.provider, providerMessageId: r.providerMessageId, visibility: "customer", sourceEvent: x.purpose, sourceReference: x.key, createdBy: x.actorId, deliveryStatus: "sent" });
    await admin.from("customer_email_sends").update({ status: "sent", sent_at: new Date().toISOString(), provider: x.adapter.provider, provider_message_id: r.providerMessageId, communication_id: communicationId }).eq("id", sendId);
    return { sent: true as const, communicationId };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    await admin.from("customer_email_sends").update({ status: "failed", error: msg }).eq("id", sendId);
    await recordEngagement({ jobId: x.jobId, linkId: x.linkId, type: "email_failed", source: x.adapter.provider, metadata: { purpose: x.purpose } });
    return { sent: false as const, reason: "delivery_failed" };
  }
}

/** Initial Step 3 estimate email. Idempotent per secure link + current estimate version. */
export async function sendInitialEstimateEmail(jobId: string, actorId: string | null, adapter: DeliveryAdapter | null = configuredDeliveryAdapter()) {
  const { link, view, gates } = await gatesFor(jobId, adapter);
  const key = `step3_estimate:${link?.id ?? "none"}:${view.estimate?.id ?? "no_area"}`;
  const { data: prior } = await admin.from("customer_email_sends").select("status").eq("idempotency_key", key).maybeSingle();
  const blocked = sendBlocker({ ...gates, alreadySent: prior?.status === "sent" });
  if (blocked) return { sent: false as const, reason: blocked };
  const to = await ownerEmail(jobId);
  if (!to) return { sent: false as const, reason: "no_owner_email" };
  const e = view.estimate;
  const values = e ? { estimatedTotal: e.primary.by_access.standard.estimated_customer_total, veuDiscount: e.applied_discount, areaM2: e.area.m2 } : {};
  const r = await deliverTracked({ jobId, linkId: link!.id, linkToken: link!.token, purpose: "step3_estimate", key, adapter: adapter!, to, actorId, render: (u) => renderEstimateEmail({ ...u, ...values }) });
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
  const adapter = opts.adapter === undefined ? configuredDeliveryAdapter() : opts.adapter;
  const { data: claimed, error } = await admin.rpc("claim_customer_followups", { _limit: opts.limit ?? 20, _lease_seconds: 300 });
  if (error) throw new Error(error.message);
  const results: Array<{ status: string; reason?: string }> = [];
  for (const f of claimed ?? []) {
    try {
      const [{ link, gates }, summary] = await Promise.all([gatesFor(f.job_id, adapter), jobSummary(f.job_id)]);
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
      const to = await ownerEmail(f.job_id);
      if (!to) { await admin.from("customer_followups").update({ status: "pending", blocked_reason: "no_owner_email", lease_until: null }).eq("id", f.id); results.push({ status: "blocked", reason: "no_owner_email" }); continue; }
      const kind: FollowupKind = plan.kind;
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
