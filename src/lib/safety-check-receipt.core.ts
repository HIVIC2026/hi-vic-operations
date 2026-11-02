// Which ledger payment is THE safety check receipt for the "You're in!" email (O22). Pure: no database, no flags read here.
// Attach only on an exact match (same paid_at instant, amount = the plan's safety check, not reversed, exactly one); else nothing.

export type ReceiptEvent = { receipt_key?: string; paid_at?: string; amount_cents?: number; xero_payment_id?: string; stripe_payment_intent?: string };

const sameTime = (a: string | undefined, b: string) => {
  const x = a ? Date.parse(a) : NaN;
  const y = Date.parse(b);
  return !Number.isNaN(x) && !Number.isNaN(y) && x === y;
};

export function pickSafetyCheckReceiptKey(i: { recorded: ReceiptEvent[]; reversed: ReceiptEvent[]; paidAt: string; safetyCheckCents: number }): string | null {
  const isReversed = (r: ReceiptEvent) => i.reversed.some((x) => (!!r.xero_payment_id && x.xero_payment_id === r.xero_payment_id) || (!!r.stripe_payment_intent && x.stripe_payment_intent === r.stripe_payment_intent));
  const hits = i.recorded.filter((r) => !!r.receipt_key && sameTime(r.paid_at, i.paidAt) && Number(r.amount_cents) === i.safetyCheckCents && !isReversed(r));
  return hits.length === 1 ? hits[0]!.receipt_key! : null;
}

/** Flag off → null without reading anything. `loadEvents` is injected (the server file reads workflow_events). */
export async function safetyCheckReceiptKey(
  deps: { receiptsApproved: boolean; loadEvents: () => Promise<{ recorded: ReceiptEvent[]; reversed: ReceiptEvent[] }> },
  i: { paidAt: string; safetyCheckCents: number },
): Promise<string | null> {
  if (!deps.receiptsApproved) return null;
  const { recorded, reversed } = await deps.loadEvents();
  return pickSafetyCheckReceiptKey({ recorded, reversed, ...i });
}
