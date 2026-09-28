// Xero integration boundary. Xero is the system of record for invoices & payments;
// the portal mirrors state and enforces gates. Failures are recorded as sync errors (admin-only).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  buildInvoicePayload, evaluateXeroInvoice, findInvoiceByReference, findOrCreateContact, findTrackingOption,
  invoiceIdemKey, LOCK_STALE_MS, quoteGuard, r2, xeroReference, type XeroCall,
} from "./xero.core";

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

async function syncLog(entityId: string, ok: boolean, payload: unknown, error?: string, direction = "outbound") {
  await admin.from("external_sync_logs").insert({ system: "xero", direction, entity_type: "invoice", entity_id: entityId, status: ok ? "synced" : "error", payload: payload as never, error: error ?? null });
}

/** Claim the per-invoice sync lock; false if another sync is running. */
async function claimLock(invoiceId: string) {
  const now = new Date();
  const stale = new Date(now.getTime() - LOCK_STALE_MS).toISOString();
  const { data } = await admin.from("invoices").update({ sync_lock_at: now.toISOString() })
    .eq("id", invoiceId).or(`sync_lock_at.is.null,sync_lock_at.lt.${stale}`).select("id");
  return !!data?.length;
}
const releaseLock = (invoiceId: string) => admin.from("invoices").update({ sync_lock_at: null }).eq("id", invoiceId);

/** Called when an owner accepts a quote. Creates the local invoice (one per quote) + pushes to Xero. */
export async function createInvoiceForQuote(quoteId: string, actorId: string) {
  const { data: existing } = await admin.from("invoices").select("id").eq("quote_id", quoteId).maybeSingle();
  if (existing) { await pushInvoiceToXero(existing.id, actorId); return existing.id; }
  const { data: q } = await admin.from("quotes").select("*").eq("id", quoteId).single();
  if (!q) throw new Error("Quote not found");
  const total = Number(q.customer_total_inc_gst);
  const deposit = r2(total * 0.5);
  const { data: inv, error } = await admin
    .from("invoices")
    .insert({ job_id: q.job_id, quote_id: q.id, kind: q.kind, status: "invoice_not_created", total_inc_gst: total, deposit_amount: deposit, balance_amount: r2(total - deposit) })
    .select("id")
    .single();
  if (error || !inv) throw new Error(error?.message);
  await logEvent(q.job_id, actorId, "invoice_created_local", `Invoice raised for ${q.option_label}: deposit ${deposit} due now (50%)`, { invoice_id: inv.id, total_inc_gst: total });
  await pushInvoiceToXero(inv.id, actorId);
  return inv.id;
}

