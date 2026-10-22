// Jo 23 Oct: insulation PRODUCT on the Ready Check / owner quote. Pure rules only.
// Installer profile "My usual product" (business-scoped, append-only config events) or a different product on the
// Mitti form. Absent questions (older forms) change nothing. Recorded on the job as declared, not verified.

export const PRODUCT_BRANDS = ["Earthwool", "Bradford", "Pink Batts", "Other"] as const;
export const PRODUCT_R_VALUES = ["R5.0", "R6.0", "R7.0"] as const;
export const MITTI_PRODUCT_OPTIONS = ["My usual product", "A different product"] as const;
export type ProductBrand = (typeof PRODUCT_BRANDS)[number];
export type ProductRValue = (typeof PRODUCT_R_VALUES)[number];
export type UsualProduct = { brand: ProductBrand; brandOther: string | null; productName: string; rValue: ProductRValue };
export const USUAL_PRODUCT_EVENT = "installer_usual_product_saved";
export const MISSING_USUAL_PRODUCT = "Installer has no usual product saved";
export const DIFFERENT_PRODUCT_INCOMPLETE = "Different product brand, product name and R-value are required";

const n = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, " ") : "");
const pick = <T extends string>(list: readonly T[], v: unknown): T | null => list.find((x) => n(x) === n(v)) ?? null;
/** "R5", "R 5.0", "5" all read as R5.0. */
export function rValueOption(v: unknown): ProductRValue | null {
  const m = n(v).replace(/^r\s*/, "").match(/^(\d)(?:\.0)?$/);
  return m ? pick(PRODUCT_R_VALUES, `R${m[1]}.0`) : null;
}

export function productOption(v: string | null | undefined): "usual" | "different" | null {
  const x = n(v);
  return x === n(MITTI_PRODUCT_OPTIONS[0]) ? "usual" : x === n(MITTI_PRODUCT_OPTIONS[1]) ? "different" : null;
}

export function usualProduct(value: unknown): UsualProduct | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const brand = pick(PRODUCT_BRANDS, v['brand']);
  const brandOther = typeof v['brandOther'] === "string" && v['brandOther'].trim() ? v['brandOther'].trim().slice(0, 100) : null;
  const productName = typeof v['productName'] === "string" ? v['productName'].trim().slice(0, 200) : "";
  const rValue = rValueOption(v['rValue']);
  if (!brand || !productName || !rValue || (brand === "Other" && !brandOther && v['requireOther'] === true)) return null;
  return { brand, brandOther: brand === "Other" ? brandOther : null, productName, rValue };
}

/** Profile save needs the "Other" brand text; the Mitti form has no such box, so it isn't required there. */
export const usualProductForProfile = (value: unknown) => usualProduct({ ...(value as object), requireOther: true });

export const brandLabel = (p: Pick<UsualProduct, "brand" | "brandOther">) => (p.brand === "Other" ? p.brandOther ?? "" : p.brand);

export type MittiProductResolution = {
  /** null choice = question absent (older form): no product handling at all. */
  choice: "usual" | "different" | null; ready: boolean; product: UsualProduct | null;
  source: "installer_profile" | "mitti_form" | null; reasons: string[]; needsProfile: boolean;
};
export function resolveMittiProduct(input: { choice: "usual" | "different" | null; usual: UsualProduct | null; different: { brand: string | null; productName: string | null; rValue: string | null } }): MittiProductResolution {
  if (input.choice === null) return { choice: null, ready: true, product: null, source: null, reasons: [], needsProfile: false };
  if (input.choice === "usual") {
    const p = usualProduct(input.usual);
    return { choice: "usual", ready: !!p, product: p, source: "installer_profile", reasons: p ? [] : [MISSING_USUAL_PRODUCT], needsProfile: !p };
  }
  const p = usualProduct({ brand: input.different.brand, productName: input.different.productName, rValue: input.different.rValue });
  return { choice: "different", ready: !!p, product: p, source: "mitti_form", reasons: p ? [] : [DIFFERENT_PRODUCT_INCOMPLETE], needsProfile: false };
}

/** Owner quote line: "Supply and install of [Brand] [Product name] [R-value] ceiling insulation – [area] m²". */
export function productQuoteDescription(p: UsualProduct, areaM2: number | null): string {
  const what = [brandLabel(p), p.productName, p.rValue].filter((x) => x && x.trim()).join(" ");
  const area = areaM2 != null && areaM2 > 0 ? ` – ${Math.round(areaM2 * 100) / 100} m²` : "";
  return `Supply and install of ${what} ceiling insulation${area}`;
}

/** Dormant installer reminder — wording NOT approved yet (Jo to approve). */
export const usualProductReminderBody = (jobNumber: string, url: string) =>
  `Please add your usual insulation product (brand, product name and R-value) in My business so we can prepare the quote for job ${jobNumber}: ${url}. Reply STOP to opt out.`;
