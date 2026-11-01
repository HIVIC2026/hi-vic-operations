// Batched, authorised list-only deposit facts. No delivery or mutation dependencies.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { cumulativePaidCents, effectiveLedger, ledgerRecordFromEvent, toCents, withSeparateMarks, paymentPlan, paymentSteps, isStepPaid } from "./payments.core";
import { PAYMENT_EVENT, PAYMENT_REVERSED_EVENT, PAYMENT_MATCH_SEPARATE_EVENT } from "./payment-ledger.server";
import { safetyCheckCentsFor } from "./safety-check-amount.core";
import { readByJobIds } from "./sweep-batch.server";
type LedgerRow = { id: string; event_type: string; created_at: string; actor_id: string | null; details: Record<string, unknown> };
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
