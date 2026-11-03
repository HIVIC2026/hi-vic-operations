// Part 4 Task 6 (#44): which ledger payment is THE 10% deposit receipt. Pure: no database, no flags read here.
// Attach only on an exact match (the plan's deposit amount, not reversed, exactly one); else nothing.
export type DepositReceiptEvent = { receipt_key?: string; amount_cents?: number; xero_payment_id?: string; stripe_payment_intent?: string };

export function pickDepositReceiptKey(i: { recorded: DepositReceiptEvent[]; reversed: DepositReceiptEvent[]; depositCents: number }): string | null {
  const isReversed = (r: DepositReceiptEvent) => i.reversed.some((x) => (!!r.xero_payment_id && x.xero_payment_id === r.xero_payment_id) || (!!r.stripe_payment_intent && x.stripe_payment_intent === r.stripe_payment_intent));
  const hits = i.recorded.filter((r) => !!r.receipt_key && Number(r.amount_cents) === i.depositCents && !isReversed(r));
  return hits.length === 1 ? hits[0]!.receipt_key! : null;
}
