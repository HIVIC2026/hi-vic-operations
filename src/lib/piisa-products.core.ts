// Actual product facts are a HUMAN review of product-label evidence, never quote defaults.
export type InstalledProduct = { brand: string; model: string; rValue: number };
export type ProductEvidenceFile = { id: string; job_id: string; requirement_id: string; mime_type: string | null; uploaded_at: string; storage_path: string };
export type ProductReview = { kind: "piisa_actual_products_v1"; jobId: string; requirementId: string; products: InstalledProduct[]; files: string; reviewedBy: string; reviewedAt: string };

export function productFilesFingerprint(files: ProductEvidenceFile[]): string {
  return JSON.stringify([...files].sort((a, b) => a.id.localeCompare(b.id)).map((f) => [f.id, f.job_id, f.requirement_id, f.mime_type, f.uploaded_at, f.storage_path]));
}
export function prepareProductReview(input: { jobId: string; requirementId: string; products: InstalledProduct[]; files: ProductEvidenceFile[]; actor: string; at: string }): ProductReview {
  if (!input.actor || !Number.isFinite(Date.parse(input.at))) throw new Error("Product review needs a recorded reviewer and time.");
  if (!input.files.length || !input.files.some((f) => f.mime_type?.startsWith("image/"))) throw new Error("Review the product label photos before confirming actual installed products.");
  if (input.files.some((f) => f.job_id !== input.jobId || f.requirement_id !== input.requirementId)) throw new Error("Product photos must belong to this job and evidence requirement.");
  if (!input.products.length || input.products.length > 20) throw new Error("Confirm every actual installed product from the labels.");
  const products = input.products.map((p) => ({ brand: p.brand.trim(), model: p.model.trim(), rValue: p.rValue }));
  if (products.some((p) => !p.brand || !p.model || !Number.isFinite(p.rValue) || p.rValue <= 0)) throw new Error("Every product needs a readable brand, model and positive R-value from its label.");
  return { kind: "piisa_actual_products_v1", jobId: input.jobId, requirementId: input.requirementId, products, files: productFilesFingerprint(input.files), reviewedBy: input.actor, reviewedAt: input.at };
}
export function reviewedProductAnswers(input: { jobId: string; requirementId: string; status: string; verifiedBy: string | null; verifiedAt: string | null; notes: string | null; files: ProductEvidenceFile[] }) {
  const fail = (reason: string) => ({ answers: {} as Record<string, string>, blockers: [reason] });
  if (input.status !== "verified") return fail("The product label evidence needs current office review.");
  let review: ProductReview;
  try { review = JSON.parse(input.notes ?? ""); } catch { return fail("The office must confirm the actual brand, model and R-value from the product labels."); }
  if (review?.kind !== "piisa_actual_products_v1" || review.jobId !== input.jobId || review.requirementId !== input.requirementId || review.reviewedBy !== input.verifiedBy || review.reviewedAt !== input.verifiedAt) return fail("The actual product review does not match this job's current evidence approval.");
  try {
    const checked = prepareProductReview({ jobId: input.jobId, requirementId: input.requirementId, products: review.products, files: input.files, actor: review.reviewedBy, at: review.reviewedAt });
    if (checked.files !== review.files) return fail("Product label photos have changed; the office must review the actual products again.");
    return { answers: { "p7.products": checked.products.map((p) => `${p.brand} | ${p.model} | R${p.rValue}`).join("\n") }, blockers: [] };
  } catch (error) { return fail(error instanceof Error ? error.message : "Actual product review is incomplete."); }
}