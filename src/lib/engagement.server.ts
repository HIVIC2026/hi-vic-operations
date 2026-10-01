// Engagement persistence (service role). Records signals and suppresses follow-ups. Never delivers anything.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { LINK_PURPOSE, isWellFormedToken, linkUsable } from "./estimatelink.core";
import { TRACKING_TTL_DAYS, dedupe, isTrackingToken, newTrackingToken, safeMetadata, summarize, uaClass, PREFETCH_WINDOW_MS, type EventType } from "./engagement.core";

export async function recordEngagement(e: { jobId: string; linkId?: string | null; type: EventType; source?: string; metadata?: Record<string, unknown>; dedupeKey?: string | null; at?: string }) {
  const { error } = await admin.from("customer_engagement_events").insert({
    job_id: e.jobId, estimate_link_id: e.linkId ?? null, event_type: e.type, source: e.source ?? "portal",
    metadata: safeMetadata(e.metadata), dedupe_key: e.dedupeKey ?? null, occurred_at: e.at ?? new Date().toISOString(),
  });
  if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
  return !error;
}

export async function jobSummary(jobId: string) {
  const { data } = await admin.from("customer_engagement_events").select("event_type, occurred_at, metadata").eq("job_id", jobId).order("occurred_at").limit(1000);
  return summarize((data ?? []) as never);
}

export async function issueTrackingTokens(x: { jobId: string; linkId: string; sendId: string; purpose: string }) {
  const expires_at = new Date(Date.now() + TRACKING_TTL_DAYS * 86_400_000).toISOString();
  const rows = (["click", "open"] as const).map((kind) => ({ token: newTrackingToken(), kind, job_id: x.jobId, estimate_link_id: x.linkId, email_send_id: x.sendId, purpose: x.purpose, expires_at }));
  const { error } = await admin.from("engagement_tracking_tokens").insert(rows);
  if (error) throw new Error(error.message);
  return { click: rows[0]!.token, open: rows[1]!.token };
}

async function tokenRow(token: string, kind: "click" | "open") {
  if (!isTrackingToken(token)) return null;
  const { data } = await admin.from("engagement_tracking_tokens").select("id, job_id, estimate_link_id, email_send_id, purpose, expires_at, created_at").eq("token", token).eq("kind", kind).maybeSingle();
  return data && Date.parse(data.expires_at) > Date.now() ? data : null;
}

/** Click: log once per token-hour, then return the relative secure estimate path (or the generic unavailable page). */
export async function resolveClick(token: string): Promise<string> {
  const t = await tokenRow(token, "click");
  if (!t) return "/estimate/unavailable";
  await recordEngagement({ jobId: t.job_id, linkId: t.estimate_link_id, type: "email_clicked", source: "tracking", metadata: { purpose: t.purpose }, dedupeKey: dedupe.click(t.id) });
  if (!t.estimate_link_id) return "/estimate/unavailable";
  const { data: l } = await admin.from("customer_estimate_links").select("token, status, expires_at").eq("id", t.estimate_link_id).maybeSingle();
  return l && linkUsable(l) ? `/estimate/${l.token}${t.purpose === "step3_estimate" ? "#confirm" : ""}` : "/estimate/unavailable";
}

/** Open pixel: supporting signal only. Opens within the prefetch window after the send are flagged. */
export async function recordOpen(token: string, userAgent: string | null) {
  const t = await tokenRow(token, "open");
  if (!t) return;
  const prefetch = Date.now() - Date.parse(t.created_at) < PREFETCH_WINDOW_MS;
  await recordEngagement({ jobId: t.job_id, linkId: t.estimate_link_id, type: "email_opened", source: "tracking", metadata: { purpose: t.purpose, ua_class: uaClass(userAgent), prefetch_suspected: prefetch }, dedupeKey: dedupe.open(t.id) });
}

export async function recordEstimateView(jobId: string, linkId: string) {
  await recordEngagement({ jobId, linkId, type: "estimate_viewed", source: "estimate_page", dedupeKey: dedupe.view(linkId) });
}

export async function suppressFollowups(jobId: string, reason: string) {
  const { data } = await admin.from("customer_followups").update({ status: "suppressed", suppression_reason: reason, lease_until: null }).eq("job_id", jobId).in("status", ["pending", "queued", "failed"]).select("id, kind");
  for (const f of data ?? []) await recordEngagement({ jobId, type: "followup_suppressed", metadata: { followup_kind: f.kind, reason }, dedupeKey: dedupe.followup(f.id, "suppressed") });
  return (data ?? []).length;
}

/** STEP 4 INTEGRATION POINT: call when the owner starts the online Ready Check booking. */
export async function recordBookingStarted(jobId: string, source = "portal") {
  await recordEngagement({ jobId, type: "booking_started", source, dedupeKey: dedupe.bookingStarted(jobId) });
}

/** Called from confirmBooking (assessment) and future Step 4 booking. Suppresses all pending estimate follow-ups immediately. */
export async function recordBookingCompleted(jobId: string, source = "portal") {
  await recordEngagement({ jobId, type: "booking_completed", source, metadata: { booking_kind: "assessment" }, dedupeKey: dedupe.bookingCompleted(jobId) });
  await suppressFollowups(jobId, "booking_completed");
}

export async function adminEngagement(jobId: string) {
  const [summary, { data: followups }] = await Promise.all([
    jobSummary(jobId),
    admin.from("customer_followups").select("id, slot, kind, status, due_at, suppression_reason, blocked_reason, sent_at, attempts").eq("job_id", jobId).order("due_at"),
  ]);
  const { adminReferral } = await import("./referral.server");
  return { summary, followups: followups ?? [], referral: await adminReferral(jobId) };
}
