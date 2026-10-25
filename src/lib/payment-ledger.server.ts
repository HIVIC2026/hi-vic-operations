// The owner-payment ledger READER, kept lean (only the database client + the pure payments.core rules) so read-only
// gates on the stage/auto-advance import graph — electrical-clearance.server (review R08) — can count money received
// without pulling payments.server's senders, Stripe or Xero follow-ups into that graph (tests/comms.test.ts).
// payments.server re-exports everything here; the rules are unchanged (audit F01 reconciliation).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { cumulativePaidCents, effectiveLedger, ledgerRecordFromEvent, toCents, type PaymentRecord } from "./payments.core";

export const PAYMENT_EVENT = "owner_payment_recorded";
/** Audit F01: a recorded Xero payment that Xero later shows DELETED/VOIDED (or no longer lists). One per PaymentID. */
export const PAYMENT_REVERSED_EVENT = "owner_payment_reversed";

type LedgerRow = { id: string; event_type: string; created_at: string; actor_id: string | null; details: Record<string, unknown> };
/** Every payment + reversal row for the invoice, as recorded (append-only). Use `paymentLedger` for money received. */
export async function rawPaymentLedger(jobId: string, invoiceId?: string): Promise<(PaymentRecord & { id: string; createdAt: string })[]> {
  const { data } = await admin.from("workflow_events").select("id, event_type, created_at, actor_id, details").eq("job_id", jobId).in("event_type", [PAYMENT_EVENT, PAYMENT_REVERSED_EVENT]).order("created_at");
  return ((data ?? []) as unknown as LedgerRow[])
    .filter((r) => !invoiceId || r.details["invoice_id"] === invoiceId)
    .map((r) => ({ id: r.id, createdAt: r.created_at, ...ledgerRecordFromEvent(r.event_type, r.created_at, r.actor_id, r.details) }));
}

/** Money received on the invoice in cents — the same figure `jobPaymentView` uses: the reconciled ledger, or (an invoice
 *  paid before the ledger existed, no Xero rows at all) Xero's mirrored total_paid, counted once, never added on top. */
export async function invoicePaidCents(jobId: string, invoiceId: string, totalPaid: number | string | null | undefined): Promise<number> {
  const raw = await rawPaymentLedger(jobId, invoiceId);
  const ledger = effectiveLedger(raw);
  return raw.some((r) => r.source === "xero") ? cumulativePaidCents(ledger) : Math.max(cumulativePaidCents(ledger), toCents(totalPaid ?? 0));
}
