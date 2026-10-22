// Jo 22 Oct 23:32: insulation PRODUCT asked on every Mitti Ready Check (A1 and A2). No installer-profile product.
// "Brand" (Earthwool / Bradford / Pink Batts / Other, required), "Product name" (only when Brand = Other, required then),
// "R-value" (R5.0 / R6.0 / R7.0, required). Absent questions (older forms) change nothing. Declared, not verified.

export const PRODUCT_BRANDS = ["Earthwool", "Bradford", "Pink Batts", "Other"] as const;
export const PRODUCT_R_VALUES = ["R5.0", "R6.0", "R7.0"] as const;
export type ProductBrand = (typeof PRODUCT_BRANDS)[number];
export type ProductRValue = (typeof PRODUCT_R_VALUES)[number];
export type InsulationProduct = { brand: ProductBrand; productName: string | null; rValue: ProductRValue };
export const PRODUCT_INCOMPLETE = "Insulation brand and R-value are required (and product name when Brand is Other)";

const n = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, " ") : "");
const pick = <T extends string>(list: readonly T[], v: unknown): T | null => list.find((x) => n(x) === n(v)) ?? null;
/** "R5", "R 5.0", "5" all read as R5.0. */
export function rValueOption(v: unknown): ProductRValue | null {
  const m = n(v).replace(/^r\s*/, "").match(/^(\d)(?:\.0)?$/);
  return m ? pick(PRODUCT_R_VALUES, `R${m[1]}.0`) : null;
}

/** Complete product or null. Product name is required (and kept) only for Brand = Other. */
export function insulationProduct(value: unknown): InsulationProduct | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const brand = pick(PRODUCT_BRANDS, v["brand"]);
  const rValue = rValueOption(v["rValue"]);
  const name = typeof v["productName"] === "string" && v["productName"].trim() ? v["productName"].trim().slice(0, 200) : null;
  if (!brand || !rValue || (brand === "Other" && !name)) return null;
  return { brand, productName: brand === "Other" ? name : null, rValue };
}

export const productLabel = (p: InsulationProduct) => (p.brand === "Other" ? p.productName ?? "" : p.brand);

export type MittiProductResolution = {
  /** false = no product questions answered/present (older form): no product handling at all. */
  asked: boolean; ready: boolean; product: InsulationProduct | null; source: "mitti_form" | null; reasons: string[];
};
export function resolveMittiProduct(a: { brand: string | null; productName: string | null; rValue: string | null }): MittiProductResolution {
  if (!a.brand?.trim() && !a.rValue?.trim() && !a.productName?.trim()) return { asked: false, ready: true, product: null, source: null, reasons: [] };
  const p = insulationProduct(a);
  return { asked: true, ready: !!p, product: p, source: "mitti_form", reasons: p ? [] : [PRODUCT_INCOMPLETE] };
}

/** Owner quote line: "Supply and install of [Brand or Product name] [R-value] ceiling insulation – [area] m²". */
export function productQuoteDescription(p: InsulationProduct, areaM2: number | null): string {
  const area = areaM2 != null && areaM2 > 0 ? ` – ${Math.round(areaM2 * 100) / 100} m²` : "";
  return `Supply and install of ${[productLabel(p), p.rValue].filter((x) => x.trim()).join(" ")} ceiling insulation${area}`;
}
