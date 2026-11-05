// A quote's lines must add up to its subtotal, and subtotal minus rebate must equal the owner's price (±1 cent).
// Checked before any quote becomes visible to the owner.
const CENT = 0.01 + 1e-9;

export function quoteTotalsMismatch(
  q: { subtotal_inc_gst: number; veec_discount_inc_gst: number; customer_total_inc_gst: number },
  items: { line_total_inc_gst: number }[],
): string | null {
  const lines = items.reduce((a, i) => a + Number(i.line_total_inc_gst), 0);
  const subtotal = Number(q.subtotal_inc_gst);
  const rebate = Number(q.veec_discount_inc_gst);
  const total = Number(q.customer_total_inc_gst);
  if (![lines, subtotal, rebate, total].every(Number.isFinite)) return "Quote amounts are missing or not numbers";
  if (Math.abs(lines - subtotal) > CENT) return `Quote lines add up to $${lines.toFixed(2)} but the subtotal is $${subtotal.toFixed(2)}`;
  if (Math.abs(subtotal - rebate - total) > CENT) return `Subtotal $${subtotal.toFixed(2)} minus rebate $${rebate.toFixed(2)} is $${(subtotal - rebate).toFixed(2)} but the owner price is $${total.toFixed(2)}`;
  return null;
}

export const QUOTE_TOTALS_HOLD_REASON = "Quote totals don't add up";
