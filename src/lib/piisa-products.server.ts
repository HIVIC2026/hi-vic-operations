import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { reviewedProductAnswers, reviewedInstalledArea } from "./piisa-products.core";

/** Internal job-scoped read for official output. Callers retain existing office/assigned-job authorization. */
export async function verifiedInstalledProductAnswers(jobId: string) {
  const { data, error } = await admin.from("evidence_requirements").select("id,job_id,status,verified_by,verified_at,notes,evidence_files(id,job_id,requirement_id,mime_type,uploaded_at,storage_path)").eq("job_id", jobId).eq("category", "product_evidence");
  if (error) throw new Error(error.message);
  if (!data?.length) return { installedAreaM2: null, answers: {}, blockers: ["The office must review the product labels and confirm the actual installed products."] };
  const results = data.map((r) => reviewedProductAnswers({ jobId, requirementId: r.id, status: r.status, verifiedBy: r.verified_by, verifiedAt: r.verified_at, notes: r.notes, files: r.evidence_files }));
  const blockers = results.flatMap((r) => r.blockers);
  const areas = data.map((r) => reviewedInstalledArea({ jobId, requirementId: r.id, status: r.status, verifiedBy: r.verified_by, verifiedAt: r.verified_at, notes: r.notes, files: r.evidence_files }));
  const installedAreaM2 = areas.length === 1 ? areas[0] ?? null : null;
  return { installedAreaM2, answers: blockers.length ? {} : { "p7.products": results.map((r) => r.answers["p7.products"]).filter(Boolean).join("\n") }, blockers };
}
/** Copy only the SAME audit's product labels into the existing private office review path; never approve them. */
export async function syncNativeProductEvidence(jobId: string, auditId: string, audit: unknown, fetchMedia: import("./mitti.server").MittiMediaFetch) {
  const { a3MediaFiles, A3_EVIDENCE_LABELS } = await import("./piisa-a3.core");
  const { createHash } = await import("node:crypto");
  const media = a3MediaFiles(audit).product_photos;
  if (!media.length || media.some((m) => !m.mediaId)) return ["The PIISA product label photos are missing or have no recorded media ID."];
  let { data: req, error } = await admin.from("evidence_requirements").select("id").eq("job_id", jobId).eq("category", "product_evidence").order("sort").limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!req) {
    const inserted = await admin.from("evidence_requirements").insert({ job_id: jobId, category: "product_evidence", gate: "ap_review", label: A3_EVIDENCE_LABELS.product_photos, required: true, responsible_role: "installer", status: "outstanding" }).select("id").single();
    if (inserted.error || !inserted.data) throw new Error(inserted.error?.message ?? "Product review could not be prepared.");
    req = inserted.data;
  }
  const paths: string[] = [];
  for (const m of media) {
    if (!m.mediaId) continue;
    const { bytes, contentType } = await fetchMedia(auditId, m.mediaId);
    if (!contentType.startsWith("image/") || !bytes.length) return ["Every product label must be a readable original photo for office review."];
    const hash = createHash("sha256").update(bytes).digest("hex");
    const path = `${jobId}/product_evidence/piisa-${auditId}-${m.mediaId}-${hash}`;
    paths.push(path);
    const stable = createHash("sha256").update(`${jobId}:${req.id}:${auditId}:${m.mediaId}`).digest("hex");
    const id = `${stable.slice(0,8)}-${stable.slice(8,12)}-5${stable.slice(13,16)}-a${stable.slice(17,20)}-${stable.slice(20,32)}`;
    const { data: old, error: readError } = await admin.from("evidence_files").select("storage_path").eq("id", id).maybeSingle();
    if (readError) throw new Error(readError.message);
    if (old?.storage_path === path) continue;
    const up = await admin.storage.from("job-files").upload(path, bytes, { contentType, upsert: false });
    if (up.error && !/exists/i.test(up.error.message)) throw new Error(up.error.message);
    const saved = await admin.from("evidence_files").upsert({ id, job_id: jobId, requirement_id: req.id, storage_path: path, file_name: `PIISA product label ${m.mediaId}`, mime_type: contentType, size_bytes: bytes.length, lat: m.lat, lng: m.lng, captured_at: m.capturedAt, location_source: "mitti_original", uploaded_at: new Date().toISOString() });
    if (saved.error) throw new Error(saved.error.message);
    const reset = await admin.from("evidence_requirements").update({ status: "uploaded", verified_at: null, verified_by: null }).eq("id", req.id);
    if (reset.error) throw new Error(reset.error.message);
  }
  const { data: files, error: filesError } = await admin.from("evidence_files").select("storage_path").eq("job_id", jobId).eq("requirement_id", req.id);
  if (filesError) throw new Error(filesError.message);
  const actual = (files ?? []).map((f) => f.storage_path).sort();
  if (JSON.stringify(actual) !== JSON.stringify(paths.sort())) return ["The product review photos do not exactly match this PIISA's current product labels; office review is required."];
  return [] as string[];
}
