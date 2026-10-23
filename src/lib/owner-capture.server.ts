// Secure no-login homeowner video upload. The existing per-job step3 estimate link token is the only credential;
// the job is always taken from the token, never from the client. Files go to the private job-files bucket via a
// short-lived signed upload URL and are recorded once in documents (canonical homeowner media). Never changes stage
// or eligibility; only adds an internal job-history note so the office sees "Video received – priority review".
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { LINK_PURPOSE, isWellFormedToken } from "./estimatelink.core";
import { groupBMediaForJob } from "./group-b-media.server";
import { logEvent } from "./workflow.server";
import { requestedMorePhotosUploadAllowed } from './owner-capture-permission.core';
import { CAPTURE_KIND, CAPTURE_MAX_FILES, CAPTURE_SOURCE_SYSTEM, captureLinkState, capturePath, parseCapturePath, validateCaptureFile, normaliseCaptureType, CAPTURE_MAX_BYTES } from "./owner-capture.core";

const BUCKET = "job-files";
const GENERIC = "This link is not available. Please contact Home Insulation Victoria.";

async function resolve(token: unknown) {
  if (!isWellFormedToken(token)) return { state: "invalid" as const };
  const { data: l, error } = await admin.from("customer_estimate_links").select("id, job_id, status, expires_at").eq("token", token).eq("purpose", LINK_PURPOSE).maybeSingle();
  if (error) throw new Error("Link check unavailable – please try again shortly.");
  if (!l) return { state: "invalid" as const };
  const { data: j, error: je } = await admin.from("jobs").select("id, stage, eligibility_outcome, eligibility_decision_source, eligibility_review_required, job_number, properties(suburb)").eq("id", l.job_id).maybeSingle();
  if (je) throw new Error("Link check unavailable – please try again shortly.");
  const state = captureLinkState(l, j ? { stage: j.stage, outcome: j.eligibility_outcome, decisionSource: j.eligibility_decision_source, reviewRequired: !!j.eligibility_review_required } : null);
  return { state, link: l, job: j };
}

async function existing(jobId: string) {
  const { data, error } = await admin.from("documents").select("external_id, created_at").eq("job_id", jobId).eq("source_system", CAPTURE_SOURCE_SYSTEM);
  if (error) throw new Error("Upload check unavailable – please try again shortly.");
  return data ?? [];
}

import { captureResume } from "./capture-resume.core";

async function requestedUploads(jobId: string, media: Awaited<ReturnType<typeof groupBMediaForJob>>) {
  const { data, error } = await admin.from('office_enquiry_index').select('office_bucket,review_outcome,more_photos_requested_at').eq('id', jobId).maybeSingle();
  if (error || !data) throw new Error('Evidence request check unavailable. Please try again.');
  return data.office_bucket === 'enquiry' && requestedMorePhotosUploadAllowed(media, data.review_outcome, data.more_photos_requested_at);
}

export async function captureStatus(token: unknown) {
  const r = await resolve(token);
  if (r.state !== "ok") return { state: r.state };
  if (!r.link || !r.job) return { state: "invalid" as const };
  const media = await groupBMediaForJob(r.link.job_id, "capture");
  const { data: reviews, error: reviewError } = await admin.from("customer_engagement_events").select("metadata").eq("job_id", r.link.job_id).eq("event_type", "intake_media_reviewed").eq('source', 'office').order("occurred_at", { ascending: false }).order('id', { ascending: false }).limit(1);
  if (reviewError) throw new Error("Evidence review check unavailable. Please try again.");
  const mediaReview = (reviews?.[0]?.metadata as { outcome?: string } | null)?.outcome ?? null;
  const files = await existing(r.link.job_id);
  const suburb = (r.job.properties as { suburb: string | null } | null)?.suburb ?? null;
  // Resume facts for the email's "Send my insulation details" link: a saved spot or a recorded qualifying Yes
  // must not show the four choices again. Read failures throw (fail closed), never "not answered".
  const { data: resp, error: respError } = await admin.from("lead_campaign_responses").select("spot_saved_at, opted_out_at").eq("job_id", r.link.job_id).maybeSingle();
  if (respError) throw new Error("Saved spot check unavailable. Please try again.");
  const c = await (await import("./launch-campaign.server")).campaignLink(token);
  const tap=(await import("./insulation-details.core")).savedInsulationTap((c?.job.properties as {enrichment?:Record<string,unknown>}|null)?.enrichment);
  const resume = captureResume({ spotSaved: !!resp?.spot_saved_at && !resp?.opted_out_at, ownerQualified: !!c?.ownerQualified });
  const morePhotosUploadAllowed = await requestedUploads(r.link.job_id, media);
  return { state: "ok" as const, suburb, reference: r.job.job_number, originalMedia: media, mediaReview, morePhotosUploadAllowed, resume, detailsRoute:tap?.route??null, received: files.length, remaining: Math.max(0, CAPTURE_MAX_FILES - files.length) };
}

