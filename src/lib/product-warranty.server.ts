// Product warranty copies for the consumer (VEU checklist G1, Jo 25 Oct 2026). Server-only I/O around the pure
// `product-warranty.core.ts`: which product(s) went in (Install day form per-area answers, else the Ready Check product),
// which bundled warranty PDFs exist (`product-warranty.data.ts`, generated from docs/product-warranties/), filing a copy in
// the private job file (documents kind `product_warranty`, keyed by content hash so a job never holds two copies) and the
// AP-prerequisite gap list. Nothing here sends or records `warranty_copy_provided` — completion-pack.server.ts does both.
import { createHash } from "node:crypto";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import type { EmailAttachment } from "./email-kit.core";
import {
  PRODUCT_WARRANTY_DOC_KIND, type ProductWarranty, type WarrantyAttachDecision, confirmedProductNames, decideWarrantyAttachment, installedProductOptions, looksLikePdf,
  warrantyDocumentTitle, warrantyForOption,
} from "./product-warranty.core";
import { PRODUCT_WARRANTY_PDFS } from "./product-warranty.data";

/** The bundled PDF bytes for one warranty, or null when the repo copy is not on file (or is not a PDF). */
export function warrantyPdfBytes(w: Pick<ProductWarranty, "pdfPath">): Uint8Array | null {
  const uri = PRODUCT_WARRANTY_PDFS[w.pdfPath];
  if (!uri) return null;
  const b64 = uri.replace(/^data:[^,]*,/, "");
  const bytes = new Uint8Array(Buffer.from(b64, "base64"));
  return looksLikePdf(bytes) ? bytes : null;
}

export const warrantyOnFile = (pdfPath: string) => !!PRODUCT_WARRANTY_PDFS[pdfPath] && warrantyPdfBytes({ pdfPath }) !== null;

/** Installed product(s) for the job: the office-confirmed actual products (product-label review) first, then the Install
 *  day form per-area answers, else the Ready Check (Mitti) product. */
export async function installedProductsFor(jobId: string): Promise<string[]> {
  const [{ latestInstallEvidence }, { productForHivQuote }, { verifiedInstalledProductAnswers }] = await Promise.all([import("./install-evidence.server"), import("./insulation-product.server"), import("./piisa-products.server")]);
  const [evidence, ready, actual] = await Promise.all([latestInstallEvidence(jobId).catch(() => null), productForHivQuote(jobId).catch(() => ({ product: null })), verifiedInstalledProductAnswers(jobId).catch(() => null)]);
  const confirmedProducts = actual && !actual.blockers.length ? confirmedProductNames((actual.answers as Record<string, string>)["p7.products"]) : [];
  return installedProductOptions({ installDayProducts: (evidence?.zoneProducts ?? []).map((z) => z.product), readyCheckProduct: ready.product?.option ?? null, confirmedProducts });
}

/**
 * The job's NCC building class ("Class 1", "Class 2 sole-occupancy unit"), read-only from existing fields: the current Ready
 * Check measurement's `building_class` answer, else its property type, else the owner's declared property type (the website
 * stores "apartment" for a unit). Bradford's warranty depends on it. null = not recorded (never guessed; a read error is null too).
 */
export async function warrantyBuildingClassFor(jobId: string): Promise<string | null> {
  try {
    const [{ classFromPropertyType }, { propertyTypeOption }] = await Promise.all([import("./installer-led.core"), import("./mitti.core")]);
    const [{ data: m }, { data: job }] = await Promise.all([
      admin.from("ceiling_measurements").select("raw_snapshot").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
      admin.from("jobs").select("properties(enrichment)").eq("id", jobId).maybeSingle(),
    ]);
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const fromType = (v: unknown) => { const t = str(v); return t ? classFromPropertyType(propertyTypeOption(t) ?? t) : null; };
    const raw = m?.raw_snapshot ?? null;
    // A Mitti Ready Check keeps its answers as labelled entries: the A1/A2 "Property type" tap (House / Townhouse = Class 1,
    // Unit = Class 2 sole-occupancy unit) is the installer's own answer for an own-customer job with no website enquiry.
    const entries = Array.isArray(raw) ? (raw as { label?: unknown; value?: unknown }[]) : [];
    const { LEAN_Q } = await import("./ready-check-lean.core");
    const answered = (label: string) => str(entries.find((e) => typeof e.label === "string" && e.label.trim().toLowerCase() === label.toLowerCase())?.value);
    const snap = (!Array.isArray(raw) && raw ? raw : null) as Record<string, unknown> | null;
    const enrichment = ((job?.properties as unknown as { enrichment?: Record<string, unknown> | null } | null)?.enrichment ?? {}) as { base44?: { declared?: Record<string, unknown> | null } | null };
    return str(snap?.["building_class"]) ?? fromType(snap?.["property_type"]) ?? fromType(answered(LEAN_Q.propertyType)) ?? fromType(enrichment.base44?.declared?.["property_type"]);
  } catch {
    return null;
  }
}

