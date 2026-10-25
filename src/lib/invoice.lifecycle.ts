import { splitForOption } from "./payment-gate.core";
// Pure ONE-invoice lifecycle: one full Xero invoice per accepted quote. The configured deposit is raised in Xero with its
// native "Request Deposit" (manual, recorded here) and is CONFIRMED only by cumulative AmountPaid on this invoice.
// No database or Xero imports: the server passes a Supabase-backed InvoiceStore; tests pass an in-memory one.

export interface InvoiceRow {
  id: string; job_id: string; quote_id: string; kind: string; status: string;
  total_inc_gst: number; deposit_pct: number; deposit_amount: number; balance_amount: number;
  deposit_due_date: string | null; balance_due_date: string | null;
  total_paid: number; deposit_paid_at: string | null; deposit_paid_amount?: number; balance_paid_at: string | null;
  xero_invoice_id: string | null; xero_update_pending: boolean;
  deposit_request_raised_at: string | null; deposit_request_raised_by: string | null;
  deposit_request_amount: number | null; deposit_request_pct: number | null;
}

export interface InvoiceStore {
  find(quoteId: string): Promise<InvoiceRow | null>;
  /** Must reject with `{ code: "23505" }` when an invoice for the quote already exists. */
  insert(row: Pick<InvoiceRow, "job_id" | "quote_id" | "kind" | "status" | "total_inc_gst" | "deposit_pct" | "deposit_amount" | "balance_amount" | "deposit_due_date">): Promise<InvoiceRow>;
  update(id: string, patch: Partial<InvoiceRow>): Promise<void>;
}

/** Customer-facing invoice columns (owner portal, from `invoice_status`). Never add Xero IDs, errors or internal flags. */
export const CUSTOMER_INVOICE_COLUMNS = [
  "id", "job_id", "kind", "xero_invoice_number", "xero_online_url", "total_inc_gst", "deposit_amount", "deposit_paid_at",
  "balance_amount", "balance_due_date", "balance_paid_at", "total_paid", "deposit_cleared", "effective_status", "created_at",
] as const;

const cents = (n: number | string) => Math.round(Number(n) * 100);

/** Currency-safe split: deposit = configured minimum upfront payment (10% / 5%), balance = total − deposit. */
export function splitTotal(total: number | string, safetyFeeIncGst?: number | string | null) {
  const { deposit, balance, depositPct } = splitForOption(total, safetyFeeIncGst);
  return { deposit, balance, depositPct };
}

/** One invoice per accepted quote – safe to call repeatedly or concurrently. Decision 302: `safetyFeeIncGst` = the quote's
 *  PIESA line (the deposit raised in Xero), default $349 when the caller has none. */
export async function ensureInvoice(store: InvoiceStore, quote: { id: string; job_id: string; kind: string; status: string; customer_total_inc_gst: number | string }, today: string, safetyFeeIncGst?: number | string | null) {
  if (quote.status !== "accepted") throw new Error(`Quote is ${quote.status}, not accepted – no invoice raised.`);
  const existing = await store.find(quote.id);
  if (existing) return { row: existing, created: false };
  const total = Number(quote.customer_total_inc_gst);
  const { deposit, balance, depositPct } = splitTotal(total, safetyFeeIncGst);
  const row = { job_id: quote.job_id, quote_id: quote.id, kind: quote.kind, status: "invoice_not_created", total_inc_gst: total, deposit_pct: depositPct, deposit_amount: deposit, balance_amount: balance, deposit_due_date: today };
  try {
    return { row: await store.insert(row), created: true };
  } catch (e) {
    if ((e as { code?: string })?.code !== "23505") throw e;
    const again = await store.find(quote.id);
    if (!again) throw e;
    return { row: again, created: false };
  }
}

/** Installation booked/rebooked: the SAME invoice's final due date = Melbourne-local install date. Flags a Xero update if linked. */
export function installDueDatePatch(row: InvoiceRow, installDate: string): Partial<InvoiceRow> | null {
  if (Number(row.total_paid) >= Number(row.total_inc_gst)) return null;
  if (row.balance_due_date === installDate) return null;
  return { balance_due_date: installDate, ...(row.xero_invoice_id ? { xero_update_pending: true } : {}) };
}

/** Installation cancelled: final due date returns to pending (never invented). */
export function clearInstallDueDatePatch(row: InvoiceRow): Partial<InvoiceRow> | null {
  if (Number(row.total_paid) >= Number(row.total_inc_gst) || row.balance_due_date === null) return null;
  return { balance_due_date: null, xero_update_pending: false };
}

/** Xero due date for the invoice: install date once known, otherwise the acceptance date (deposit due immediately). */
export const xeroDueDate = (row: Pick<InvoiceRow, "balance_due_date" | "deposit_due_date">) => row.balance_due_date ?? row.deposit_due_date;

/** Cumulative AmountPaid on the ONE invoice → patch. deposit_paid_at is set once the configured minimum upfront payment is reached (the gate itself is evaluatePaymentGate). */
export function paymentPatch(row: InvoiceRow, paid: number, depositReachedAt: string | null, nowIso: string) {
  const patch: Partial<InvoiceRow> = { total_paid: paid };
  const events: string[] = [];
  if (!row.deposit_paid_at && cents(paid) >= cents(row.deposit_amount)) {
    patch.deposit_paid_at = depositReachedAt ?? nowIso;
    patch.deposit_paid_amount = Number(row.deposit_amount);
    patch.status = "deposit_paid";
    events.push("deposit_paid");
  }
  if (cents(paid) >= cents(row.total_inc_gst) && !row.balance_paid_at) {
    patch.balance_paid_at = nowIso;
    patch.status = "fully_paid";
    events.push("balance_paid");
  }
  return { patch, events };
}

/** Minimum-deposit fact: configured minimum paid per Xero, or an audited admin override. The deposit-request flag is deliberately ignored. */
export const depositGateCleared = (row: Pick<InvoiceRow, "deposit_paid_at"> | null, overrideCount: number) =>
  !!row && (!!row.deposit_paid_at || overrideCount > 0);

/** Admin records that the native Xero deposit request was raised. Operational only – never unlocks scheduling. */
export function depositRequestPatch(row: Pick<InvoiceRow, "deposit_request_raised_at" | "deposit_amount" | "deposit_pct">, actorId: string, nowIso: string) {
  if (row.deposit_request_raised_at) throw new Error("The Xero deposit request is already recorded as raised.");
  return { deposit_request_raised_at: nowIso, deposit_request_raised_by: actorId, deposit_request_amount: Number(row.deposit_amount), deposit_request_pct: row.deposit_pct == null ? null : Math.round(Number(row.deposit_pct) * 100) };
}

/** Audited override record (deposit gate only). */
export function buildDepositOverride(row: Pick<InvoiceRow, "id" | "job_id" | "status" | "deposit_paid_at" | "total_paid">, reason: string, actorId: string, stage: string) {
  if (reason.trim().length < 5) throw new Error("A reason (at least 5 characters) is required.");
  const before = { invoice_status: row.status, deposit_paid_at: row.deposit_paid_at, total_paid: row.total_paid, deposit_gate: "locked", stage };
  const after = { ...before, deposit_gate: "overridden" };
  return { invoice_id: row.id, job_id: row.job_id, gate: "deposit", reason: reason.trim(), overridden_by: actorId, before_state: before, after_state: after };
}
