/** Jo 23 Oct 2026 6:13pm: removal shown as a $0 – $X range for owners who said insulation is present OR don't know.
 *  Shown separately; never added to the quote total or rebate. Identical wording in email and on the estimate page. */
export const REMOVAL_UPTO_NOTE = "We charge $15 per m² (inc GST) for any area that needs removing. It may not need to come out at all, and you'll see the final price before you agree to anything.";
const aud = (n: number) => `$${Math.round(n).toLocaleString("en-AU")}`;
export function removalUpToLine(amount: number, _areaM2?: number | null): string {
  return `Removal of old insulation, only if needed: $0 – ${aud(amount)}`;
}
/** "Your price: $A – $B" — without removal → with full removal. */
export function priceRangeLine(total: number, removal: number): string {
  return `Your price: ${aud(total)} – ${aud(total + removal)}`;
}
/** Owner ceiling area × current removal rate; null unless insulation is present and removal is not already itemised. */
export function removalUpTo(x: { insulation: string | null | undefined; areaM2: number | null | undefined; ratePerM2: number | null | undefined; removalItemised?: boolean }): number | null {
  if ((x.insulation !== "present" && x.insulation !== "unknown") || x.removalItemised) return null;
  const a = Number(x.areaM2), r = Number(x.ratePerM2);
  if (!Number.isFinite(a) || a <= 0 || !Number.isFinite(r) || r <= 0) return null;
  return Math.round(a * r * 100) / 100;
}
