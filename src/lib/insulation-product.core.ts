// Jo 22 Oct 23:42: one required single-choice Mitti question "Insulation product" (A1 "Your quote to the homeowner",
// A2 "Ready Check Outcome") with ONLY the approved products. No brand/product-name/R-value questions, no profile product.
// Absent question (older forms) changes nothing. Recorded on the job as declared, not verified.

export const PRODUCT_R_VALUES = ["R5.0", "R6.0", "R7.0"] as const;
export type ProductRValue = (typeof PRODUCT_R_VALUES)[number];
export type InsulationProduct = { option: string; name: string; rValue: ProductRValue };

/** Exact option labels on both published forms (read from Mitti 22 Oct 23:43 UTC). */
export const APPROVED_PRODUCTS: readonly InsulationProduct[] = [
  { option: "Bradford Gold R5", name: "Bradford Gold", rValue: "R5.0" },
  { option: "Fletchers Pink Batts R5", name: "Fletchers Pink Batts", rValue: "R5.0" },
];
export const PRODUCT_NOT_APPROVED = "Insulation product on the form is not one of the approved products — office to check";

const n = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, " ") : "");
/** "R5", "R 5.0", "5" all read as R5.0. */
export function rValueOption(v: unknown): ProductRValue | null {
  const m = n(v).replace(/^r\s*/, "").match(/^(\d)(?:\.0)?$/);
  return m ? (PRODUCT_R_VALUES.find((x) => x === `R${m[1]}.0`) ?? null) : null;
}

/** Exact approved option → product; anything else → null. Also re-reads a stored record. */
export function insulationProduct(value: unknown): InsulationProduct | null {
  const opt = typeof value === "string" ? value : value && typeof value === "object" ? (value as { option?: unknown }).option : null;
  return APPROVED_PRODUCTS.find((p) => n(p.option) === n(opt)) ?? null;
}

export const productLabel = (p: Pick<InsulationProduct, "name">) => p.name;

export type MittiProductResolution = {
  /** false = question absent/unanswered (older form): no product handling at all. */
  asked: boolean; ready: boolean; product: InsulationProduct | null; source: "mitti_form" | null; reasons: string[];
};
export function resolveMittiProduct(answer: string | null | undefined): MittiProductResolution {
  if (!answer?.trim()) return { asked: false, ready: true, product: null, source: null, reasons: [] };
  const p = insulationProduct(answer);
  return { asked: true, ready: !!p, product: p, source: "mitti_form", reasons: p ? [] : [PRODUCT_NOT_APPROVED] };
}

/** Owner quote line: "Supply and install of [product] [R-value] ceiling insulation – [area] m²". */
export function productQuoteDescription(p: Pick<InsulationProduct, "name" | "rValue">, areaM2: number | null): string {
  const area = areaM2 != null && areaM2 > 0 ? ` – ${Math.round(areaM2 * 100) / 100} m²` : "";
  return `Supply and install of ${p.name} ${p.rValue} ceiling insulation${area}`;
}
