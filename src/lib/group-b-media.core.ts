// Audience safety only; never decides eligibility or changes evidence/review records.
export type EnquiryMediaDocument = { kind?: string; mime_type?: string | null; storage_path: string; external_id?: string | null; source_system?: string | null };
export type GroupBMediaState = { excluded: boolean; received: boolean; uncertain: boolean; pendingSync: boolean; count: number };
const record = (x: unknown): Record<string, unknown> | null => x && typeof x === "object" && !Array.isArray(x) ? x as Record<string, unknown> : null;
const mediaType = (mime: unknown, name: unknown) => (typeof mime === "string" && /^(image|video)\//i.test(mime)) || (typeof name === "string" && /\.(jpe?g|png|webp|heic|heif|gif|mp4|mov|webm|m4v)(?:[?#].*)?$/i.test(name));
const ATTACHMENT_KEYS = ["media", "photos", "videos", "attachments", "uploaded_files", "uploaded_photos", "uploaded_videos"];

/** Explicit empty arrays confirm no media; missing or historically uncertain manifests still hold. Radio intent is ignored. */
export function originalEnquiryMedia(raw: unknown, documents: EnquiryMediaDocument[], readFailed = false): GroupBMediaState {
  const snapshot = record(raw), answers = record(snapshot?.['answers']);
  const refs = new Set<string>();
  let known = false, hasArrayEntries = false, uncertain = readFailed || !snapshot || snapshot['original_media_manifest_uncertain'] === true;
  for (const source of [snapshot, answers]) {
    if (!source) continue;
    for (const key of ATTACHMENT_KEYS) {
      if (!(key in source)) continue;
      const values = source[key];
      if (!Array.isArray(values)) { if (values != null) uncertain = true; continue; }
      known = true;
      hasArrayEntries ||= values.length > 0;
      for (const value of values) {
        const item = record(value);
        const ref = typeof value === "string" ? value : item?.['source_id'] ?? item?.['id'] ?? item?.['url'] ?? item?.['signed_url'] ?? item?.['storage_path'];
        const name = typeof value === "string" ? value : item?.['name'] ?? item?.['file_name'] ?? ref;
        const mime = item?.['mime_type'] ?? item?.['type'];
        if (mediaType(mime, name) && typeof ref === "string" && ref.trim()) refs.add(ref);
        else if (item && typeof mime === "string" && mime && !/^(image|video)\//i.test(mime)) continue;
        else if (value != null && value !== "") uncertain = true;
      }
    }
  }
  const persisted = documents.filter((d) => d.kind === "intake_media" && mediaType(d.mime_type, d.storage_path));
  const paths = new Set(persisted.map((d) => d.storage_path));
  const imported = new Set(persisted.filter((d) => d.source_system === "base44").map((d) => d.external_id).filter((id): id is string => !!id));
  const pending = [...refs].filter((id) => !imported.has(id));
  const v = record(snapshot?.['original_media_verification']);
  // Empty recognised arrays are authoritative unless another ambiguity/history/read failure holds.
  // Preserve complete-verification support for non-empty lists with no image/video references.
  if (known && hasArrayEntries && refs.size === 0 && v?.['complete'] !== true) uncertain = true;
  uncertain ||= !known;
  const count = paths.size + pending.length;
  return { excluded: count > 0 || uncertain, received: count > 0, uncertain, pendingSync: pending.length > 0, count };
}
export function groupBInvitationBlocker(state: GroupBMediaState): string | null {
  return state.received ? "Existing enquiry photos/video received — office review, no repeat invitation" : state.uncertain ? "Original media sync is not confirmed — invitation held" : null;
}

/** Upload-only view; invitation/sender reads continue to count all homeowner files. */
export function originalMediaForCapture(raw: unknown, documents: EnquiryMediaDocument[], readFailed = false) {
  return originalEnquiryMedia(raw, documents.filter((document) => document.source_system !== "owner_capture"), readFailed);
}
/** The automatic INITIAL Group B email for an unreviewed existing/unknown-insulation enquiry. Received, fully imported
 *  homeowner media gets the approved received-media acknowledgement (no repeat upload request, no eligibility decision);
 *  no media gets the photo/video request; still-importing or ambiguous manifests hold (retried by the sweep). */
export type GroupBInitialAction = { action: "request" | "acknowledge" } | { held: string };
export const MEDIA_IMPORT_PENDING = "Original enquiry photos/video are still importing — acknowledgement waits and is retried automatically";
export function groupBInitialAction(state: GroupBMediaState): GroupBInitialAction {
  if (state.pendingSync) return { held: MEDIA_IMPORT_PENDING };
  if (state.uncertain) return { held: "Original media sync is not confirmed — invitation held" };
  return { action: state.received ? "acknowledge" : "request" };
}
