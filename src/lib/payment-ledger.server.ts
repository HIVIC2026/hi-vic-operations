// The owner-payment ledger READER, kept lean (only the database client + the pure payments.core rules) so read-only
// gates on the stage/auto-advance import graph — electrical-clearance.server (review R08) — can count money received
// without pulling payments.server's senders, Stripe or Xero follow-ups into that graph (tests/comms.test.ts).
// payments.server re-exports everything here; the rules are unchanged (audit F01 reconciliation).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { cumulativePaidCents, effectiveLedger, ledgerRecordFromEvent, toCents, withSeparateMarks, type PaymentRecord } from "./payments.core";
import { paymentPlan, paymentSteps, isStepPaid } from "./payments.core";
import { safetyCheckCentsFor } from "./safety-check-amount.core";
import { readByJobIds } from "./sweep-batch.server";

export const PAYMENT_EVENT = "owner_payment_recorded";
/** Audit F01: a recorded Xero payment that Xero later shows DELETED/VOIDED (or no longer lists). One per PaymentID. */
export const PAYMENT_REVERSED_EVENT = "owner_payment_reversed";

/** Office pressed "Two separate payments" on a card + Xero pair that had no shared Stripe id (details.pair_key). Append-only. */
export const PAYMENT_MATCH_SEPARATE_EVENT = "payment_match_separate";

type LedgerRow = { id: string; event_type: string; created_at: string; actor_id: string | null; details: Record<string, unknown> };
/** Every payment + reversal row for the invoice, as recorded (append-only). Use `paymentLedger` for money received. */
export async function rawPaymentLedger(jobId: string, invoiceId?: string): Promise<(PaymentRecord & { id: string; createdAt: string })[]> {
  // Speed (installer screens, Task 6): the payments and the "two separate payments" marks are independent — one round.
  const [{ data }, { data: marks }] = await Promise.all([
    admin.from("workflow_events").select("id, event_type, created_at, actor_id, details").eq("job_id", jobId).in("event_type", [PAYMENT_EVENT, PAYMENT_REVERSED_EVENT]).order("created_at"),
    admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", PAYMENT_MATCH_SEPARATE_EVENT),
  ]);
  const separate = ((marks ?? []) as unknown as { details: Record<string, unknown> | null }[])
    .filter((m) => !invoiceId || m.details?.["invoice_id"] === invoiceId).map((m) => String(m.details?.["pair_key"] ?? "")).filter(Boolean);
  const rows = ((data ?? []) as unknown as LedgerRow[])
    .filter((r) => !invoiceId || r.details["invoice_id"] === invoiceId)
    .map((r) => ({ id: r.id, createdAt: r.created_at, ...ledgerRecordFromEvent(r.event_type, r.created_at, r.actor_id, r.details) }));
  return withSeparateMarks(rows, separate);
}

/** Money received on the invoice in cents — the same figure `jobPaymentView` uses: the reconciled ledger, or (an invoice
 *  paid before the ledger existed, no Xero rows at all) Xero's mirrored total_paid, counted once, never added on top. */
export async function invoicePaidCents(jobId: string, invoiceId: string, totalPaid: number | string | null | undefined): Promise<number> {
  const raw = await rawPaymentLedger(jobId, invoiceId);
  const ledger = effectiveLedger(raw);
  return raw.some((r) => r.source === "xero") ? cumulativePaidCents(ledger) : Math.max(cumulativePaidCents(ledger), toCents(totalPaid ?? 0));
}

/** Read-only list fact: the same installation-invoice threshold/reconciled money as jobPaymentView,
 * without reading the entire owner payment page once per list row. Callers supply already authorised job ids. */
export async function installDepositPaidForJobs(jobIds: string[]): Promise<Map<string, boolean | null>> {
  const ids = [...new Set(jobIds)];
  const result = new Map<string, boolean | null>(ids.map(id => [id, null]));
  if (!ids.length) return result;
  type Invoice = { id: string; job_id: string; quote_id: string | null; total_inc_gst: number | string; total_paid: number | string | null };
  type Event = LedgerRow & { job_id: string };
  const [invoices, events, setting] = await Promise.all([
    readByJobIds<Invoice>('installation invoices', ids, chunk => admin.from('invoices').select('id,job_id,quote_id,total_inc_gst,total_paid').in('job_id', chunk).eq('kind', 'installation').order('created_at', { ascending: false })),
    readByJobIds<Event>('installation payment history', ids, chunk => admin.from('workflow_events').select('id,job_id,event_type,created_at,actor_id,details').in('job_id', chunk).in('event_type', [PAYMENT_EVENT, PAYMENT_REVERSED_EVENT, PAYMENT_MATCH_SEPARATE_EVENT]).order('created_at')),
    admin.from('workflow_settings').select('safety_check_payment_inc_gst').eq('id', 1).maybeSingle(),
  ]);
  if (setting.error) throw new Error('The safety-check amount could not be checked.');
  const newest = new Map<string, Invoice>();
  for (const invoice of invoices) if (!newest.has(invoice.job_id)) newest.set(invoice.job_id, invoice);
  const quoteIds = [...new Set([...newest.values()].flatMap(i => i.quote_id ? [i.quote_id] : []))];
  type Line = { quote_id: string; code: string | null; line_total_inc_gst: number | string | null };
  const lines = await readByJobIds<Line>('installation PIESA lines', quoteIds, chunk => admin.from('quote_items').select('quote_id,code,line_total_inc_gst').in('quote_id', chunk).eq('code', 'PIESA'));
  const eventsByJob = new Map<string, Event[]>();
  for (const event of events) { const group = eventsByJob.get(event.job_id) ?? []; group.push(event); eventsByJob.set(event.job_id, group); }
  const linesByQuote = new Map<string, Line[]>();
  for (const line of lines) { const group = linesByQuote.get(line.quote_id) ?? []; group.push(line); linesByQuote.set(line.quote_id, group); }
  for (const [jobId, invoice] of newest) {
    const own = (eventsByJob.get(jobId) ?? []).filter(e => e.details?.['invoice_id'] === invoice.id);
    const marks = own.filter(e => e.event_type === PAYMENT_MATCH_SEPARATE_EVENT).map(e => String(e.details['pair_key'] ?? '')).filter(Boolean);
    const raw = withSeparateMarks(own.filter(e => e.event_type !== PAYMENT_MATCH_SEPARATE_EVENT).map(e => ({ id: e.id, createdAt: e.created_at, ...ledgerRecordFromEvent(e.event_type, e.created_at, e.actor_id, e.details) })), marks);
    const received = cumulativePaidCents(effectiveLedger(raw));
    const paid = raw.some(r => r.source === 'xero') ? received : Math.max(received, toCents(invoice.total_paid));
    const safety = safetyCheckCentsFor({ lines: linesByQuote.get(invoice.quote_id ?? '') ?? [], settingIncGst: setting.data?.safety_check_payment_inc_gst ?? null });
    const plan = paymentPlan({ quoteTotalCents: toCents(invoice.total_inc_gst), safetyCheckCents: safety.cents });
    result.set(jobId, isStepPaid(paymentSteps(plan, { install: paid, fixes: 0, repeat: 0 }, {}, new Date().toISOString()), 'install_deposit'));
  }
  return result;
}
