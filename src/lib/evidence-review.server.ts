// Office review of one evidence requirement (verified / rejected / not required / outstanding), including the product
// label review that confirms the actually installed products (piisa-products.core prepareProductReview). Moved verbatim
// from the office `verifyEvidence` server function, which still checks the caller is office before calling this; the
// live full-journey runner (TEST jobs) records its office review through the same path.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { autoAdvanceJob } from "./autoadvance.server";

export type EvidenceReview = {
  requirementId: string;
  status: "verified" | "rejected" | "not_required" | "outstanding";
  notes?: string | undefined;
  installedAreaM2?: number | undefined;
  actualProducts?: { brand: string; model: string; rValue: number }[] | undefined;
};

/** The caller must already be confirmed as office (the server function does `requireAdmin`). */
export async function reviewEvidence(actorId: string, data: EvidenceReview) {
  const { data: req } = await admin.from("evidence_requirements").select("job_id,label,category").eq("id", data.requirementId).single();
  if (!req) throw new WorkflowError("Not found");
  const at = new Date().toISOString();
  let notes = data.notes ?? null;
  if (data.actualProducts) {
    if (req.category !== "product_evidence" || data.status !== "verified") throw new WorkflowError("Actual products can only be confirmed while reviewing product label evidence.");
    const { data: files, error } = await admin.from("evidence_files").select("id,job_id,requirement_id,mime_type,uploaded_at,storage_path").eq("job_id", req.job_id).eq("requirement_id", data.requirementId);
    if (error) throw new Error(error.message);
    const { prepareProductReview } = await import("./piisa-products.core");
    notes = JSON.stringify(prepareProductReview({ jobId: req.job_id, requirementId: data.requirementId, products: data.actualProducts, installedAreaM2: data.installedAreaM2, files: files ?? [], actor: actorId, at }));
  }
  const { error: reviewError } = await admin.from("evidence_requirements").update({ status: data.status, required: data.status === "not_required" ? false : true, verified_by: actorId, verified_at: at, notes }).eq("id", data.requirementId);
  if (reviewError) throw new Error(reviewError.message);
  await logEvent(req.job_id, actorId, "evidence_reviewed", `Evidence ${data.status.replace("_", " ")}: ${req.label}`, { notes: data.notes, actual_products: data.actualProducts ?? null });
  if (data.status === "rejected") {
    const { recordEvidenceRejected } = await import("./visit-events.server");
    await recordEvidenceRejected(data.requirementId, actorId, data.notes ?? null).catch((e) => console.error("evidence rejection not counted", (e as Error).message));
  }
  await autoAdvanceJob(req.job_id, actorId, "evidence reviewed");
  return { ok: true };
}