/** What the completion pack can attach for this job, and what is missing. */
export async function warrantyDecisionFor(jobId: string): Promise<WarrantyAttachDecision & { products: string[]; buildingClass: string | null }> {
  const [products, buildingClass] = await Promise.all([installedProductsFor(jobId), warrantyBuildingClassFor(jobId)]);
  return { products, buildingClass, ...decideWarrantyAttachment(products, warrantyOnFile, buildingClass) };
}

/** Installed products whose warranty document is not on file, and the job's building class (together they give the
 *  AP-signature hold reason: `warrantyHoldReason(product, buildingClass)`). */
export async function warrantyGapFactsFor(jobId: string): Promise<{ products: string[]; buildingClass: string | null }> {
  const d = await warrantyDecisionFor(jobId);
  return { products: d.missing.map((m) => m.product), buildingClass: d.buildingClass };
}

/** Installed products whose warranty document is not on file (feeds the AP-signature hold reason). */
export async function warrantyGapsFor(jobId: string): Promise<string[]> {
  return (await warrantyGapFactsFor(jobId)).products;
}

export const warrantyAttachment = (w: ProductWarranty, bytes: Uint8Array): EmailAttachment => ({ filename: w.attachmentName, content: Buffer.from(bytes).toString("base64"), contentType: "application/pdf" });

/** Files the warranty copy on the job (private job-files bucket + documents row). Idempotent per job and document content. */
export async function fileWarrantyCopy(jobId: string, actorId: string | null, w: ProductWarranty, bytes: Uint8Array): Promise<{ filed: boolean; path: string }> {
  const sha = createHash("sha256").update(bytes).digest("hex");
  const key = `${PRODUCT_WARRANTY_DOC_KIND}:${w.family}:${sha.slice(0, 32)}`;
  const { data: ex } = await admin.from("documents").select("storage_path").eq("job_id", jobId).eq("source_system", "portal").eq("external_id", key).maybeSingle();
  if (ex) return { filed: false, path: ex.storage_path };
  const { data: job } = await admin.from("jobs").select("job_number").eq("id", jobId).maybeSingle();
  const path = `${jobId}/warranties/${w.family}-${sha.slice(0, 16)}.pdf`;
  const up = await admin.storage.from("job-files").upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (up.error && !/exists/i.test(up.error.message)) throw new Error(`Warranty copy could not be stored: ${up.error.message}`);
  const { error } = await admin.from("documents").insert({ job_id: jobId, kind: PRODUCT_WARRANTY_DOC_KIND, title: warrantyDocumentTitle(w, job?.job_number ?? ""), storage_path: path, mime_type: "application/pdf", uploaded_by: actorId, source_system: "portal", external_id: key, original_name: w.attachmentName, size_bytes: bytes.byteLength });
  if (error) throw new Error(error.message);
  await logEvent(jobId, actorId, "product_warranty_filed", `Manufacturer warranty filed on the job: ${w.productName} (${w.manufacturer})`, { path, sha256: sha, family: w.family, source_urls: w.sourceUrls }, { internal: true });
  return { filed: true, path };
}

/** Attachments (and filed copies) for the documents the decision says to attach. A PDF that cannot be read is treated as missing. */
export async function prepareWarrantyCopies(jobId: string, actorId: string | null, decision: WarrantyAttachDecision): Promise<{ attachments: EmailAttachment[]; attached: ProductWarranty[]; missing: WarrantyAttachDecision["missing"] }> {
  const attachments: EmailAttachment[] = [];
  const attached: ProductWarranty[] = [];
  const missing = [...decision.missing];
  for (const w of decision.attach) {
    const bytes = warrantyPdfBytes(w);
    if (!bytes) { missing.push({ product: w.productName, reason: `Warranty copy for ${w.productName} not on file.` }); continue; }
    await fileWarrantyCopy(jobId, actorId, w, bytes);
    attachments.push(warrantyAttachment(w, bytes));
    attached.push(w);
  }
  return { attachments, attached, missing };
}

/** Office display helper: the manufacturer warranty for a product option, when one is mapped. */
export const warrantyInfoForOption = (option: string | null | undefined, buildingClass?: string | null) => warrantyForOption(option, buildingClass);