export async function pushInvoiceToXero(invoiceId: string, actorId: string | null, callOverride?: XeroCall) {
  const { data: inv } = await admin.from("invoices").select("*, quotes(status, option_label, customer_total_inc_gst, veec_discount_inc_gst, quote_items(description, quantity, unit_price_inc_gst, sort)), jobs(job_number, owners(id, full_name, email, xero_contact_id))").eq("id", invoiceId).single();
  if (!inv) throw new Error("Invoice not found");
  if (inv.xero_invoice_id) return; // already linked – never create a second Xero invoice
  if (!(await claimLock(invoiceId))) throw new Error("A Xero sync for this invoice is already running – try again shortly.");
  const job = inv.jobs as unknown as { job_number: string; owners: { id: string; full_name: string; email: string | null; xero_contact_id: string | null } };
  const quote = inv.quotes as unknown as { status: string; option_label: string; customer_total_inc_gst: number; veec_discount_inc_gst: number; quote_items: { description: string; quantity: number; unit_price_inc_gst: number; sort: number }[] };
  try {
    const guard = quoteGuard(quote, inv.total_inc_gst);
    if (guard) throw new Error(guard);
    const call = callOverride ?? (await tenantCall());
    const reference = xeroReference(job.job_number);
    const tracking = await findTrackingOption(call);
    let x = await findInvoiceByReference(call, reference);
    let contactId = x?.Contact?.ContactID ?? job.owners.xero_contact_id;
    if (!x) {
      if (!contactId) contactId = (await findOrCreateContact(call, job.owners)).contactId;
      const items = [...quote.quote_items].sort((a, b) => a.sort - b.sort);
      const payload = buildInvoicePayload({ contactId: contactId!, jobNumber: job.job_number, dueDate: inv.deposit_due_date, items, veecDiscount: quote.veec_discount_inc_gst, tracking });
      const res = await call("/api.xro/2.0/Invoices", { method: "POST", headers: { "Idempotency-Key": invoiceIdemKey(invoiceId) }, body: payload });
      x = res.Invoices[0];
    }
    if (contactId && contactId !== job.owners.xero_contact_id) await admin.from("owners").update({ xero_contact_id: contactId }).eq("id", job.owners.id);
    await admin.from("invoices").update({ status: "deposit_due", xero_contact_id: contactId, xero_invoice_id: x.InvoiceID, xero_invoice_number: x.InvoiceNumber, xero_reference: x.Reference, xero_invoice_status: x.Status ?? null, xero_tracking_option_id: tracking.optionId, last_synced_at: new Date().toISOString(), last_sync_error: null }).eq("id", invoiceId);
    await syncLog(invoiceId, true, { xero_invoice_id: x.InvoiceID });
    await logEvent(inv.job_id, actorId, "xero_invoice_created", `Xero invoice ${x.InvoiceNumber} linked – deposit due`, { invoice_id: invoiceId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("invoices").update({ status: "xero_sync_error", last_sync_error: msg, last_synced_at: new Date().toISOString() }).eq("id", invoiceId);
    await syncLog(invoiceId, false, null, msg);
    await logEvent(inv.job_id, actorId, "xero_sync_failed", `Xero invoice sync failed: ${msg}`, { invoice_id: invoiceId }, { internal: true });
  } finally {
    await releaseLock(invoiceId);
  }
}

/** Unified admin sync: push if not yet linked, otherwise pull payment state from Xero. */
export async function syncInvoiceFromXero(invoiceId: string, actorId: string | null, callOverride?: XeroCall) {
  const { data: inv } = await admin.from("invoices").select("*").eq("id", invoiceId).single();
  if (!inv) throw new Error("Invoice not found");
  if (!inv.xero_invoice_id) return pushInvoiceToXero(invoiceId, actorId, callOverride);
  if (!(await claimLock(invoiceId))) throw new Error("A Xero sync for this invoice is already running – try again shortly.");
  try {
    const call = callOverride ?? (await tenantCall());
    const r = await call(`/api.xro/2.0/Invoices/${inv.xero_invoice_id}`);
    const x = r.Invoices[0] ?? {};
    const ev = evaluateXeroInvoice(x, Number(inv.deposit_amount));
    if (ev.voided) {
      const msg = `Xero invoice is ${x.Status} – deposit not confirmed; admin must re-issue or override with reason.`;
      await admin.from("invoices").update({ status: "xero_sync_error", xero_invoice_status: x.Status, last_sync_error: msg, last_synced_at: new Date().toISOString() }).eq("id", invoiceId);
      await syncLog(invoiceId, false, { status: x.Status }, msg, "inbound");
      await logEvent(inv.job_id, actorId, "xero_invoice_voided", msg, { invoice_id: invoiceId }, { internal: true });
      return;
    }
    await applyPaidAmount(invoiceId, ev.paid, actorId, ev.depositPaidAt);
    await admin.from("invoices").update({ xero_invoice_status: x.Status ?? null, xero_online_url: x.OnlineInvoiceUrl ?? inv.xero_online_url, last_synced_at: new Date().toISOString(), last_sync_error: null }).eq("id", invoiceId);
    await syncLog(invoiceId, true, { amount_paid: ev.paid }, undefined, "inbound");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("invoices").update({ last_sync_error: msg, last_synced_at: new Date().toISOString() }).eq("id", invoiceId);
    await syncLog(invoiceId, false, null, msg, "inbound");
    await logEvent(inv.job_id, actorId, "xero_sync_failed", `Xero payment sync failed: ${msg}`, { invoice_id: invoiceId }, { internal: true });
  } finally {
    await releaseLock(invoiceId);
  }
}

/** Single place that turns a paid amount into deposit/balance state + audit events. */
export async function applyPaidAmount(invoiceId: string, paid: number, actorId: string | null, depositPaidAt?: string | null) {
  const { data: inv } = await admin.from("invoices").select("*").eq("id", invoiceId).single();
  if (!inv) return;
  const patch: Record<string, unknown> = { total_paid: paid };
  if (!inv.deposit_paid_at && paid >= Number(inv.deposit_amount)) {
    patch["deposit_paid_at"] = depositPaidAt ?? new Date().toISOString();
    patch["deposit_paid_amount"] = Math.min(paid, Number(inv.deposit_amount));
    patch["status"] = "deposit_paid";
    await logEvent(inv.job_id, actorId, "deposit_paid", `50% deposit paid (${inv.deposit_amount} inc GST)`, { invoice_id: invoiceId });
  }
  if (paid >= Number(inv.total_inc_gst) && inv.status !== "fully_paid") {
    patch["status"] = "fully_paid";
    patch["balance_paid_at"] = new Date().toISOString();
    await logEvent(inv.job_id, actorId, "balance_paid", "Balance paid – invoice fully paid", { invoice_id: invoiceId });
  }
  await admin.from("invoices").update(patch as never).eq("id", invoiceId);
}

/** Recompute the recorded balance due date from the current confirmed installation booking (Melbourne date). */
export async function refreshBalanceDueDate(jobId: string, actorId: string | null) {
  const { melbourneDate } = await import("./xero.core");
  const { data: inv } = await admin.from("invoices").select("id, balance_due_date").eq("job_id", jobId).eq("kind", "installation").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!inv) return;
  const { data: b } = await admin.from("bookings").select("scheduled_start").eq("job_id", jobId).eq("kind", "installation").eq("status", "confirmed").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const due = b ? melbourneDate(b.scheduled_start) : null;
  if (due === inv.balance_due_date) return;
  await admin.from("invoices").update({ balance_due_date: due }).eq("id", inv.id);
  await logEvent(jobId, actorId, "balance_due_set", due ? `Remaining 50% balance due on installation day (${due})` : "Installation booking cancelled – balance due date cleared", { invoice_id: inv.id });
}
