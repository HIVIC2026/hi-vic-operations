// Pure two-invoice lifecycle (DEPOSIT + BALANCE per accepted quote). No database or Xero imports:
// the server passes a Supabase-backed InvoiceStore; tests pass an in-memory one.
export type InvoicePart = "deposit" | "balance";

export interface InvoiceRow {
  id: string; job_id: string; quote_id: string; kind: string; part: InvoicePart; status: string;
  total_inc_gst: number; deposit_amount: number; balance_amount: number; amount_inc_gst: number;
  due_date: string | null; deposit_due_date?: string | null; amount_paid: number; paid_at: string | null;
  deposit_paid_at: string | null; balance_paid_at?: string | null; balance_due_date?: string | null;
  xero_invoice_id: string | null; xero_update_pending: boolean;
}

export interface InvoiceStore {
  find(quoteId: string, part: InvoicePart): Promise<InvoiceRow | null>;
  /** Must reject with `{ code: "23505" }` when (quote_id, part) already exists. */
  insert(row: Omit<InvoiceRow, "id" | "xero_invoice_id" | "xero_update_pending" | "paid_at" | "deposit_paid_at">): Promise<InvoiceRow>;
  update(id: string, patch: Partial<InvoiceRow>): Promise<void>;
}

/** Customer-facing invoice columns (owner portal). Never add Xero IDs, errors or internal flags. */
export const CUSTOMER_INVOICE_COLUMNS = [
  "id", "job_id", "part", "kind", "xero_invoice_number", "xero_online_url", "total_inc_gst", "amount_inc_gst",
  "due_date", "amount_paid", "paid_at", "deposit_cleared", "effective_status", "created_at",
] as const;

const cents = (n: number | string) => Math.round(Number(n) * 100);

/** Currency-safe 50/50 split: deposit = round(total*0.5, 2), balance = total − deposit. */
export function splitTotal(total: number | string) {
  const t = cents(total);
  const d = Math.round(t / 2);
  return { deposit: d / 100, balance: (t - d) / 100 };
}

async function insertOrGet(store: InvoiceStore, row: Parameters<InvoiceStore["insert"]>[0]) {
  try {
    return { row: await store.insert(row), created: true };
  } catch (e) {
    if ((e as { code?: string })?.code !== "23505") throw e;
    const existing = await store.find(row.quote_id, row.part);
    if (!existing) throw e;
    return { row: existing, created: false };
  }
}

/** One DEPOSIT invoice per accepted quote – safe to call repeatedly. */
export async function ensureDepositInvoice(store: InvoiceStore, quote: { id: string; job_id: string; kind: string; status: string; customer_total_inc_gst: number | string }, today: string) {
  if (quote.status !== "accepted") throw new Error(`Quote is ${quote.status}, not accepted – no invoice raised.`);
  const existing = await store.find(quote.id, "deposit");
  if (existing) return { row: existing, created: false };
  const total = Number(quote.customer_total_inc_gst);
  const { deposit, balance } = splitTotal(total);
  return insertOrGet(store, {
    job_id: quote.job_id, quote_id: quote.id, kind: quote.kind, part: "deposit", status: "invoice_not_created",
    total_inc_gst: total, deposit_amount: deposit, balance_amount: balance, amount_inc_gst: deposit,
    due_date: today, deposit_due_date: today, amount_paid: 0,
  });
}

/** One BALANCE invoice per accepted quote, due on the (Melbourne-local) installation date. Reused across rebookings. */
export async function ensureBalanceInvoice(store: InvoiceStore, deposit: InvoiceRow, dueDate: string) {
  const existing = await store.find(deposit.quote_id, "balance");
  if (existing) {
    if (existing.amount_paid >= existing.amount_inc_gst) return { row: existing, created: false, dueChanged: false };
    if (existing.due_date === dueDate) return { row: existing, created: false, dueChanged: false };
    const patch: Partial<InvoiceRow> = { due_date: dueDate, balance_due_date: dueDate, ...(existing.xero_invoice_id ? { xero_update_pending: true } : {}) };
    await store.update(existing.id, patch);
    return { row: { ...existing, ...patch }, created: false, dueChanged: true };
  }
  const r = await insertOrGet(store, {
    job_id: deposit.job_id, quote_id: deposit.quote_id, kind: deposit.kind, part: "balance", status: "invoice_not_created",
    total_inc_gst: deposit.total_inc_gst, deposit_amount: deposit.deposit_amount, balance_amount: deposit.balance_amount,
    amount_inc_gst: deposit.balance_amount, due_date: dueDate, balance_due_date: dueDate, deposit_due_date: deposit.deposit_due_date ?? null, amount_paid: 0,
  });
  return { ...r, dueChanged: false };
}

/** Installation cancelled: keep the unpaid balance record for rebooking; clear its local due date. */
export async function unscheduleBalance(store: InvoiceStore, quoteId: string) {
  const b = await store.find(quoteId, "balance");
  if (!b || b.amount_paid >= b.amount_inc_gst || b.due_date === null) return null;
  await store.update(b.id, { due_date: null, balance_due_date: null });
  return b;
}

/** Turn a Xero paid amount into a row patch. Only a FULL deposit sets deposit_paid_at (the gate). */
export function paymentPatch(row: InvoiceRow, paid: number, paidAt: string | null, nowIso: string) {
  const patch: Partial<InvoiceRow> & { deposit_paid_amount?: number } = { amount_paid: paid };
  (patch as Record<string, unknown>)["total_paid"] = paid;
  const events: string[] = [];
  const full = paid >= Number(row.amount_inc_gst);
  if (full && !row.paid_at) {
    patch.paid_at = paidAt ?? nowIso;
    if (row.part === "deposit") {
      patch.deposit_paid_at = patch.paid_at; patch.deposit_paid_amount = Number(row.amount_inc_gst); patch.status = "deposit_paid";
      events.push("deposit_paid");
    } else {
      patch.balance_paid_at = patch.paid_at; patch.status = "fully_paid";
      events.push("balance_paid");
    }
  }
  return { patch, events };
}

/** Deposit gate for one deposit row: paid in full per Xero, or an audited admin override. */
export const depositGateCleared = (row: Pick<InvoiceRow, "part" | "deposit_paid_at"> | null, overrideCount: number) =>
  !!row && row.part === "deposit" && (!!row.deposit_paid_at || overrideCount > 0);

/** Audited override record (deposit gate only). */
export function buildDepositOverride(row: Pick<InvoiceRow, "id" | "job_id" | "part" | "status" | "deposit_paid_at" | "amount_paid">, reason: string, actorId: string, stage: string) {
  if (row.part !== "deposit") throw new Error("Overrides apply only to the deposit gate.");
  if (reason.trim().length < 5) throw new Error("A reason (at least 5 characters) is required.");
  const before = { invoice_status: row.status, deposit_paid_at: row.deposit_paid_at, amount_paid: row.amount_paid, deposit_gate: "locked", stage };
  const after = { ...before, deposit_gate: "overridden" };
  return { invoice_id: row.id, job_id: row.job_id, gate: "deposit", reason: reason.trim(), overridden_by: actorId, before_state: before, after_state: after };
}
