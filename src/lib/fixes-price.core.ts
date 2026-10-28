/**
 * Electrical fixes quote from the A3 PIESA price — pure (decision 305, Jo 25 Oct 2026; ticks: decision 308).
 *
 * The electrician gives ONE total price (inc GST) for all the repair work plus what it includes, inside the A3 Mitti
 * PIESA form (official-short.core). Decision 308 ("No free text"): what it includes is TICKED (`fixesWork`, with
 * `fixesDownlightCount` / `fixesRcdCount` / `fixesOtherDetail`); decision 305's free-text `fixesIncluded` is read only as
 * the fallback for old forms. When the price and the inclusions are there the owner's fixes quote is ONE line "Electrical
 * repair work" (explanation = the inclusions) — no rate-card lookup, no office pricing — and the existing owner margin
 * (decision 142, `applyRectificationMargin`) is added on top. Anything missing keeps the rate-card path.
 * Decisions 313/349/351 (Jo 25 Oct 2026): the margin follows WHOSE electrician, not the lead route — the installer's own
 * (usual / nominated) electrician is passed through on A1; our electrician gets the $100 — always on our leads since
 * decision 374 (we always choose the electrician there) (`fixesMarginFor`).
 * Decision 310 (Jo 25 Oct 2026): office-added fixes items are NOT added on top of the electrician's A3 total.
 * Decision 354: when the A3 is complete and every existing check passes, the fixes quote goes to the owner automatically
 * (auto-fixes-quote-send.{core,server}.ts); otherwise it stays a held draft on Needs me with the reason.
 */
import { applyRectificationMargin, RECTIFICATION_MARGIN_INC_GST, type RectificationLine } from "./rectification-pricing.core";
import { FIXES_DOWNLIGHT_OPTION, FIXES_OTHER_OPTION, FIXES_RCD_OPTION, fixesWorkTicks, fixesWorkWithOnsite } from "./official-short.core";
export { fixesWorkTicks };
import type { ElectricianSource } from "./our-lead-piesa-electrician.core";

/** Decision 351 (Jo 25 Oct 2026; replaces the channel rule of decisions 313/349): the decision-142 $100 follows WHOSE
 *  electrician, on BOTH routes — our (Home Insulation Victoria-supplied) electrician → +$100, including on installer-
 *  supplied jobs (A1); the installer's own / usual / nominated electrician → no markup ever (A1 only —
 *  `electricianSourceForA1`; our leads are always ours since decision 374, both via `electricianSourceForJob`).
 *  Used by both the A3-price path and the rate-card fallback. */
export const fixesMarginFor = (electricianSource: ElectricianSource = "ours"): number =>
  electricianSource === "installer_usual" ? 0 : RECTIFICATION_MARGIN_INC_GST;

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

const MAX_COUNT = 500;
/** A count as typed in Mitti ("6", "6.0", " 12 "): one whole number 1–500, else null (never guessed). */
export function parseFixesCount(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\s*\d+(\.0+)?\s*$/.test(raw) ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= MAX_COUNT ? n : null;
}


const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
/** The quote line explanation from the ticks, in form order, quantities written in:
 *  "Replace 6 downlights with IC-4 rated LED downlights; Install 1 RCD safety switch; Other: …". */
export function describeFixesWork(i: { ticks: string[]; downlights: number | null; rcds: number | null; other: string }): string {
  return describeFixesWorkLines(i).join("; ");
}
/** The same wording, one line per tick (Task 9: the read-only work list on the electrician owner's "Your price" card). */
export function describeFixesWorkLines(i: { ticks: string[]; downlights: number | null; rcds: number | null; other: string }): string[] {
  return i.ticks.map((t) => {
    if (t === FIXES_DOWNLIGHT_OPTION && i.downlights != null) return `Replace ${i.downlights} ${plural(i.downlights, "downlight with an IC-4 rated LED downlight", "downlights with IC-4 rated LED downlights")}`;
    if (t === FIXES_RCD_OPTION && i.rcds != null) return `Install ${i.rcds} ${plural(i.rcds, "RCD safety switch", "RCD safety switches")}`;
    if (t === FIXES_OTHER_OPTION) return `Other: ${i.other}`;
    return t;
  });
}

