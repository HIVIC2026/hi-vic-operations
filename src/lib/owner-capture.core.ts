// Secure no-login homeowner video capture: pure rules (types, sizes, storage paths, page state). No I/O.
// A video is OPTIONAL evidence for office priority review only: it never confirms eligibility,
// never replaces the free Ready Check and never moves a job.
import { linkUsable } from "./estimatelink.core";

export const CAPTURE_SOURCE_SYSTEM = "owner_capture";
export const CAPTURE_KIND = "intake_media"; // same canonical homeowner media folder as website uploads
export const CAPTURE_MAX_BYTES = 200 * 1024 * 1024; // job-files bucket limit
export const CAPTURE_MAX_FILES = 5;
export const CAPTURE_TYPES: Record<string, string> = {
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/3gpp": "3gp", "video/x-m4v": "m4v",
  "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/heif": "heif", "image/webp": "webp",
};
const EXT_TYPES: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", "3gp": "video/3gpp", m4v: "video/x-m4v", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", heif: "image/heif", webp: "image/webp" };
/** Stages after which the invitation is closed. */
export const CAPTURE_CLOSED_STAGES = new Set(["cancelled", "complete", "on_hold"]);

/** iPhones sometimes report an empty type; fall back to the extension only for known video extensions. */
export function normaliseCaptureType(mime: string | null | undefined, fileName: string | null | undefined): string | null {
  const m = (mime ?? "").toLowerCase().split(";")[0]!.trim();
  if (CAPTURE_TYPES[m]) return m;
  if (m && m !== "application/octet-stream") return null;
  const ext = (fileName ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return EXT_TYPES[ext] ?? null;
}

export function normaliseVideoType(mime: string | null | undefined, fileName: string | null | undefined): string | null {
  const type = normaliseCaptureType(mime, fileName);
  return type?.startsWith("video/") ? type : null;
}

export function validateVideo(x: { mime: string | null; fileName: string | null; size: number }): { ok: true; mime: string } | { ok: false; error: string } {
  const mime = normaliseVideoType(x.mime, x.fileName);
  if (!mime) return { ok: false, error: "Please choose a video file (MP4 or iPhone MOV)." };
  if (!Number.isFinite(x.size) || x.size <= 0) return { ok: false, error: "That file looks empty. Please try again." };
  if (x.size > CAPTURE_MAX_BYTES) return { ok: false, error: "That video is larger than 200 MB. Please record a shorter clip (under about 1 minute)." };
  return { ok: true, mime };
}

export function validateCaptureFile(x: { mime: string | null; fileName: string | null; size: number }): { ok: true; mime: string } | { ok: false; error: string } {
  const mime = normaliseCaptureType(x.mime, x.fileName);
  if (!mime) return { ok: false, error: "Please choose a video or photo (MP4, MOV, JPG, PNG or HEIC)." };
  if (!Number.isFinite(x.size) || x.size <= 0) return { ok: false, error: "That file looks empty. Please try again." };
  if (x.size > CAPTURE_MAX_BYTES) return { ok: false, error: "That file is larger than 200 MB. Please choose a shorter video or smaller photo." };
  return { ok: true, mime };
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export function capturePath(jobId: string, uploadId: string, mime: string) {
  return `${jobId}/intake/owner-capture/${uploadId}.${CAPTURE_TYPES[mime] ?? "bin"}`;
}
/** Server-side check that a client-returned path belongs to THIS link's job. Returns the upload id or null. */
export function parseCapturePath(jobId: string, path: unknown): string | null {
  if (typeof path !== "string") return null;
  const m = path.match(new RegExp(`^(${UUID})/intake/owner-capture/(${UUID})\\.(mp4|mov|webm|3gp|m4v|jpg|png|heic|heif|webp)$`));
  return m && m[1] === jobId ? m[2]! : null;
}

export type CaptureLinkState = "ok" | "invalid" | "closed";
export function captureLinkState(l: { status: string; expires_at: string } | null, job: { stage: string; outcome: string | null; decisionSource: string | null; reviewRequired: boolean } | null, now = Date.now()): CaptureLinkState {
  // Jo 1 Nov 2026: shared link rule — active means usable, no time limit.
  if (!linkUsable(l, now) || !job) return "invalid";
  if (CAPTURE_CLOSED_STAGES.has(job.stage)) return "closed";
  const official = job.decisionSource === "system" || job.decisionSource === "admin";
  if (!official || job.reviewRequired || (job.outcome !== "likely_eligible" && job.outcome !== "needs_onsite_confirmation")) return "invalid";
  return "ok";
}

/** Homeowner-video documents only: canonical homeowner media kind, a video type, one per storage path. Trade evidence is never counted. */
export function homeownerVideoCount(docs: { kind: string; mime_type: string | null; storage_path: string }[]): number {
  return new Set(docs.filter((d) => d.kind === CAPTURE_KIND && (d.mime_type ?? "").startsWith("video/")).map((d) => d.storage_path)).size;
}