export async function startCapture(token: unknown, f: { fileName: string; mime: string; size: number }) {
  const r = await resolve(token);
  if (r.state !== "ok") throw new Error(GENERIC);
  if (!r.link) throw new Error(GENERIC);
  const media = await groupBMediaForJob(r.link.job_id, "capture");
  if (media.excluded && !(await requestedUploads(r.link.job_id, media))) throw new Error(media.received ? "We already have your enquiry photos/video. Our office will review them." : "We are checking your original enquiry uploads. Please contact our office.");
  const v = validateCaptureFile({ mime: f.mime, fileName: f.fileName, size: f.size });
  if (!v.ok) throw new Error(v.error);
  if ((await existing(r.link.job_id)).length >= CAPTURE_MAX_FILES) throw new Error("We've already received the maximum number of files for this property. Thank you!");
  const path = capturePath(r.link.job_id, crypto.randomUUID(), v.mime);
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error("Upload could not start. Please try again.");
  return { path, uploadToken: data.token, mime: v.mime };
}

export async function finishCapture(token: unknown, x: { path: string; fileName: string; deviceModifiedAt: number | null }, meta: { userAgent: string | null }) {
  const r = await resolve(token);
  if (r.state !== "ok") throw new Error(GENERIC);
  if (!r.link) throw new Error(GENERIC);
  const jobId = r.link.job_id;
  const media = await groupBMediaForJob(jobId, 'capture');
  if (media.excluded && !(await requestedUploads(jobId, media))) throw new Error('The photo request has changed. Please contact our office before adding more evidence.');
  const uploadId = parseCapturePath(jobId, x.path);
  if (!uploadId) throw new Error(GENERIC);
  const folder = x.path.slice(0, x.path.lastIndexOf("/"));
  const { data: objs, error: le } = await admin.storage.from(BUCKET).list(folder, { search: uploadId });
  if (le) throw new Error("Upload check unavailable – please try again shortly.");
  const obj = (objs ?? []).find((o) => x.path.endsWith(`/${o.name}`));
  if (!obj) throw new Error("We couldn't find your upload. Please try again.");
  const size = Number((obj.metadata as { size?: number } | null)?.size ?? 0);
  const storedMime = normaliseCaptureType((obj.metadata as { mimetype?: string } | null)?.mimetype ?? null, x.path);
  if (!storedMime || size <= 0 || size > CAPTURE_MAX_BYTES) {
    await admin.storage.from(BUCKET).remove([x.path]);
    throw new Error("That file isn't a supported video or photo. Please try again with MP4, MOV, JPG, PNG or HEIC.");
  }
  { const { verifyStoredUpload } = await import("./upload-safety.server"); await verifyStoredUpload(BUCKET, x.path, storedMime); }
  const safeName = x.fileName.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";
  const { error, data: ins } = await admin.from("documents").insert({
    job_id: jobId, kind: CAPTURE_KIND, title: `Owner insulation ${storedMime.startsWith("video/") ? "video" : "photo"}: ${safeName}`, storage_path: x.path, mime_type: storedMime,
    source_system: CAPTURE_SOURCE_SYSTEM, external_id: uploadId, original_name: safeName, size_bytes: size,
  }).select("id").maybeSingle();
  const duplicate = !!error && /duplicate/i.test(error.message);
  if (error && !duplicate) throw new Error("Your video uploaded but could not be recorded. Please try again.");
  if (!duplicate) {
    await logEvent(jobId, null, "owner_video_received", "Owner video received – priority review (does not confirm eligibility)", {
      document_id: ins?.id ?? null, size_bytes: size, mime_type: storedMime, user_agent: meta.userAgent?.slice(0, 300) ?? null,
      device_reported_modified_at: x.deviceModifiedAt && Number.isFinite(x.deviceModifiedAt) ? new Date(x.deviceModifiedAt).toISOString() : null,
      location: "not captured",
    }, { internal: true });
  }
  // Retry office review even for an already recorded stored file.
  const { markCampaignMediaReceived } = await import("./launch-campaign.server");
  await markCampaignMediaReceived(jobId, r.link.id);
  // Jo 23 Oct 08:23 UTC: the office ALWAYS checks photos first (existing 3-button review); "Qualifies" sends Save my spot.
  return { recorded: true, duplicate };
}
