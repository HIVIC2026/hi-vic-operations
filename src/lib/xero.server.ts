// Xero integration boundary. Xero is the system of record for invoices & payments;
// the portal mirrors state and enforces gates. When the Xero connector is not linked,
// invoices are recorded locally with a sync error so admins can see and retry.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";

const GATEWAY = "https://connector-gateway.lovable.dev/xero";
const r2 = (n: number) => Math.round(n * 100) / 100;

function creds() {
  const lovable = process.env["LOVABLE_API_KEY"];
  const xero = process.env["XERO_API_KEY"];
  return lovable && xero ? { lovable, xero } : null;
}

async function xeroFetch(path: string, init: RequestInit = {}, tenantId?: string) {
  const c = creds();
  if (!c) throw new Error("Xero is not connected");
  const res = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${c.lovable}`,
      "X-Connection-Api-Key": c.xero,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(tenantId ? { "xero-tenant-id": tenantId } : {}),
    },
  });
  if (!res.ok) throw new Error(`Xero ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return res.json();
}

async function tenant() {
  const conns = (await xeroFetch("/connections")) as { tenantId: string }[];
  if (!conns[0]) throw new Error("No Xero organisation connected");
  return conns[0].tenantId;
}

async function syncLog(entityId: string, ok: boolean, payload: unknown, error?: string) {
  await admin.from("external_sync_logs").insert({ system: "xero", direction: "outbound", entity_type: "invoice", entity_id: entityId, status: ok ? "synced" : "error", payload: payload as never, error: error ?? null });
}

/** Called when an owner accepts a quote. Creates the local invoice + pushes to Xero. */
export async function createInvoiceForQuote(quoteId: string, actorId: string) {
  const { data: q } = await admin.from("quotes").select("*, quote_items(*), jobs(job_number, owner_id, owners(full_name, email, phone, xero_contact_id))").eq("id", quoteId).single();
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

export async function pushInvoiceToXero(invoiceId: string, actorId: string | null) {
  const { data: inv } = await admin.from("invoices").select("*, quotes(option_label, veec_discount_inc_gst, quote_items(*)), jobs(job_number, owners(id, full_name, email, phone, xero_contact_id))").eq("id", invoiceId).single();
  if (!inv) throw new Error("Invoice not found");
  const job = inv.jobs as unknown as { job_number: string; owners: { id: string; full_name: string; email: string | null; phone: string | null; xero_contact_id: string | null } };
  try {
    const tid = await tenant();
    let contactId = job.owners.xero_contact_id;
    if (!contactId) {
      const c = (await xeroFetch("/api.xro/2.0/Contacts", { method: "POST", body: JSON.stringify({ Contacts: [{ Name: `${job.owners.full_name} (${job.job_number})`, EmailAddress: job.owners.email ?? undefined }] }) }, tid)) as { Contacts: { ContactID: string }[] };
      contactId = c.Contacts[0]!.ContactID;
      await admin.from("owners").update({ xero_contact_id: contactId }).eq("id", job.owners.id);
    }
    const quote = inv.quotes as unknown as { option_label: string; veec_discount_inc_gst: number; quote_items: { description: string; quantity: number; unit_price_inc_gst: number }[] };
    const lines = quote.quote_items.map((i) => ({ Description: i.description, Quantity: Number(i.quantity), UnitAmount: Number(i.unit_price_inc_gst), AccountCode: "200" }));
    if (Number(quote.veec_discount_inc_gst) > 0) lines.push({ Description: "VEEC discount", Quantity: 1, UnitAmount: -Number(quote.veec_discount_inc_gst), AccountCode: "200" });
    const res = (await xeroFetch("/api.xro/2.0/Invoices", { method: "POST", body: JSON.stringify({ Invoices: [{ Type: "ACCREC", Contact: { ContactID: contactId }, LineAmountTypes: "Inclusive", Reference: `${job.job_number} ${quote.option_label}`, DueDate: inv.deposit_due_date, Status: "AUTHORISED", LineItems: lines }] }) }, tid)) as { Invoices: { InvoiceID: string; InvoiceNumber: string; Reference: string }[] };
    const x = res.Invoices[0]!;
    await admin.from("invoices").update({ status: "deposit_due", xero_contact_id: contactId, xero_invoice_id: x.InvoiceID, xero_invoice_number: x.InvoiceNumber, xero_reference: x.Reference, last_synced_at: new Date().toISOString(), last_sync_error: null }).eq("id", invoiceId);
    await syncLog(invoiceId, true, { xero_invoice_id: x.InvoiceID });
    await logEvent(inv.job_id, actorId, "xero_invoice_created", `Xero invoice ${x.InvoiceNumber} created – deposit due`, { invoice_id: invoiceId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("invoices").update({ status: "xero_sync_error", last_sync_error: msg, last_synced_at: new Date().toISOString() }).eq("id", invoiceId);
    await syncLog(invoiceId, false, null, msg);
    await logEvent(inv.job_id, actorId, "xero_sync_failed", `Xero invoice sync failed: ${msg}`, { invoice_id: invoiceId }, { internal: true });
  }
}

/** Pull payment state from Xero and apply deposit/balance events. */
export async function syncInvoiceFromXero(invoiceId: string, actorId: string | null) {
  const { data: inv } = await admin.from("invoices").select("*").eq("id", invoiceId).single();
  if (!inv) throw new Error("Invoice not found");
  if (!inv.xero_invoice_id) return pushInvoiceToXero(invoiceId, actorId);
  try {
    const tid = await tenant();
    const r = (await xeroFetch(`/api.xro/2.0/Invoices/${inv.xero_invoice_id}`, {}, tid)) as { Invoices: { AmountPaid: number; Status?: string; OnlineInvoiceUrl?: string }[] };
    await applyPaidAmount(invoiceId, Number(r.Invoices[0]?.AmountPaid ?? 0), actorId);
    await admin.from("invoices").update({ xero_invoice_status: r.Invoices[0]?.Status ?? null, last_synced_at: new Date().toISOString(), last_sync_error: null }).eq("id", invoiceId);
    await syncLog(invoiceId, true, { direction: "inbound", amount_paid: r.Invoices[0]?.AmountPaid });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("invoices").update({ last_sync_error: msg, last_synced_at: new Date().toISOString() }).eq("id", invoiceId);
    await syncLog(invoiceId, false, null, msg);
    await logEvent(inv.job_id, actorId, "xero_sync_failed", `Xero payment sync failed: ${msg}`, { invoice_id: invoiceId }, { internal: true });
  }
}

/** Single place that turns a paid amount into deposit/balance state + audit events. */
export async function applyPaidAmount(invoiceId: string, paid: number, actorId: string | null) {
  const { data: inv } = await admin.from("invoices").select("*").eq("id", invoiceId).single();
  if (!inv) return;
  const patch: Record<string, unknown> = { total_paid: paid };
  if (!inv.deposit_paid_at && paid >= Number(inv.deposit_amount)) {
    patch["deposit_paid_at"] = new Date().toISOString();
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
