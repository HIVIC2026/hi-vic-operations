import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { reviewedProductAnswers } from "./piisa-products.core";

/** Internal job-scoped read for official output. Callers retain existing office/assigned-job authorization. */
export async function verifiedInstalledProductAnswers(jobId: string) {
  const { data, error } = await admin.from("evidence_requirements").select("id,job_id,status,verified_by,verified_at,notes,evidence_files(id,job_id,requirement_id,mime_type,uploaded_at,storage_path)").eq("job_id", jobId).eq("category", "product_evidence");
  if (error) throw new Error(error.message);
  if (!data?.length) return { answers: {}, blockers: ["The office must review the product labels and confirm the actual installed products."] };
  const results = data.map((r) => reviewedProductAnswers({ jobId, requirementId: r.id, status: r.status, verifiedBy: r.verified_by, verifiedAt: r.verified_at, notes: r.notes, files: r.evidence_files }));
  const blockers = results.flatMap((r) => r.blockers);
  return { answers: blockers.length ? {} : { "p7.products": results.map((r) => r.answers["p7.products"]).filter(Boolean).join("\n") }, blockers };
}