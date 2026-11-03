// "What's changed from your estimate" (decision #29, Jo 2 Nov 2026): the quote email (and quote page) show an
// Estimate vs Quote box under the price with ONLY the rows that changed (ceiling size, old insulation removal, price),
// hidden when nothing changed. PURE: no I/O.
import * as K from "./email-kit.core";

export const QUOTE_CHANGES_HEADING = "What's changed from your estimate";
export const QUOTE_CHANGES_FOOTNOTE = "Your quote uses what the installer measured at your Ready Check.";

export type EstimateVsQuote = {
  estimate: { areaM2: number | null; removal: boolean | null; price: number | null };
  quote: { areaM2: number; removal: boolean; price: number };
};
export type QuoteChangeRow = { label: "Ceiling size" | "Old insulation removal" | "Your price"; estimate: string; quote: string };

const num = (n: number | null | undefined): number | null => (n != null && Number.isFinite(n) && n > 0 ? n : null);
const yesNo = (b: boolean) => (b ? "Yes" : "No");

/** Only the rows whose shown value changed; a row the estimate never recorded is left out. Empty when nothing changed or no estimate. */
export function quoteChangeRows(x: EstimateVsQuote): QuoteChangeRow[] {
  const rows: QuoteChangeRow[] = [];
  const add = (label: QuoteChangeRow["label"], estimate: string | null, quote: string | null) => {
    if (estimate != null && quote != null && estimate !== quote) rows.push({ label, estimate, quote });
  };
  const ea = num(x.estimate.areaM2), qa = num(x.quote.areaM2);
  add("Ceiling size", ea == null ? null : K.m2(ea), qa == null ? null : K.m2(qa));
  add("Old insulation removal", x.estimate.removal == null ? null : yesNo(x.estimate.removal), yesNo(x.quote.removal));
  const ep = num(x.estimate.price), qp = x.quote.price != null && Number.isFinite(x.quote.price) && x.quote.price >= 0 ? x.quote.price : null;
  add("Your price", ep == null ? null : K.whole(ep), qp == null ? null : K.whole(qp));
  return rows;
}
