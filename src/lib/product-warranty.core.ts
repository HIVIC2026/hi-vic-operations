/**
 * Product warranty documents for the ESC-approved products (Jo 25 Oct 2026: "look up the approved products' warranty and fix
 * this gap"; VEU checklist row G1). PURE.
 *
 * The ESC requires the consumer to hold a copy of the product warranty against defects (minimum 5 years from installation)
 * BEFORE the AP signs Section 3 Part A of the VEEC assignment form (FAQ Q8; assignment form Part A bullet 7). This module
 * maps each of the eight Mitti product options (insulation-product.core `APPROVED_PRODUCTS`) to its manufacturer warranty:
 * who issues it, how long it runs, where the public document lives and which repo file under `docs/product-warranties/`
 * holds the copy that is attached to the completion pack (O47) and filed on the job (documents kind `product_warranty`).
 *
 * Whether a copy is actually on file is NOT decided here: the server checks the bundled data module
 * (`product-warranty.data.ts`, regenerated from the repo PDFs by `scripts/embed-product-warranties.ts`). Nothing here
 * ever invents a document: a product whose PDF is not on file is reported as a gap and the AP signature holds on it.
 */
import { productBrandModel } from "./insulation-product.core";

export const ESC_MIN_WARRANTY_YEARS = 5;
/** Repo folder that holds the manufacturer warranty PDFs (and README with each document's provenance). */
export const WARRANTY_DIR = "docs/product-warranties";
/** Job-file document kind for the copy given to the consumer. */
export const PRODUCT_WARRANTY_DOC_KIND = "product_warranty";
/** Workflow event written when the completion pack carried every installed product's warranty (same event the office records by hand). */
export const WARRANTY_COPY_PROVIDED_EVENT = "warranty_copy_provided";

export type WarrantyFamily = "bradford_gold" | "pink_batts" | "earthwool" | "ecowool";

export type ProductWarranty = {
  family: WarrantyFamily;
  /** Product line as the owner knows it ("Bradford Gold"). */
  productName: string;
  manufacturer: string;
  /** Document title as the manufacturer publishes it. */
  documentTitle: string;
  /** Warranty against defects in years; `lifetime` = for the life of the building (exceeds the ESC minimum). */
  warranty: { kind: "years"; years: number } | { kind: "lifetime" };
  /** Where the public document is published (first = manufacturer's own page; the rest = known mirrors). */
  sourceUrls: string[];
  /** Repo path of the PDF copy (relative to the repo root). The file may not be present yet — see README. */
  pdfPath: string;
  /** Filename the owner sees on the email attachment / job file. */
  attachmentName: string;
  /** How to obtain the document when no public copy exists (ECOWOOL). */
  requestFrom: string | null;
};

