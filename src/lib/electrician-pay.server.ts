// Decision 355 (Jo 25 Oct 2026): electricians are paid for the safety check (A4) and the electrical fixes (A5) 7 days
// after their Mitti form is 100% complete AND the owner has paid that step. This module reads, batched by job id, WHEN
// the owner paid the safety check and the fixes on the job's ONE invoice (decisions 139–144: cumulative payments in the
// append-only `owner_payment_recorded` ledger reaching the step's threshold; the Xero mirror `invoices.total_paid` as the
// fallback; legacy `assessment_payments` for the safety check), and combines it with the decision-318 form facts.
// Server-only, READ-ONLY: no writes, no senders. Callers: trade Money rows, office Money › Payouts, the trade job status
// line and office Mark paid — one rule (`electricianPayState`, trade-view.core).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { paymentPlan, stepPaidAt, toCents } from "./payments.core";

const db = admin as any; // eslint-disable-line @typescript-eslint/no-explicit-any
const chunks = <T,>(xs: T[], n = 100) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
async function inCol<T>(table: string, cols: string, col: string, vals: string[], extra?: (q: any) => any): Promise<T[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const out: T[] = [];
  for (const part of chunks([...new Set(vals)])) {
    let q = db.from(table).select(cols).in(col, part);
    if (extra) q = extra(q);
    const { data, error } = await q;
    // Fail closed: an unreadable payment fact means "not paid yet" upstream, never a guessed date.
    if (error) throw new Error(`Could not read ${table} for electrician pay: ${error.message}`);
    out.push(...((data ?? []) as T[]));
  }
  return out;
}

import type { OwnerElectricalPaid } from "./electrician-pay.core";
export type { OwnerElectricalPaid };

/** When the owner paid the safety check and the electrical fixes, per job (every requested job gets an entry). */
export async function ownerElectricalStepsPaidAt(jobIds: string[]): Promise<Map<string, OwnerElectricalPaid>> {
  const ids = [...new Set(jobIds)];
  const out = new Map<string, OwnerElectricalPaid>(ids.map((id) => [id, { safetyPaidAt: null, fixesPaidAt: null }]));
  if (!ids.length) return out;
  type Inv = { id: string; job_id: string; quote_id: string | null; total_inc_gst: number | string; total_paid: number | string | null; paid_at: string | null; balance_paid_at: string | null; deposit_paid_at: string | null; updated_at: string | null; created_at: string };
  const [invs, rects, ledger, legacy, { data: ws }] = await Promise.all([
    inCol<Inv>("invoices", "id, job_id, quote_id, total_inc_gst, total_paid, paid_at, balance_paid_at, deposit_paid_at, updated_at, created_at", "job_id", ids, (q) => q.eq("kind", "installation").order("created_at", { ascending: false })),
    inCol<{ job_id: string; customer_total_inc_gst: number | string; accepted_at: string | null }>("quotes", "job_id, customer_total_inc_gst, accepted_at", "job_id", ids, (q) => q.eq("kind", "rectification").eq("status", "accepted").order("accepted_at", { ascending: false })),
    inCol<{ job_id: string; created_at: string; details: { invoice_id?: string; amount_cents?: number; paid_at?: string } | null }>("workflow_events", "job_id, created_at, details", "job_id", ids, (q) => q.eq("event_type", "owner_payment_recorded")),
    inCol<{ job_id: string; paid_at: string | null }>("assessment_payments", "job_id, paid_at", "job_id", ids, (q) => q.eq("status", "paid")),
    db.from("workflow_settings").select("safety_check_payment_inc_gst").eq("id", 1).maybeSingle(),
  ]);
  const latest = new Map<string, Inv>();
  for (const i of invs) if (!latest.has(i.job_id)) latest.set(i.job_id, i);
  const quoteIds = [...latest.values()].map((i) => i.quote_id).filter((x): x is string => !!x);
  const piesaLines = quoteIds.length ? await inCol<{ quote_id: string; code: string | null; line_total_inc_gst: number | string | null }>("quote_items", "quote_id, code, line_total_inc_gst", "quote_id", quoteIds, (q) => q.eq("code", "PIESA")) : [];
  const { safetyCheckCentsFor } = await import("./safety-check-amount.core");
  for (const id of ids) {
    const inv = latest.get(id);
    const legacySafety = legacy.filter((l) => l.job_id === id && l.paid_at).map((l) => String(l.paid_at)).sort()[0] ?? null;
    if (!inv) { out.set(id, { safetyPaidAt: legacySafety, fixesPaidAt: null }); continue; }
    const rect = rects.find((r) => r.job_id === id) ?? null;
    const safety = safetyCheckCentsFor({ lines: piesaLines.filter((l) => l.quote_id === inv.quote_id), settingIncGst: ws?.safety_check_payment_inc_gst ?? null });
    const plan = paymentPlan({ quoteTotalCents: toCents(inv.total_inc_gst), safetyCheckCents: safety.cents, fixesCents: rect ? toCents(rect.customer_total_inc_gst) : 0 });
    const records = ledger.filter((e) => e.job_id === id && e.details?.invoice_id === inv.id).map((e) => ({ amountCents: Number(e.details?.amount_cents ?? 0), paidAt: String(e.details?.paid_at ?? e.created_at) }));
    // The Xero mirror without ledger rows: the latest known paid time on the invoice (never earlier than the money).
    const fallback = { paidCents: toCents(inv.total_paid), at: inv.balance_paid_at ?? inv.paid_at ?? inv.deposit_paid_at ?? inv.updated_at ?? null };
    out.set(id, { safetyPaidAt: stepPaidAt(plan, "safety_check", records, fallback) ?? legacySafety, fixesPaidAt: stepPaidAt(plan, "fixes", records, fallback) });
  }
  return out;
}

export { electricianPayTiming, type ElectricianPayTiming } from "./electrician-pay.core";
