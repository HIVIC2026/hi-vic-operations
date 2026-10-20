// Xero integration boundary – ONE full invoice per accepted quote. The configured minimum deposit is requested with Xero's native
// "Request Deposit" (raised manually by an admin, recorded in the portal) and confirmed only by Xero AmountPaid (gate: evaluatePaymentGate).
// Xero is the system of record; the portal mirrors state and enforces gates.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  assertHivicInvoice, assertHivicJob, assertHivicPayload, assertHivicReference, buildDueDateUpdate, buildInvoicePayload, evaluateXeroInvoice, findInvoiceByReference, findOrCreateContact, findTrackingOption,
  invoiceIdemKey, LOCK_STALE_MS, pickXeroTenant, describeXeroRouting, type XeroMode, type XeroTenant, melbourneDate, quoteGuard, XERO_DUE_DATE_UPDATES_ENABLED, xeroReference, type XeroCall,
} from "./xero.core";
import { clearInstallDueDatePatch, ensureInvoice, installDueDatePatch, paymentPatch, xeroDueDate, type InvoiceRow, type InvoiceStore } from "./invoice.lifecycle";
import { XERO_FETCH_TIMEOUT_MS, timeoutSignal } from "./network-timeout.core";

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
    signal: timeoutSignal(XERO_FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Xero ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return res.json();
}

async function tenantCall(mode: XeroMode): Promise<XeroCall> {
  const conns = (await rawFetch("/connections")) as XeroTenant[];
  const tid = pickXeroTenant(conns, mode).tenantId;
  return (path, init) => rawFetch(path, init, tid);
}

/** Which Xero organisations are reachable, for the office settings display. Never returns tokens. */
export async function xeroConnectionStatus() {
  const checkedAt = new Date().toISOString();
  if (!creds()) return { configured: false, connected: false, checkedAt, routing: describeXeroRouting([]), orgs: [] as { name: string; test: boolean }[] };
  const result: unknown = await rawFetch("/connections");
  if (!Array.isArray(result) || result.some(c => !c || typeof c.tenantId !== "string" || !c.tenantId || (c.tenantName != null && typeof c.tenantName !== "string")))
    throw new Error("Xero returned an unreadable organisation list.");
  const conns = result as XeroTenant[];
  return { configured: true, connected: conns.length > 0, checkedAt, routing: describeXeroRouting(conns), orgs: conns.map((c) => ({ name: c.tenantName ?? "Unnamed organisation", test: /demo company/i.test(c.tenantName ?? "") })) };
}

async function modeForInvoice(invoiceId: string): Promise<XeroMode> {
  const { data } = await admin.from("invoices").select("jobs(source)").eq("id", invoiceId).maybeSingle();
  return (data?.jobs as { source: string | null } | null)?.source === "qa_test" ? "test" : "live";
}

/** TEST only: record a payment against a qa_test invoice in the Xero Demo Company, then read paid status back. */
export async function recordDemoTestPayment(invoiceId: string, amount: number, actorId: string) {
  if ((await modeForInvoice(invoiceId)) !== "test") throw new Error("Test payments are only allowed on TEST jobs.");
  const { data: inv } = await admin.from("invoices").select("job_id, xero_invoice_id").eq("id", invoiceId).single();
  if (!inv?.xero_invoice_id) throw new Error("Create the Demo Company invoice first.");
  const call = await tenantCall("test");
  const acc = await call(`/api.xro/2.0/Accounts?where=${encodeURIComponent('Type=="BANK"')}`);
  const bank = acc.Accounts?.[0];
  if (!bank) throw new Error("Demo Company has no bank account to record the payment against.");
  await call("/api.xro/2.0/Payments", { method: "PUT", body: { Invoice: { InvoiceID: inv.xero_invoice_id }, Account: { AccountID: bank.AccountID }, Amount: amount, Date: melbourneDate(new Date().toISOString()), Reference: "TEST payment" } });
  await logEvent(inv.job_id, actorId, "xero_test_payment", `TEST payment of ${amount} recorded in Xero Demo Company`, { invoice_id: invoiceId, amount }, { internal: true });
  await syncInvoiceFromXero(invoiceId, actorId);
}