export const PRODUCT_WARRANTIES: readonly ProductWarranty[] = [
  {
    family: "bradford_gold", productName: "Bradford Gold", manufacturer: "CSR Bradford (CSR Building Products Ltd)",
    documentTitle: "Bradford Insulation 70-year product performance warranty", warranty: { kind: "years", years: 70 },
    sourceUrls: ["https://www.csrbradford.com.au/", "https://www.eboss.co.nz/assets/literature/25/24959/125414-BRI-Product-Lifetime-Warranty-PRESS.pdf"],
    pdfPath: `${WARRANTY_DIR}/bradford-gold-70-year-warranty.pdf`, attachmentName: "Bradford-Gold-product-warranty.pdf", requestFrom: null,
  },
  {
    family: "pink_batts", productName: "Fletchers Pink Batts", manufacturer: "Fletcher Insulation Pty Ltd",
    documentTitle: "Pink Batts consumer lifetime product warranty (Rev 2, 29 April 2024)", warranty: { kind: "lifetime" },
    sourceUrls: ["https://insulation.com.au/wp-content/uploads/2024/Warranty-Consumer-Lifetime-Product-Pink-Batts-Rev2-290424.pdf"],
    pdfPath: `${WARRANTY_DIR}/pink-batts-consumer-lifetime-warranty.pdf`, attachmentName: "Pink-Batts-product-warranty.pdf", requestFrom: null,
  },
  {
    family: "earthwool", productName: "Earthwool", manufacturer: "Knauf Insulation Pty Ltd",
    documentTitle: "Knauf Insulation warranty — Earthwool unfaced products (50 years)", warranty: { kind: "years", years: 50 },
    sourceUrls: ["https://www.knauf.com/en-AU", "https://media.bunnings.com.au/api/public/content/00dae20abf0b4b2dafd88941ae435043"],
    pdfPath: `${WARRANTY_DIR}/earthwool-unfaced-50-year-warranty.pdf`, attachmentName: "Earthwool-product-warranty.pdf", requestFrom: null,
  },
  {
    family: "ecowool", productName: "ECOWOOL", manufacturer: "PGF Insulation (PGF Australia)",
    documentTitle: "ECOWOOL product warranty (no public document found)", warranty: { kind: "years", years: 0 },
    sourceUrls: ["https://pgfinsulation.com.au/"],
    pdfPath: `${WARRANTY_DIR}/ecowool-product-warranty.pdf`, attachmentName: "ECOWOOL-product-warranty.pdf",
    requestFrom: "to be requested from PGF Australia (sales@pgfinsulation.com.au)",
  },
];

/** The warranty family for one Mitti option ("Bradford Gold R6", "Earthwool R5"); null for anything that is not an approved option. */
export function warrantyFamilyForOption(option: string | null | undefined): WarrantyFamily | null {
  const o = String(option ?? "").trim();
  if (!o) return null;
  if (/^bradford gold/i.test(o)) return "bradford_gold";
  if (/pink batts/i.test(o)) return "pink_batts";
  if (/^earthwool/i.test(o)) return "earthwool";
  if (/^ecowool/i.test(o)) return "ecowool";
  // An office-confirmed actual product from the label review ("Bradford Gold Ceiling Batt R5.0", "Knauf Earthwool …").
  if (/\bbradford\b/i.test(o) && /\bgold\b/i.test(o)) return "bradford_gold";
  if (/\bearthwool\b/i.test(o)) return "earthwool";
  if (/\becowool\b/i.test(o)) return "ecowool";
  return null;
}

/**
 * Night run 25 Oct 2026: the warranty pack named the QUOTED product even when the office had confirmed a different actual
 * product from the product-label review (piisa-products `p7.products`, one "brand | model | R<value>" line each). The
 * confirmed products, as "brand model" names, are what went in; they win over the install-day / Ready Check option.
 */
export function confirmedProductNames(p7Products: string | null | undefined): string[] {
  const out = String(p7Products ?? "").split("\n").map((line) => line.split("|").map((x) => x.trim()))
    .filter((parts) => parts.length >= 2 && parts[0] && parts[1]).map(([brand, model]) => (model!.toLowerCase().startsWith(brand!.toLowerCase()) ? model! : `${brand} ${model}`));
  return [...new Set(out)];
}

export const warrantyForOption = (option: string | null | undefined): ProductWarranty | null => {
  const f = warrantyFamilyForOption(option);
  return f ? PRODUCT_WARRANTIES.find((w) => w.family === f) ?? null : null;
};

/** "70 years" / "lifetime" / "not confirmed" for display. */
export function warrantyTermText(w: ProductWarranty): string {
  if (w.warranty.kind === "lifetime") return "lifetime";
  return w.warranty.years > 0 ? `${w.warranty.years} years` : "not confirmed";
}

/** The ESC minimum is 5 years from installation; a lifetime warranty exceeds it, an unconfirmed term does not. */
export function meetsEscMinimum(w: ProductWarranty): boolean {
  return w.warranty.kind === "lifetime" || w.warranty.years >= ESC_MIN_WARRANTY_YEARS;
}

