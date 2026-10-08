import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { currentPostworkMedia, PIISA_POSTWORK, postworkReviewProblems } from "./piisa-postwork.core";
import type { MittiMediaFetch } from "./mitti.server";

/** Copy current-audit originals to private review storage; never grant approval or advance a stage. */
export async function syncVerifiedPiisaPostwork(jobId: string, auditId: string, audit: unknown, fetchMedia: MittiMediaFetch): Promise<string[]> {
  const parsed = currentPostworkMedia(audit);
  if (parsed.blockers.length) return parsed.blockers;
  const { createHash } = await import("node:crypto");
  const blockers: string[] = [];
  for (const spec of PIISA_POSTWORK) {
    let { data: req, error } = await admin.from("evidence_requirements").select("id,status,verified_by,verified_at").eq("job_id", jobId).eq("category", spec.category).order("sort").limit(1).maybeSingle();
    if (error) throw new Error(error.message);
    if (!req) {
      const result = await admin.from("evidence_requirements").insert({ job_id: jobId, category: spec.category, gate: "ap_review", label: spec.label, required: true, responsible_role: "installer", status: "outstanding" }).select("id,status,verified_by,verified_at").single();
      if (result.error || !result.data) throw new Error(result.error?.message ?? "After-work review could not be prepared.");
      req = result.data;
    }
    const paths: string[] = [];
    for (const file of parsed.files.find((f) => f.key === spec.key)?.media ?? []) {
      if (!file.mediaId) continue;
      const { bytes, contentType } = await fetchMedia(auditId, file.mediaId);
      if (!bytes.length || !spec.accept(contentType)) { blockers.push(`${spec.label}: a non-empty original ${spec.key === "completed_video" ? "video" : "plan image or PDF"} is required.`); continue; }
      const hash = createHash("sha256").update(bytes).digest("hex");
      const path = `${jobId}/${spec.category}/piisa-${auditId}-${file.mediaId}-${hash}`;
      paths.push(path);
      const stable = createHash("sha256").update(`${jobId}:${req.id}:${auditId}:${file.mediaId}`).digest("hex");
      const id = `${stable.slice(0,8)}-${stable.slice(8,12)}-5${stable.slice(13,16)}-a${stable.slice(17,20)}-${stable.slice(20,32)}`;
      const old = await admin.from("evidence_files").select("storage_path").eq("id", id).maybeSingle();
      if (old.error) throw new Error(old.error.message);
      if (old.data?.storage_path === path) continue;
      // Invalidate approval BEFORE replacing content; a failed write cannot leave changed media approved.
      const reset = await admin.from("evidence_requirements").update({ status: "uploaded", verified_by: null, verified_at: null }).eq("id", req.id);
      if (reset.error) throw new Error(reset.error.message);
      req = { ...req, status: "uploaded", verified_by: null, verified_at: null };
      const upload = await admin.storage.from("job-files").upload(path, bytes, { contentType, upsert: false });
      if (upload.error && !/exists/i.test(upload.error.message)) throw new Error(upload.error.message);
      const saved = await admin.from("evidence_files").upsert({ id, job_id: jobId, requirement_id: req.id, storage_path: path, file_name: `PIISA ${spec.label} ${file.mediaId}`, mime_type: contentType, size_bytes: bytes.length, lat: file.lat, lng: file.lng, captured_at: file.capturedAt, location_source: "mitti_original", uploaded_at: new Date().toISOString() });
      if (saved.error) throw new Error(saved.error.message);
    }
    const files = await admin.from("evidence_files").select("storage_path").eq("job_id", jobId).eq("requirement_id", req.id);
    if (files.error) throw new Error(files.error.message);
    blockers.push(...postworkReviewProblems(spec.label, req, (files.data ?? []).map((f) => f.storage_path), paths));
  }
  return blockers;
}