/** Supabase-backed store for the pure invoice lifecycle. */
export const dbStore: InvoiceStore = {
  async find(quoteId) {
    const { data } = await admin.from("invoices").select("*").eq("quote_id", quoteId).maybeSingle();
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

/** Deepest barrier: load the job behind an invoice and require business_unit = 'hivic'. */
export async function loadJobForInvoice(invoiceId: string) {
  const { data } = await admin.from("invoices").select("jobs(business_unit)").eq("id", invoiceId).maybeSingle();
  return (data?.jobs as unknown as { business_unit: string | null } | null) ?? null;
}
export async function requireHivicInvoice(invoiceId: string) {
  const { data } = await admin.from("invoices").select("jobs(business_unit, source)").eq("id", invoiceId).maybeSingle();
  const job = data?.jobs as { business_unit: string | null; source: string | null } | null;
  return assertHivicInvoice(invoiceId, async () => job);
}
export async function requireHivicJob(jobId: string) {
  const { data } = await admin.from("jobs").select("business_unit, source").eq("id", jobId).maybeSingle();
  assertHivicJob(data);
}

async function jobInvoice(jobId: string) {
  const { data } = await admin.from("invoices").select("*").eq("job_id", jobId).eq("kind", "installation").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as unknown as InvoiceRow) ?? null;
}

/** Owner accepted the final installation quote: create the ONE full invoice (idempotent) and push it to Xero. */
export async function createInvoiceForQuote(quoteId: string, actorId: string) {
  const { data: q } = await admin.from("quotes").select("id, job_id, kind, status, option_label, customer_total_inc_gst").eq("id", quoteId).single();
  if (!q) throw new Error("Quote not found");
  await requireHivicJob(q.job_id);
  const { row, created } = await ensureInvoice(dbStore, q, melbourneDate(new Date().toISOString()));
  if (created) await logEvent(q.job_id, actorId, "invoice_created_local", `Invoice raised for ${q.option_label}: ${row.total_inc_gst} inc GST. Minimum deposit (${row.deposit_amount}) must be requested in Xero.`, { invoice_id: row.id, total_inc_gst: row.total_inc_gst });
  if (!row.xero_invoice_id) await pushInvoiceToXero(row.id, actorId);
  return row.id;
}

/** Installation booked/rebooked: the same invoice's final due date = Melbourne-local installation date. */
export { setInstallDueDate } from "./invoice-dates.server";

export async function pushInvoiceToXero(invoiceId: string, actorId: string | null, callOverride?: XeroCall) {
  await requireHivicInvoice(invoiceId); // before any lookup, lock or Xero call
  const { data: inv } = await admin.from("invoices").select("*, quotes(status, customer_total_inc_gst, veec_discount_inc_gst, quote_items(description, quantity, unit_price_inc_gst, line_total_inc_gst, sort)), jobs(job_number, owners(id, full_name, email, xero_contact_id))").eq("id", invoiceId).single();
  if (!inv) throw new Error("Invoice not found");
  if (inv.xero_invoice_id) return; // already linked – never create a second Xero invoice
  if (!(await claimLock(invoiceId))) throw new Error("A Xero sync for this invoice is already running – try again shortly.");
  const job = inv.jobs as unknown as { job_number: string; owners: { id: string; full_name: string; email: string | null; xero_contact_id: string | null } };
  const quote = inv.quotes as unknown as { status: string; customer_total_inc_gst: number; veec_discount_inc_gst: number; quote_items: { description: string; quantity: number; unit_price_inc_gst: number; line_total_inc_gst: number; sort: number }[] };
  try {
    const guard = quoteGuard(quote, inv.total_inc_gst);
    if (guard) throw new Error(guard);
    const dueDate = xeroDueDate(inv as unknown as InvoiceRow);
    if (!dueDate) throw new Error("Invoice has no due date.");
    const mode = await modeForInvoice(invoiceId);
    const call = callOverride ?? (await tenantCall(mode));
    const reference = xeroReference(job.job_number);
    const tracking = await findTrackingOption(call, mode);
    let x = await findInvoiceByReference(call, reference);
    let contactId = x?.Contact?.ContactID ?? job.owners.xero_contact_id;
    if (!x) {
      if (!contactId) contactId = (await findOrCreateContact(call, job.owners)).contactId;
      const items = [...quote.quote_items].sort((a, b) => a.sort - b.sort);
      const payload = buildInvoicePayload({ contactId: contactId!, jobNumber: job.job_number, dueDate, total: Number(inv.total_inc_gst), items, veecDiscount: quote.veec_discount_inc_gst, tracking });
      assertHivicPayload(payload, mode);
      const res = await call("/api.xro/2.0/Invoices", { method: "POST", headers: { "Idempotency-Key": invoiceIdemKey(invoiceId) }, body: payload });
      x = res.Invoices[0];
    }
    if (contactId && contactId !== job.owners.xero_contact_id) await admin.from("owners").update({ xero_contact_id: contactId }).eq("id", job.owners.id);
    const { error: linkErr } = await admin.from("invoices").update({ status: "deposit_due", xero_contact_id: contactId, xero_invoice_id: x.InvoiceID, xero_invoice_number: x.InvoiceNumber, xero_reference: x.Reference, xero_invoice_status: x.Status ?? null, xero_tracking_option_id: tracking?.optionId ?? null, xero_update_pending: false, last_synced_at: new Date().toISOString(), last_sync_error: null }).eq("id", invoiceId);
    if (linkErr) throw new Error(`Xero invoice ${x.InvoiceNumber} exists but could not be linked locally: ${linkErr.message}`);
    await syncLog(invoiceId, true, { xero_invoice_id: x.InvoiceID });
    await logEvent(inv.job_id, actorId, "xero_invoice_created", `Xero invoice ${x.InvoiceNumber} linked – raise the deposit request in Xero`, { invoice_id: invoiceId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("invoices").update({ status: "xero_sync_error", last_sync_error: msg, last_synced_at: new Date().toISOString() }).eq("id", invoiceId);
    await syncLog(invoiceId, false, null, msg);
    await logEvent(inv.job_id, actorId, "xero_sync_failed", `Xero invoice sync failed: ${msg}`, { invoice_id: invoiceId }, { internal: true });
  } finally {
    await releaseLock(invoiceId);
  }
}

/** Unified admin sync: push if not yet linked, otherwise pull payment state (and apply a pending due-date update when enabled). */
export async function syncInvoiceFromXero(invoiceId: string, actorId: string | null, callOverride?: XeroCall) {
  await requireHivicInvoice(invoiceId);
  const { data: inv } = await admin.from("invoices").select("*").eq("id", invoiceId).single();
  if (!inv) throw new Error("Invoice not found");
  if (!inv.xero_invoice_id) return pushInvoiceToXero(invoiceId, actorId, callOverride);
  if (!(await claimLock(invoiceId))) throw new Error("A Xero sync for this invoice is already running – try again shortly.");
  try {
    const call = callOverride ?? (await tenantCall(await modeForInvoice(invoiceId)));
    if (inv.xero_update_pending && inv.balance_due_date && XERO_DUE_DATE_UPDATES_ENABLED) {
      assertHivicReference(inv.xero_reference);
      const u = buildDueDateUpdate(inv.xero_invoice_id, inv.balance_due_date, invoiceId);
      await call(u.path, { method: u.method, headers: u.headers, body: u.body });
      await admin.from("invoices").update({ xero_update_pending: false }).eq("id", invoiceId);
      await logEvent(inv.job_id, actorId, "xero_due_date_updated", `Xero due date updated to ${inv.balance_due_date}`, { invoice_id: invoiceId }, { internal: true });
    }
    const r = await call(`/api.xro/2.0/Invoices/${inv.xero_invoice_id}`);
    const x = r.Invoices[0] ?? {};
    const ev = evaluateXeroInvoice(x, Number(inv.deposit_amount));
    if (ev.voided) {
      const msg = `Xero invoice is ${x.Status} – payment not confirmed; admin must re-issue or override with reason.`;
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

/** Single place that turns Xero's cumulative AmountPaid into deposit/balance state + audit events. */
export async function applyPaidAmount(invoiceId: string, paid: number, actorId: string | null, depositReachedAt?: string | null) {
  await requireHivicInvoice(invoiceId);
  const { data: inv } = await admin.from("invoices").select("*").eq("id", invoiceId).single();
  if (!inv) return;
  const { patch, events } = paymentPatch(inv as unknown as InvoiceRow, paid, depositReachedAt ?? null, new Date().toISOString());
  await admin.from("invoices").update(patch as never).eq("id", invoiceId);
  if (events.includes("deposit_paid")) await logEvent(inv.job_id, actorId, "deposit_paid", `Minimum deposit confirmed paid in Xero (${inv.deposit_amount} of ${inv.total_inc_gst} inc GST)`, { invoice_id: invoiceId, amount_paid: paid });
  if (events.includes("balance_paid")) await logEvent(inv.job_id, actorId, "balance_paid", "Invoice fully paid in Xero", { invoice_id: invoiceId });
}

/** Admin-controlled, idempotent supplier contact setup for an approved partner business. */
export async function syncSupplierContact(businessId: string, callOverride?: XeroCall) {
  const { data: b } = await admin.from("businesses").select("id, name, legal_name, email, onboarding_status, xero_contact_id").eq("id", businessId).single();
  if (!b) throw new Error("Business not found");
  if (b.onboarding_status !== "approved") throw new Error("Only approved partner businesses can be set up as Xero suppliers.");
  if (b.xero_contact_id) return { contactId: b.xero_contact_id, created: false };
  try {
    const call = callOverride ?? (await tenantCall("live"));
    const r = await findOrCreateContact(call, { id: `supplier-${b.id}`, full_name: b.legal_name || b.name, email: b.email });
    await admin.from("businesses").update({ xero_contact_id: r.contactId, xero_contact_status: "synced", xero_contact_error: null, xero_contact_synced_at: new Date().toISOString() }).eq("id", b.id);
    return r;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("businesses").update({ xero_contact_status: "error", xero_contact_error: msg.slice(0, 500) }).eq("id", b.id);
    throw e;
  }
}
