/**
 * Electrical fixes quote from the A4 PIESA price — pure (decision 305, Jo 25 Oct 2026).
 *
 * The electrician gives ONE total price (inc GST) for all the repair work plus what it includes, inside the A4 Mitti
 * PIESA form (`fixesPriceIncGst` / `fixesIncluded`, official-short.core). When both are there the owner's fixes quote is
 * ONE line "Electrical repair work" built from them — no rate-card lookup, no office pricing — and the existing owner
 * margin (decision 142, `applyRectificationMargin`) is added on top. Old forms without the price keep the rate-card path.
 * Release rules are unchanged: the quote is still a held draft for office review (quote-release.core).
 */
import { applyRectificationMargin, RECTIFICATION_MARGIN_INC_GST, type RectificationLine } from "./rectification-pricing.core";

export const A4_FIXES_LINE_DESCRIPTION = "Electrical repair work";
/** Recorded in quote_internals.calc_snapshot.pricing_source so the office can see where the price came from. */
export const A4_FIXES_PRICING_SOURCE = "a4_piesa_electrician_total";
const MAX_PRICE_INC_GST = 100_000;

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Parses the electrician's price as typed in Mitti: "1234.5", "$1,234.50", "1 234", "$1,234.50 inc GST", "AUD 900".
 * Returns null for anything that is not one clear positive amount (blank, zero, negative, two numbers, words only,
 * more than two decimals, over $100,000) — a doubtful price is never guessed.
 */
export function parseFixesPrice(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 && raw <= MAX_PRICE_INC_GST ? r2(raw) : null;
  if (typeof raw !== "string") return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/\b(aud|inc|incl|including|gst|total|dollars?)\b\.?/g, " ").replace(/[$\s]/g, "");
  // Thousands separators only in proper groups ("1,234.50"); anything else with a comma is ambiguous.
  if (s.includes(",")) {
    if (!/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) return null;
    s = s.replace(/,/g, "");
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 && n <= MAX_PRICE_INC_GST ? r2(n) : null;
}

export type FixesPriceSource =
  | { path: "a4_price"; electricianPriceIncGst: number; included: string }
  | { path: "rate_card"; reason: string };

/** Which way the fixes quote is priced, from the synced PIESA short answers (shortAnswersFromEntries("piesa", …)). */
export function fixesPriceSource(short: Record<string, unknown> | null | undefined): FixesPriceSource {
  if (!short) return { path: "rate_card", reason: "No synced PIESA form answers" };
  const rawPrice = short["fixesPriceIncGst"];
  const included = typeof short["fixesIncluded"] === "string" ? short["fixesIncluded"].trim() : "";
  const blankPrice = rawPrice == null || (typeof rawPrice === "string" && !rawPrice.trim());
  if (blankPrice && !included) return { path: "rate_card", reason: "The PIESA form has no repair price (older form)" };
  const price = parseFixesPrice(rawPrice);
  if (price == null) return { path: "rate_card", reason: blankPrice ? "The PIESA form has no repair price" : `The repair price on the PIESA form could not be read: "${String(rawPrice).slice(0, 40)}"` };
  if (!included) return { path: "rate_card", reason: "The PIESA form has a repair price but not what it includes" };
  return { path: "a4_price", electricianPriceIncGst: price, included };
}

export type A4FixesQuote = {
  lines: RectificationLine[];
  subtotalIncGst: number;
  electricianPriceIncGst: number;
  /** Trade cost for quote_internals: the electrician's price ex GST (no margin). */
  costExGst: number;
  marginIncGst: number;
};

/** ONE line from the electrician's total, then the decision-142 owner margin on top (electrician price + margin). */
export function buildA4FixesQuote(input: { electricianPriceIncGst: number; included: string; gstRate: number; margin?: number }): A4FixesQuote {
  const margin = input.margin ?? RECTIFICATION_MARGIN_INC_GST;
  const price = r2(input.electricianPriceIncGst);
  const base: RectificationLine = { code: null, description: A4_FIXES_LINE_DESCRIPTION, quantity: 1, unit: "flat", unit_price_inc_gst: price, line_total_inc_gst: price, is_other: false, explanation: input.included.trim(), sort: 0 };
  const lines = applyRectificationMargin([base], margin);
  const subtotal = r2(lines.reduce((a, l) => a + l.line_total_inc_gst, 0));
  return { lines, subtotalIncGst: subtotal, electricianPriceIncGst: price, costExGst: r2(price / (1 + input.gstRate)), marginIncGst: margin };
}
