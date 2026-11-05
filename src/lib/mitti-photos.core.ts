// Mitti Ready Check photos copied into the portal (Deep fixes Task 1, Jo 5 Nov 2026). Pure: which photos a Mitti audit
// carries, where each one is stored and which archived forms to read. The copier is mitti-photos.server.ts.
import { labelledItems } from "./install-day.core";

export const MITTI_PHOTO_DOC_KIND = "mitti_photo";
export const MITTI_ARCHIVED_UNREADABLE_EVENT = "mitti_archived_form_unreadable";
export const archivedUnreadableText = (jobNumber: string) => `Old Mitti form for ${jobNumber} is archived – un-archive it so its photos can be copied`;

export type MittiPhotoRef = { photoId: string; url: string; label: string };

/** Every photo on the audit, once, with its question label (first line) and its media download route. */
export function photoRefsFromAudit(audit: unknown): MittiPhotoRef[] {
  const a = (audit ?? {}) as Record<string, unknown>;
  const auditId = String(a["audit_id"] ?? a["id"] ?? "");
  const out: MittiPhotoRef[] = [];
  for (const item of labelledItems(audit)) {
    const label = item.label.split("\n")[0]?.trim() ?? "";
    for (const f of item.media) {
      if (!f.mediaId || out.some((o) => o.photoId === f.mediaId)) continue;
      out.push({ photoId: f.mediaId, url: `/audits/${encodeURIComponent(auditId)}/media/${encodeURIComponent(f.mediaId)}`, label });
    }
  }
  return out;
}

/** The (audit id, photo id) key on the documents row. Prefixed so it never meets the floor plan copy of the same file. */
export const mittiPhotoKey = (auditId: string, photoId: string) => `photo:${auditId}:${photoId}`;

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/heic": "heic", "image/heif": "heif", "image/webp": "webp", "image/gif": "gif" };
export const photoExt = (contentType: string) => EXT[contentType.split(";")[0]!.trim().toLowerCase()] ?? "bin";
export const mittiPhotoPath = (jobId: string, auditId: string, photoId: string, ext: string) => `${jobId}/mitti-photos/${auditId}/${photoId}.${ext}`;

/** Archived forms to read: each `mitti_form_replaced` old audit, in order, once. An event that says no photos were left
 *  behind (`photos_not_copied: []`) has nothing to copy, so its form is not read and never flagged. */
export function replacedAuditIds(events: { details: unknown }[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    const d = (e.details ?? {}) as Record<string, unknown>;
    const id = typeof d["old_audit_id"] === "string" ? d["old_audit_id"].trim() : "";
    if (!id || out.includes(id)) continue;
    if (Array.isArray(d["photos_not_copied"]) && d["photos_not_copied"].length === 0) continue;
    out.push(id);
  }
  return out;
}

/** A claim row (no file yet) older than this belongs to a run that stopped; the next run takes it over. */
export const STALE_CLAIM_MS = 15 * 60_000;
