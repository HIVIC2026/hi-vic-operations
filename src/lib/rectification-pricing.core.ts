/**
 * Electrical fixes (rectification) quote pricing — pure.
 *
 * Jo 24 Oct 2026 (decision 142): the owner's price for electrical fixes is the electrician's
 * price plus $100 inc GST, spread across every line in proportion to its value so no single
 * line stands out. It covers the card fee we absorb on fixes payments (decision 141) and our
 * coordination; it is never a separate "Home Insulation Victoria" line and never changes the
 * electrician's own rate card or cost (quote_internals.cost_ex_gst stays the trade cost).
 * Unit prices round up to the cent, so the total lands on +$100 or a few cents over, never under.
 */
export const RECTIFICATION_MARGIN_INC_GST = 100;

export type RectificationLine = {
  code: string | null; description: string; quantity: number; unit: string;
  unit_price_inc_gst: number; line_total_inc_gst: number; is_other: boolean; explanation: string | null; sort: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const ceil2 = (n: number) => Math.ceil(n * 100 - 1e-9) / 100;

/** Spreads the margin over the lines in proportion to their totals (a zero-value quote gets a single flat line). */
export function applyRectificationMargin(lines: RectificationLine[], margin = RECTIFICATION_MARGIN_INC_GST): RectificationLine[] {
  const base = lines.reduce((a, l) => a + l.line_total_inc_gst, 0);
  if (base <= 0 || !lines.length) {
    const attendance: RectificationLine = { code: null, description: "Site attendance", quantity: 1, unit: "flat", unit_price_inc_gst: r2(margin), line_total_inc_gst: r2(margin), is_other: false, explanation: null, sort: 0 };
    return [attendance, ...lines.map((l) => ({ ...l, sort: l.sort + 1 }))];
  }
  const factor = 1 + margin / base;
  return lines.map((l) => {
    const qty = l.quantity > 0 ? l.quantity : 1;
    const unit = ceil2((l.line_total_inc_gst * factor) / qty);
    return { ...l, unit_price_inc_gst: unit, line_total_inc_gst: r2(unit * qty) };
  });
}
