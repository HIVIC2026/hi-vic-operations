// Tax-invoice itemisation to the ESC Ceiling Insulation Activity Guide v1.2, Table 4 "Evidence of commercial transaction /
// Tax invoice" (Jo 24 Oct 2026, decision 209). Pure — no database, no network.
//
// The Guide wants, on the one tax invoice: the energy consumer's name, the installation address, the contracting business's
// name/address/ABN, the brand(s)/model(s)/R-value of every installed product, the total m² installed, the price before the
// VEEC incentive, the VEEC incentive amount, the amount paid after it, and the invoice date. This module builds the product
// line and the office flag; the Xero payload (`xero.core.ts`) and the owner emails (`completion-emails.core.ts`) consume it.
// Nothing here is ever invented: unknown product or area keeps the rate-card wording and raises an office item instead.
import { productBrandModel, type InsulationProduct } from "./insulation-product.core";
import { modelsForMittiOption } from "./esc-approved-products.core";

/** Quote line codes that carry the ceiling insulation supply & install (our rate card and the installer's A1 line). */
export const INSULATION_LINE_CODES = ["R5_BATTS", "R6_BATTS", "R7_BATTS", "INSTALLER_PRICE"] as const;
/** Office item raised when the Xero invoice had to go out with the rate-card wording. */
export const INVOICE_PRODUCT_UNCONFIRMED_EVENT = "xero_invoice_product_unconfirmed";
export const INVOICE_PRODUCT_CONFIRMED_EVENT = "xero_invoice_product_confirmed";
export const INVOICE_PRODUCT_NEEDS_OFFICE = "Office needs to: confirm the installed product and m² on the Xero invoice";

export type InstalledProductFacts = {
  /** The product declared on the job (Mitti tap option), or null when not recorded. */
  product: Pick<InsulationProduct, "option" | "rValue"> | null;
  /** Ready Check measured (or office-verified) ceiling area in m², or null when not measured. */
  areaM2: number | null;
  /** Exact ESC register model codes when known from the install evidence / VEEC form; [] when unknown. */
  escModelCodes?: readonly string[];
};

export type InsulationLine = { description: string; brand: string; model: string; rValue: string; areaM2: number; escModelCodes: string[] };

const m2 = (n: number) => `${Math.round(n * 100) / 100} m²`;
const rLabel = (r: string) => (/^R/i.test(r) ? r.toUpperCase() : `R${r}`);

/**
 * Exact ESC model codes for the invoice: the codes supplied from install evidence / the VEEC form when present, otherwise the
 * register code when the declared option maps to exactly ONE register model (e.g. Earthwool R5 → 2437543). Two widths of
 * the same product (Bradford, Pink Batts, ECOWOOL) mean the code is not known from the option alone, so none is printed.
 */
export function knownEscModelCodes(option: string | null | undefined, supplied: readonly string[] | null | undefined): string[] {
  const given = [...new Set((supplied ?? []).map((c) => String(c).trim()).filter(Boolean))];
  if (given.length) return given;
  if (!option) return [];
  const models = modelsForMittiOption(option);
  return models.length === 1 ? [models[0]!.code] : [];
}

/** "Ceiling insulation — CSR Bradford Gold Ceiling Batt R5.0 — 137.6 m²"; null when product or area is unknown (never guessed). */
export function insulationLine(f: InstalledProductFacts): InsulationLine | null {
  if (!f.product || !(f.areaM2 != null && Number.isFinite(f.areaM2) && f.areaM2 > 0)) return null;
  const bm = productBrandModel(f.product);
  const rValue = rLabel(f.product.rValue);
  const escModelCodes = knownEscModelCodes(f.product.option, f.escModelCodes);
  return { description: `Ceiling insulation — ${bm.brand} ${bm.model} ${rValue} — ${m2(f.areaM2)}`, brand: bm.brand, model: bm.model, rValue, areaM2: Math.round(f.areaM2 * 100) / 100, escModelCodes };
}

/** Owner-facing wording with the exact ESC model code(s) when known: "… — 137.6 m² (ESC model 2437543)". */
export function insulationLineWithCodes(line: Pick<InsulationLine, "description" | "escModelCodes">): string {
  return line.escModelCodes.length ? `${line.description} (ESC model ${line.escModelCodes.join(", ")})` : line.description;
}

export type InvoiceItem = { code?: string | null; description: string; quantity: number | string; unit_price_inc_gst: number | string; line_total_inc_gst: number | string; sort?: number };

const isInsulationItem = (i: InvoiceItem) =>
  (i.code != null && (INSULATION_LINE_CODES as readonly string[]).includes(i.code)) || (i.code == null && /ceiling insulation/i.test(i.description));

/**
 * Re-words ONLY the insulation line's description (quantities and prices untouched, so totals still sum exactly). Any suffix the
 * installer line already carries (" · Removal of existing insulation – 40 m²", " · Includes difficult access") is kept.
 * Unknown product/area → items returned unchanged and `officeFlag` set; no insulation line → nothing to flag.
 */
export function itemiseInvoiceLines<T extends InvoiceItem>(items: readonly T[], facts: InstalledProductFacts): { items: T[]; line: InsulationLine | null; officeFlag: string | null } {
  const idx = items.findIndex(isInsulationItem);
  if (idx < 0) return { items: [...items], line: null, officeFlag: null };
  const line = insulationLine(facts);
  if (!line) return { items: [...items], line: null, officeFlag: INVOICE_PRODUCT_NEEDS_OFFICE };
  const out = items.map((i, n) => {
    if (n !== idx) return i;
    const suffix = i.description.includes(" · ") ? i.description.slice(i.description.indexOf(" · ")) : "";
    return { ...i, description: `${line.description}${suffix}` };
  });
  return { items: out, line, officeFlag: null };
}

/** Which facts are missing, in plain words, for the office item detail. */
export function missingProductFacts(f: InstalledProductFacts): string[] {
  const out: string[] = [];
  if (!f.product) out.push("insulation product not recorded on the job");
  if (!(f.areaM2 != null && f.areaM2 > 0)) out.push("ceiling area not measured");
  return out;
}
