// Copies the photos on a job's Mitti Ready Check form(s) into private job-files, once each (Deep fixes Task 1, Jo 5 Nov
// 2026). Forms read: the current linked form and every archived original named in the job's `mitti_form_replaced`
// events. Reads go through the given MittiCall (TEST forms reach the simulator); files through the existing audit media
// route. Never sends, prices or moves a stage. A photo that fails is retried on the next pull.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { mittiApi, type MittiCall } from "./mitti.core";
import type { MittiMediaFetch } from "./mitti.server";
import {
  MITTI_ARCHIVED_UNREADABLE_EVENT, MITTI_PHOTO_DOC_KIND, STALE_CLAIM_MS, archivedUnreadableText, mittiPhotoKey, mittiPhotoPath,
  photoExt, photoRefsFromAudit, replacedAuditIds, type MittiPhotoRef,
} from "./mitti-photos.core";

export type MittiPhotoSyncResult = { copied: number; skipped: number; failed: number; archivedUnreadable: string[] };

type Outcome = "copied" | "skipped" | "failed";

/** One photo: claim the documents row first (unique job/source/external id), so an overlapping pull never downloads it
 *  twice; then download, store and complete the row. A failed copy removes its own claim so the next pull retries. */
async function copyPhoto(jobId: string, auditId: string, ref: MittiPhotoRef, fetchMedia: MittiMediaFetch): Promise<Outcome> {
  const key = mittiPhotoKey(auditId, ref.photoId);
  const { data: existing, error } = await admin.from("documents").select("id,size_bytes,created_at").eq("job_id", jobId).eq("source_system", "mitti").eq("external_id", key).maybeSingle();
  if (error) return "failed"; // a failed read never counts as "not copied yet"
  let claimId: string;
  let fresh = false;
  if (existing) {
    if (existing.size_bytes != null) return "skipped";
    if (Date.now() - Date.parse(String(existing.created_at)) < STALE_CLAIM_MS) return "skipped"; // another pull is copying it
    claimId = existing.id;
  } else {
    const ins = await admin.from("documents").insert({
      job_id: jobId, kind: MITTI_PHOTO_DOC_KIND, title: ref.label || "Ready Check photo", storage_path: mittiPhotoPath(jobId, auditId, ref.photoId, "pending"),
      mime_type: null, uploaded_by: null, source_system: "mitti", external_id: key,
    }).select("id").single();
    if (ins.error) return (ins.error as { code?: string }).code === "23505" ? "skipped" : "failed";
    claimId = ins.data.id; fresh = true;
  }
  try {
    const { bytes, contentType } = await fetchMedia(auditId, ref.photoId);
    if (!bytes.length) throw new Error("empty photo");
    const ext = photoExt(contentType);
    const path = mittiPhotoPath(jobId, auditId, ref.photoId, ext);
    const up = await admin.storage.from("job-files").upload(path, bytes, { contentType, upsert: true });
    if (up.error) throw new Error(up.error.message);
    const done = await admin.from("documents").update({ storage_path: path, mime_type: contentType, size_bytes: bytes.length, original_name: `${ref.photoId}.${ext}` }).eq("id", claimId);
    if (done.error) throw new Error(done.error.message);
    return "copied";
  } catch {
    if (fresh) await admin.from("documents").delete().eq("id", claimId).then(() => undefined, () => undefined);
    return "failed";
  }
}

export async function syncMittiPhotos(jobId: string, call: MittiCall, fetchMedia?: MittiMediaFetch): Promise<MittiPhotoSyncResult> {
  const { data: job, error: jobError } = await admin.from("jobs").select("job_number").eq("id", jobId).single();
  if (jobError || !job) throw new Error(`Job could not be read: ${jobError?.message ?? "not found"}`);
  const { data: linked, error: linkError } = await admin.from("ceiling_measurements").select("external_id").eq("job_id", jobId).eq("is_current", true).eq("external_source", "mitti");
  if (linkError) throw new Error(`Linked Mitti form could not be read: ${linkError.message}`);
  const { data: replaced, error: evError } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "mitti_form_replaced").order("created_at", { ascending: true });
  if (evError) throw new Error(`Replaced Mitti forms could not be read: ${evError.message}`);
  const current = [...new Set((linked ?? []).map((r) => String(r.external_id ?? "").trim()).filter(Boolean))];
  const archived = replacedAuditIds(replaced ?? []).filter((id) => !current.includes(id));

  const media: MittiMediaFetch = fetchMedia ?? (await import("./mitti.server")).realMittiMedia;
  const realMedia = !fetchMedia || media === (await import("./mitti.server")).realMittiMedia;
  const api = mittiApi(call);
  const out: MittiPhotoSyncResult = { copied: 0, skipped: 0, failed: 0, archivedUnreadable: [] };

  for (const auditId of [...current, ...archived]) {
    const isArchived = !current.includes(auditId);
    // TEST forms live in the simulator, which holds no photo files: never ask real Mitti for them.
    if (realMedia) {
      const { isSimId } = await import("./mitti-test-route.core");
      if (isSimId(auditId) || await (await import("./mitti-sim-store.server")).isStoredSimAudit(auditId)) continue;
    }
    let audit: unknown;
    try { audit = await api.getAudit(auditId); }
    catch {
      if (!isArchived) { out.failed++; continue; }
      out.archivedUnreadable.push(auditId);
      const { data: flagged, error } = await admin.from("workflow_events").select("id,details").eq("job_id", jobId).eq("event_type", MITTI_ARCHIVED_UNREADABLE_EVENT);
      if (error) { out.failed++; continue; }
      if (!(flagged ?? []).some((e) => (e.details as { audit_id?: string } | null)?.audit_id === auditId))
        await logEvent(jobId, null, MITTI_ARCHIVED_UNREADABLE_EVENT, archivedUnreadableText(job.job_number), { audit_id: auditId, needs_office: true }, { internal: true });
      continue;
    }
    for (const ref of photoRefsFromAudit(audit)) out[await copyPhoto(jobId, auditId, ref, media)]++;
  }
  return out;
}
