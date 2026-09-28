// Xero integration boundary – two invoices per accepted quote: DEPOSIT (50%, due now) and BALANCE (50%, due on
// the Melbourne-local installation date). Xero is the system of record; the portal mirrors state and enforces gates.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  buildDueDateUpdate, buildInvoicePayload, evaluateXeroInvoice, findInvoiceByReference, findOrCreateContact, findTrackingOption,
  invoiceIdemKey, LOCK_STALE_MS, melbourneDate, quoteGuard, XERO_DUE_DATE_UPDATES_ENABLED, xeroReference, type XeroCall,
} from "./xero.core";
import { ensureBalanceInvoice, ensureDepositInvoice, paymentPatch, unscheduleBalance, type InvoicePart, type InvoiceRow, type InvoiceStore } from "./invoice.lifecycle";

const GATEWAY = "https://connector-gateway.lovable.dev/xero";

function creds() {
  const lovable = process.env["LOVABLE_API_KEY"];
  const xero = process.env["XERO_API_KEY"];
  return lovable && xero ? { lovable, xero } : null;
}

async function rawFetch(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}, tenantId?: string) {
  const c = creds();
  if (!c) throw new Error("Xero is not connected");
  const res = await fetch(`${GATEWAY}${path}`, {
    method: init.method ?? "GET",
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    headers: {
      Authorization: `Bearer ${c.lovable}`,
      "X-Connection-Api-Key": c.xero,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(tenantId ? { "xero-tenant-id": tenantId } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Xero ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return res.json();
}

async function tenantCall(): Promise<XeroCall> {
  const conns = (await rawFetch("/connections")) as { tenantId: string }[];
  if (!conns[0]) throw new Error("No Xero organisation connected");
  const tid = conns[0].tenantId;
  return (path, init) => rawFetch(path, init, tid);
}

/** Supabase-backed store for the pure invoice lifecycle. */
export const dbStore: InvoiceStore = {
  async find(quoteId, part) {
    const { data } = await admin.from("invoices").select("*").eq("quote_id", quoteId).eq("part", part).maybeSingle();
    return (data as unknown as InvoiceRow) ?? null;
  },
  async insert(row) {
    const { data, error } = await admin.from("invoices").insert(row as never).select("*").single();
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return data as unknown as InvoiceRow;
  },
  async update(id, patch) {
    const { error } = await admin.from("invoices").update(patch as never).eq("id", id);
    if (error) throw new Error(error.message);
  },
};

async function syncLog(entityId: string, ok: boolean, payload: unknown, error?: string, direction = "outbound") {
  await admin.from("external_sync_logs").insert({ system: "xero", direction, entity_type: "invoice", entity_id: entityId, status: ok ? "synced" : "error", payload: payload as never, error: error ?? null });
}

async function claimLock(invoiceId: string) {
  const now = new Date();
  const stale = new Date(now.getTime() - LOCK_STALE_MS).toISOString();
  const { data } = await admin.from("invoices").update({ sync_lock_at: now.toISOString() })
    .eq("id", invoiceId).or(`sync_lock_at.is.null,sync_lock_at.lt.${stale}`).select("id");
  return !!data?.length;
}
const releaseLock = (invoiceId: string) => admin.from("invoices").update({ sync_lock_at: null }).eq("id", invoiceId);

const partLabel = (p: InvoicePart) => (p === "deposit" ? "Deposit (50%)" : "Balance (50%)");

/** Owner accepted the final installation quote: create the DEPOSIT invoice (idempotent) and push it to Xero. */
export async function createInvoiceForQuote(quoteId: string, actorId: string) {
  const { data: q } = await admin.from("quotes").select("id, job_id, kind, status, option_label, customer_total_inc_gst").eq("id", quoteId).single();
  if (!q) throw new Error("Quote not found");
  const { row, created } = await ensureDepositInvoice(dbStore, q, melbourneDate(new Date().toISOString()));
  if (created) await logEvent(q.job_id, actorId, "invoice_created_local", `Deposit invoice raised for ${q.option_label}: ${row.amount_inc_gst} inc GST due now (50%)`, { invoice_id: row.id, part: "deposit", total_inc_gst: row.total_inc_gst });
  if (!row.xero_invoice_id) await pushInvoiceToXero(row.id, actorId);
  return row.id;
}

/** Installation booked/rebooked: create or re-date the BALANCE invoice (one per quote). */
export async function scheduleBalanceInvoice(jobId: string, startIso: string, actorId: string, callOverride?: XeroCall) {
  const { data: dep } = await admin.from("invoices").select("*").eq("job_id", jobId).eq("kind", "installation").eq("part", "deposit").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!dep) return;
  const due = melbourneDate(startIso);
  const r = await ensureBalanceInvoice(dbStore, dep as unknown as InvoiceRow, due);
  if (r.created) {
    await logEvent(jobId, actorId, "balance_invoice_created", `Balance invoice raised: ${r.row.amount_inc_gst} inc GST due on installation day (${due})`, { invoice_id: r.row.id, part: "balance" });
    await pushInvoiceToXero(r.row.id, actorId, callOverride);
  } else if (r.dueChanged) {
    await logEvent(jobId, actorId, "balance_due_set", `Balance due date moved to installation day (${due})`, { invoice_id: r.row.id, xero_update_pending: r.row.xero_update_pending });
  } else if (!r.row.xero_invoice_id && r.row.amount_paid < r.row.amount_inc_gst) {
    await pushInvoiceToXero(r.row.id, actorId, callOverride);
  }
}

/** Installation cancelled: the unpaid balance record is kept for the next booking; its due date is cleared locally. */
export async function unscheduleBalanceInvoice(jobId: string, actorId: string) {
  const { data: dep } = await admin.from("invoices").select("quote_id").eq("job_id", jobId).eq("kind", "installation").eq("part", "deposit").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!dep) return;
  const b = await unscheduleBalance(dbStore, dep.quote_id);
  if (b) await logEvent(jobId, actorId, "balance_due_set", "Installation cancelled – balance invoice kept for rebooking; due date cleared", { invoice_id: b.id });
}

export async function pushInvoiceToXero(invoiceId: string, actorId: string | null, callOverride?: XeroCall) {
  const { data: inv } = await admin.from("invoices").select("*, quotes(status, option_label, customer_total_inc_gst, veec_discount_inc_gst, quote_items(description, line_total_inc_gst, sort)), jobs(job_number, owners(id, full_name, email, xero_contact_id))").eq("id", invoiceId).single();
  if (!inv) throw new Error("Invoice not found");
  if (inv.xero_invoice_id) return; // already linked – never create a second Xero invoice
  if (!(await claimLock(invoiceId))) throw new Error("A Xero sync for this invoice is already running – try again shortly.");
  const part = inv.part as InvoicePart;
  const job = inv.jobs as unknown as { job_number: string; owners: { id: string; full_name: string; email: string | null; xero_contact_id: string | null } };
  const quote = inv.quotes as unknown as { status: string; customer_total_inc_gst: number; veec_discount_inc_gst: number; quote_items: { description: string; line_total_inc_gst: number; sort: number }[] };
  try {
    const guard = quoteGuard(quote, inv.total_inc_gst);
    if (guard) throw new Error(guard);
    const dueDate = part === "deposit" ? (inv.deposit_due_date ?? inv.due_date) : inv.due_date;
    if (!dueDate) throw new Error("Balance invoice has no installation date yet – book installation first.");
    const call = callOverride ?? (await tenantCall());
    const reference = xeroReference(job.job_number, part);
    const tracking = await findTrackingOption(call);
    let x = await findInvoiceByReference(call, reference);
    let contactId = x?.Contact?.ContactID ?? job.owners.xero_contact_id;
    if (!x) {
      if (!contactId) contactId = (await findOrCreateContact(call, job.owners)).contactId;
      const items = [...quote.quote_items].sort((a, b) => a.sort - b.sort);
      const payload = buildInvoicePayload({ contactId: contactId!, jobNumber: job.job_number, part, dueDate, total: Number(inv.total_inc_gst), depositAmount: Number(inv.deposit_amount), items, veecDiscount: quote.veec_discount_inc_gst, tracking });
      const res = await call("/api.xro/2.0/Invoices", { method: "POST", headers: { "Idempotency-Key": invoiceIdemKey(invoiceId) }, body: payload });
      x = res.Invoices[0];
    }
    if (contactId && contactId !== job.owners.xero_contact_id) await admin.from("owners").update({ xero_contact_id: contactId }).eq("id", job.owners.id);
    await admin.from("invoices").update({ status: part === "deposit" ? "deposit_due" : "balance_due", xero_contact_id: contactId, xero_invoice_id: x.InvoiceID, xero_invoice_number: x.InvoiceNumber, xero_reference: x.Reference, xero_invoice_status: x.Status ?? null, xero_tracking_option_id: tracking.optionId, last_synced_at: new Date().toISOString(), last_sync_error: null }).eq("id", invoiceId);
    await syncLog(invoiceId, true, { xero_invoice_id: x.InvoiceID, part });
    await logEvent(inv.job_id, actorId, "xero_invoice_created", `Xero ${partLabel(part).toLowerCase()} invoice ${x.InvoiceNumber} linked`, { invoice_id: invoiceId, part });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("invoices").update({ status: "xero_sync_error", last_sync_error: msg, last_synced_at: new Date().toISOString() }).eq("id", invoiceId);
    await syncLog(invoiceId, false, { part }, msg);
    await logEvent(inv.job_id, actorId, "xero_sync_failed", `Xero ${part} invoice sync failed: ${msg}`, { invoice_id: invoiceId }, { internal: true });
  } finally {
    await releaseLock(invoiceId);
  }
}

/** Unified admin sync: push if not yet linked, otherwise pull payment state (and apply a pending due-date update when enabled). */
export async function syncInvoiceFromXero(invoiceId: string, actorId: string | null, callOverride?: XeroCall) {
  const { data: inv } = await admin.from("invoices").select("*").eq("id", invoiceId).single();
  if (!inv) throw new Error("Invoice not found");
  if (!inv.xero_invoice_id) return pushInvoiceToXero(invoiceId, actorId, callOverride);
  if (!(await claimLock(invoiceId))) throw new Error("A Xero sync for this invoice is already running – try again shortly.");
  try {
    const call = callOverride ?? (await tenantCall());
    if (inv.xero_update_pending && inv.due_date && XERO_DUE_DATE_UPDATES_ENABLED) {
      const u = buildDueDateUpdate(inv.xero_invoice_id, inv.due_date, invoiceId);
      await call(u.path, { method: u.method, headers: u.headers, body: u.body });
      await admin.from("invoices").update({ xero_update_pending: false }).eq("id", invoiceId);
      await logEvent(inv.job_id, actorId, "xero_due_date_updated", `Xero due date updated to ${inv.due_date}`, { invoice_id: invoiceId }, { internal: true });
    }
    const r = await call(`/api.xro/2.0/Invoices/${inv.xero_invoice_id}`);
    const x = r.Invoices[0] ?? {};
    const ev = evaluateXeroInvoice(x, Number(inv.amount_inc_gst));
    if (ev.voided) {
      const msg = `Xero ${inv.part} invoice is ${x.Status} – payment not confirmed; admin must re-issue${inv.part === "deposit" ? " or override with reason" : ""}.`;
      await admin.from("invoices").update({ status: "xero_sync_error", xero_invoice_status: x.Status, last_sync_error: msg, last_synced_at: new Date().toISOString() }).eq("id", invoiceId);
      await syncLog(invoiceId, false, { status: x.Status }, msg, "inbound");
      await logEvent(inv.job_id, actorId, "xero_invoice_voided", msg, { invoice_id: invoiceId }, { internal: true });
      return;
    }
    await applyPaidAmount(invoiceId, ev.paid, actorId, ev.depositPaidAt);
    await admin.from("invoices").update({ xero_invoice_status: x.Status ?? null, xero_online_url: x.OnlineInvoiceUrl ?? inv.xero_online_url, last_synced_at: new Date().toISOString(), last_sync_error: null }).eq("id", invoiceId);
    await syncLog(invoiceId, true, { amount_paid: ev.paid, part: inv.part }, undefined, "inbound");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("invoices").update({ last_sync_error: msg, last_synced_at: new Date().toISOString() }).eq("id", invoiceId);
    await syncLog(invoiceId, false, null, msg, "inbound");
    await logEvent(inv.job_id, actorId, "xero_sync_failed", `Xero payment sync failed: ${msg}`, { invoice_id: invoiceId }, { internal: true });
  } finally {
    await releaseLock(invoiceId);
  }
}

/** Single place that turns a Xero paid amount into invoice state + audit events. */
export async function applyPaidAmount(invoiceId: string, paid: number, actorId: string | null, paidAt?: string | null) {
  const { data: inv } = await admin.from("invoices").select("*").eq("id", invoiceId).single();
  if (!inv) return;
  const { patch, events } = paymentPatch(inv as unknown as InvoiceRow, paid, paidAt ?? null, new Date().toISOString());
  await admin.from("invoices").update(patch as never).eq("id", invoiceId);
  for (const e of events) {
    if (e === "deposit_paid") await logEvent(inv.job_id, actorId, "deposit_paid", `50% deposit paid in full (${inv.amount_inc_gst} inc GST)`, { invoice_id: invoiceId });
    if (e === "balance_paid") await logEvent(inv.job_id, actorId, "balance_paid", `Balance paid in full (${inv.amount_inc_gst} inc GST) – job fully paid`, { invoice_id: invoiceId });
  }
}