/**
 * The product(s) actually installed, as Mitti options, in a stable order without duplicates: the install day form's per-area
 * answers first (what went in), else the Ready Check product (the declared product). Unknown/blank answers are dropped.
 */
export function installedProductOptions(x: { installDayProducts: readonly (string | null | undefined)[]; readyCheckProduct: string | null | undefined; confirmedProducts?: readonly string[] | null }): string[] {
  const clean = (v: string | null | undefined) => String(v ?? "").trim();
  // The office-confirmed actual products (label review) are what went in — they win over any quoted / planned option.
  const confirmed = (x.confirmedProducts ?? []).map(clean).filter(Boolean);
  if (confirmed.length) return [...new Set(confirmed)];
  const fromForm = x.installDayProducts.map(clean).filter(Boolean);
  const list = fromForm.length ? fromForm : [clean(x.readyCheckProduct)].filter(Boolean);
  return [...new Set(list)];
}

export type WarrantyAttachDecision = {
  /** Warranty documents to attach to the completion pack and file on the job (one per manufacturer, even when two options share it). */
  attach: ProductWarranty[];
  /** Installed products whose warranty document is NOT on file, with the reason the owner cannot be given a copy yet. */
  missing: { product: string; reason: string }[];
  /** True only when at least one product was installed and EVERY installed product's warranty is attached: then `warranty_copy_provided` may be recorded. */
  recordProvided: boolean;
};

/**
 * What the completion pack can do about warranties. `onFile(pdfPath)` says whether the repo copy is bundled. The pack still
 * sends when something is missing; nothing is recorded then and the AP signature holds (see `warrantyHoldReason`).
 */
export function decideWarrantyAttachment(products: readonly string[], onFile: (pdfPath: string) => boolean): WarrantyAttachDecision {
  const attach: ProductWarranty[] = [];
  const missing: { product: string; reason: string }[] = [];
  for (const p of products) {
    const w = warrantyForOption(p);
    if (!w) { missing.push({ product: p, reason: `${p} is not one of the approved product options, so no warranty document is mapped to it.` }); continue; }
    if (!onFile(w.pdfPath)) { missing.push({ product: p, reason: warrantyHoldReason(p) }); continue; }
    if (!meetsEscMinimum(w)) { missing.push({ product: p, reason: `${w.manufacturer}'s warranty term for ${p} is not confirmed to reach the ESC minimum of ${ESC_MIN_WARRANTY_YEARS} years.` }); continue; }
    if (!attach.some((a) => a.family === w.family)) attach.push(w);
  }
  return { attach, missing, recordProvided: products.length > 0 && missing.length === 0 && attach.length > 0 };
}

/** The AP-signature hold reason for a product whose warranty copy could not be given to the consumer. */
export function warrantyHoldReason(product: string): string {
  const w = warrantyForOption(product);
  const how = w?.requestFrom ? ` (${w.requestFrom})` : w ? ` (${w.manufacturer}: ${w.sourceUrls[0]})` : "";
  return `Warranty copy for ${product} not on file${how}.`;
}

/** Summary line written on the `warranty_copy_provided` event when the completion pack carried the documents. */
export const warrantyProvidedSummary = (attached: readonly ProductWarranty[]) =>
  `Consumer given the product warranty against defects with the completion pack: ${attached.map((w) => `${w.productName} (${w.manufacturer}, ${warrantyTermText(w)})`).join("; ")}`;

/** Job-file title for the filed copy. */
export const warrantyDocumentTitle = (w: ProductWarranty, jobNumber: string) => `Product warranty — ${w.productName} (${warrantyTermText(w)}) — Job ${jobNumber}`;

/** A real PDF starts with "%PDF-" (the embed script and the server both refuse anything else). */
export const looksLikePdf = (bytes: Uint8Array) => bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;

/** Brand/model wording shared with the VEEC form, for the README and office displays. */
export const warrantyBrandLine = (w: ProductWarranty) => { const bm = productBrandModel({ option: `${w.productName} R5` }); return `${bm.brand} ${bm.model}`; };