export type FixesInclusions = { ok: true; included: string; lines: string[] } | { ok: false; reason: string } | { ok: false; reason: null };
/** Decision 308: the inclusions from the ticks (+ counts / Other). `reason: null` = nothing ticked at all (old form). */
export function fixesInclusionsFromTicks(short: Record<string, unknown>): FixesInclusions {
  // Decision 338: the "on site at the start" question (Yes) counts exactly like the old tick (same quote-line wording).
  const ticks: string[] = fixesWorkWithOnsite(short);
  if (!ticks.length) return { ok: false, reason: null };
  const downlights = ticks.includes(FIXES_DOWNLIGHT_OPTION) ? parseFixesCount(short["fixesDownlightCount"]) : null;
  if (ticks.includes(FIXES_DOWNLIGHT_OPTION) && downlights == null) return { ok: false, reason: "The PIESA form ticks downlights but not how many are being replaced" };
  const rcds = ticks.includes(FIXES_RCD_OPTION) ? parseFixesCount(short["fixesRcdCount"]) : null;
  if (ticks.includes(FIXES_RCD_OPTION) && rcds == null) return { ok: false, reason: "The PIESA form ticks RCD safety switches but not how many are being installed" };
  const other = typeof short["fixesOtherDetail"] === "string" ? short["fixesOtherDetail"].trim() : "";
  if (ticks.includes(FIXES_OTHER_OPTION) && !other) return { ok: false, reason: "The PIESA form ticks Other but does not describe the other work" };
  const lines = describeFixesWorkLines({ ticks, downlights, rcds, other });
  return { ok: true, included: lines.join("; "), lines };
}

export type FixesPriceSource =
  | { path: "a4_price"; electricianPriceIncGst: number; included: string }
  | { path: "rate_card"; reason: string };

/** Which way the fixes quote is priced, from the synced PIESA short answers (shortAnswersFromEntries("piesa", …)).
 *  Needs the price + at least one tick (with its count / Other detail); an old form's decision-305 free text is the fallback.
 *  Task 9 (Jo 28 Oct 2026): `portalPriceIncGst` = the electrician business owner's (or the office's) price from the
 *  portal "Your price" card (electrician-repair-price.core). It wins; the form's own price is only the fallback for old forms. */
export function fixesPriceSource(short: Record<string, unknown> | null | undefined, portalPriceIncGst: number | null = null): FixesPriceSource {
  if (!short) return { path: "rate_card", reason: "No synced PIESA form answers" };
  const ticks = fixesInclusionsFromTicks(short);
  const legacy = typeof short["fixesIncluded"] === "string" ? short["fixesIncluded"].trim() : "";
  const portal = portalPriceIncGst != null && Number.isFinite(portalPriceIncGst) && portalPriceIncGst > 0 ? r2(portalPriceIncGst) : null;
  const rawPrice = portal ?? short["fixesPriceIncGst"];
  const blankPrice = rawPrice == null || (typeof rawPrice === "string" && !rawPrice.trim());
  if (blankPrice && !ticks.ok && ticks.reason === null && !legacy) return { path: "rate_card", reason: "The PIESA form has no repair price (older form)" };
  const price = parseFixesPrice(rawPrice);
  if (price == null) return { path: "rate_card", reason: blankPrice ? "The PIESA form has no repair price" : `The repair price on the PIESA form could not be read: "${String(rawPrice).slice(0, 40)}"` };
  if (ticks.ok) return { path: "a4_price", electricianPriceIncGst: price, included: ticks.included };
  if (!ticks.ok && ticks.reason) return { path: "rate_card", reason: ticks.reason };
  if (legacy) return { path: "a4_price", electricianPriceIncGst: price, included: legacy };
  return { path: "rate_card", reason: "The PIESA form has a repair price but not what it includes" };
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
  const lines = margin > 0 ? applyRectificationMargin([base], margin) : [base];
  const subtotal = r2(lines.reduce((a, l) => a + l.line_total_inc_gst, 0));
  return { lines, subtotalIncGst: subtotal, electricianPriceIncGst: price, costExGst: r2(price / (1 + input.gstRate)), marginIncGst: margin };
}
