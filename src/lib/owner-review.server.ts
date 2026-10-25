// Decision 335 (Jo, 25 Oct 2026): My job review screen persistence. Records the owner's star tap (append-only
// `owner_review_stars`) and, for 1–3 stars, their private feedback (append-only `owner_review_feedback`, one Needs me row
// per job via reviewFeedbackRows). No senders, no stage change. Rules: owner-review.core.ts.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { hashToken } from "./worker-links.core";
import {
  OWNER_REVIEW_FEEDBACK_EVENT, OWNER_REVIEW_STARS_EVENT, googleReviewLink, reviewFeedbackBlocker, reviewOutcome, shouldRecordStars,
} from "./owner-review.core";

type Meta = { ip: string | null; userAgent: string | null };
const metaHashes = async (m: Meta) => ({ ip_hash: m.ip ? await hashToken(`owner-review-ip:${m.ip}`) : null, ua_hash: m.userAgent ? await hashToken(`owner-review-ua:${m.userAgent}`) : null });

/** Reviews open once the install is recorded complete. */
async function requireInstalled(jobId: string) {
  const { data, error } = await admin.from("jobs").select("installation_completed_at, deleted_at").eq("id", jobId).maybeSingle();
  if (error) throw new WorkflowError("Your job could not be read. Please try again.");
  if (!data || data.deleted_at) throw new WorkflowError("This job is no longer available.");
  if (!data.installation_completed_at) throw new WorkflowError("You can rate us once your install is done.");
}

/** Screen facts: whether the review is open, the latest stars, whether feedback was sent, and the Google link (4–5 only). */
export async function ownerReviewState(jobId: string) {
  const [{ data: job }, { data: stars }, { count: feedback }] = await Promise.all([
    admin.from("jobs").select("installation_completed_at, deleted_at").eq("id", jobId).maybeSingle(),
    admin.from("workflow_events").select("created_at, details").eq("job_id", jobId).eq("event_type", OWNER_REVIEW_STARS_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", OWNER_REVIEW_FEEDBACK_EVENT),
  ]);
  const latest = Number((stars?.details as { stars?: number } | null)?.stars ?? 0) || null;
  const google = googleReviewLink(process.env["HIV_GOOGLE_REVIEW_URL"]);
  return { open: !!job?.installation_completed_at && !job.deleted_at, latestStars: latest, feedbackSent: (feedback ?? 0) > 0, googleUrl: latest && reviewOutcome(latest) === "google" ? google : null };
}

/** One star tap (1–5). Append-only; the same stars again within 24h is not recorded twice. Returns the Google link for 4–5. */
export async function recordOwnerReviewStars(jobId: string, stars: number, meta: Meta) {
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new WorkflowError("Please tap 1 to 5 stars.");
  await requireInstalled(jobId);
  const { data: prev } = await admin.from("workflow_events").select("created_at, details").eq("job_id", jobId).eq("event_type", OWNER_REVIEW_STARS_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const prevStars = Number((prev?.details as { stars?: number } | null)?.stars ?? 0);
  const record = shouldRecordStars(stars, prev && prevStars ? { stars: prevStars, at: prev.created_at } : null);
  if (record) await logEvent(jobId, null, OWNER_REVIEW_STARS_EVENT, `Owner rated the job ${stars} star${stars === 1 ? "" : "s"} on My job`, { stars, outcome: reviewOutcome(stars), ...(await metaHashes(meta)) }, { internal: true });
  return { recorded: record, outcome: reviewOutcome(stars), googleUrl: reviewOutcome(stars) === "google" ? googleReviewLink(process.env["HIV_GOOGLE_REVIEW_URL"]) : null };
}

/** 1–3 stars: the private "What could we have done better?" note → one append-only event + one Needs me row. Never Google. */
export async function submitOwnerReviewFeedback(jobId: string, stars: number, feedback: string, meta: Meta) {
  const b = reviewFeedbackBlocker(stars, feedback);
  if (b) throw new WorkflowError(b);
  await requireInstalled(jobId);
  await logEvent(jobId, null, OWNER_REVIEW_FEEDBACK_EVENT, `Needs me: owner gave ${stars} star${stars === 1 ? "" : "s"} and private feedback`, { stars, feedback: feedback.trim(), needs_office: true, ...(await metaHashes(meta)) }, { internal: true });
  return { ok: true };
}
