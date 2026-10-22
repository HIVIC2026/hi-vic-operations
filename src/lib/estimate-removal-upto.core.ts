/** Jo 22 Oct 2026: informational "up to" removal amount for owners who said they HAVE existing insulation.
 *  Shown separately; never added to the price, total or rebate. Identical wording everywhere. */
export const REMOVAL_UPTO_NOTE = "This is extra and NOT included in the price above. Often only part of the ceiling needs it, and some may be fine to stay. Your installer confirms at your free Ready Check.";
/** Jo 22 Oct: the line also states the per-m² rate (rate = amount ÷ area, so it always follows settings). */
export function removalUpToLine(amount: number, areaM2?: number | null): string {
  const base = `Removal of old insulation, if needed: up to $${Math.round(amount).toLocaleString("en-AU")}`;
  const a = Number(areaM2);
  if (!Number.isFinite(a) || a <= 0) return base;
  const rate = Math.round((amount / a) * 100) / 100;
  const r = Number.isInteger(rate) ? String(rate) : rate.toFixed(2);
  return `${base} ($${r} per m² inc GST, only for the areas that need removal)`;
}
/** Owner ceiling area × current removal rate; null unless insulation is present and removal is not already itemised. */
export function removalUpTo(x: { insulation: string | null | undefined; areaM2: number | null | undefined; ratePerM2: number | null | undefined; removalItemised?: boolean }): number | null {
  if (x.insulation !== "present" || x.removalItemised) return null;
  const a = Number(x.areaM2), r = Number(x.ratePerM2);
  if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(r) || r <= 0) return null;
  return Math.round(a * r * 100) / 100;
}
