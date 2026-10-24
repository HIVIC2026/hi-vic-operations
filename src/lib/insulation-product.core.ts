// Jo 22 Oct 23:45: one required single-select Mitti question "Insulation product" on A1 and A2 with 6 approved
// options. No brand/product-name/R-value questions, no profile product. Recorded on the job as declared, not verified.

export const PRODUCT_R_VALUES = ["R5.0", "R6.0", "R7.0"] as const;
export type ProductRValue = (typeof PRODUCT_R_VALUES)[number];
export type InsulationProduct = { option: string; rValue: ProductRValue };

/** The 6 exact tap options on both forms (Jo 22 Oct 23:45). R-value is taken from the label. */
export const APPROVED_PRODUCTS: readonly InsulationProduct[] = (["Bradford Gold", "Fletchers Pink Batts"] as const).flatMap((name) =>
  ([["R5", "R5.0"], ["R6", "R6.0"], ["R7", "R7.0"]] as const).map(([r, rValue]) => ({ option: `${name} ${r}`, rValue })));
/** Shown as-is in the office list. */
export const PRODUCT_NEEDS_OFFICE = "Office needs to: confirm insulation product";

const n = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, " ") : "");

/** Exact approved option (case/spacing-insensitive) → product; anything else → null. Also re-reads a stored record. */
export function insulationProduct(value: unknown): InsulationProduct | null {
  const opt = typeof value === "string" ? value : value && typeof value === "object" ? (value as { option?: unknown }).option : null;
  return APPROVED_PRODUCTS.find((p) => n(p.option) === n(opt)) ?? null;
}

export type MittiProductResolution = { ready: boolean; product: InsulationProduct | null; source: "mitti_form"; reasons: string[] };
/** Missing answer or not one of the 6 labels → not ready (quote held, office confirms). */
export function resolveMittiProduct(answer: string | null | undefined): MittiProductResolution {
  const p = insulationProduct(answer);
  return { ready: !!p, product: p, source: "mitti_form", reasons: p ? [] : [PRODUCT_NEEDS_OFFICE] };
}

/** Owner quote line: "Supply and install of [full label] ceiling insulation – [area] m²", e.g. "Bradford Gold R6". */
export function productQuoteDescription(p: Pick<InsulationProduct, "option">, areaM2: number | null): string {
  const area = areaM2 != null && areaM2 > 0 ? ` – ${Math.round(areaM2 * 100) / 100} m²` : "";
  return `Supply and install of ${p.option} ceiling insulation${area}`;
}

/** VEEC form Section 2 brand/model from an approved option, named as on the ESC register (decisions 148/149). */
export function productBrandModel(p: Pick<InsulationProduct, "option">): { brand: string; model: string } {
  if (/^bradford gold/i.test(p.option)) return { brand: "CSR Bradford", model: "Gold Ceiling Batt" };
  if (/pink batts/i.test(p.option)) return { brand: "PINK® Batts", model: "Ceiling Insulation" };
  const [brand, ...rest] = p.option.replace(/\s+R\d+(\.\d+)?$/i, "").split(" ");
  return { brand: brand ?? p.option, model: rest.join(" ") };
}
