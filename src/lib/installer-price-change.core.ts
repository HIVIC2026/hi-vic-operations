export const PRICE_CHANGE_WAITING = 'New price sent to Home Insulation Victoria — waiting for the new quote to go out';
export type PriceChange = { oldPrice: number; newPrice: number; reason: string | null; replacesQuoteId: string | null; at: string };
export function priceChangeFromEvent(details: unknown, at: string): PriceChange | null {
  if (!details || typeof details !== 'object') return null;
  const d = details as Record<string, unknown>;
  if (d['price_changed_by_installer'] !== true) return null;
  const oldPrice = Number(d['previous_price_inc_gst']), newPrice = Number(d['price_inc_gst']);
  if (!Number.isFinite(oldPrice) || oldPrice <= 0 || !Number.isFinite(newPrice) || newPrice <= 0) return null;
  return { oldPrice, newPrice, reason: typeof d['change_reason'] === 'string' ? d['change_reason'] : null, replacesQuoteId: typeof d['replaces_quote_id'] === 'string' ? d['replaces_quote_id'] : null, at };
}
export function pendingPriceChange(change: PriceChange | null, latestSentAt: string | null): boolean {
  return !!change?.replacesQuoteId && (!latestSentAt || change.at > latestSentAt);
}
export function validatePriceChangeReason(sent: boolean, reason: string | undefined): string | null {
  return sent && !reason?.trim() ? 'Add a short reason for the new price.' : null;
}