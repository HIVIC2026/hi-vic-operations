// Xero integration boundary – ONE full invoice per accepted quote: the installation invoice (safety check, 10% install deposit,
// balance) and, batch 3b, a separate fixes invoice per accepted fixes quote. Payments are confirmed only by Xero payments and the card ledger.
// Xero is the system of record; the portal mirrors state and enforces gates.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  assertHivicInvoice, assertHivicJob, assertHivicPayload, assertHivicReference, buildDueDateUpdate, buildInvoicePayload, evaluateXeroInvoice, findInvoiceByReference, findOrCreateContact, findTrackingOption,
  invoiceIdemKey, LOCK_STALE_MS, pickXeroTenant, describeXeroRouting, type XeroMode, type XeroTenant, melbourneDate, quoteGuard, XERO_DUE_DATE_UPDATES_ENABLED, xeroReference, type XeroCall,
} from "./xero.core";
import { clearInstallDueDatePatch, ensureInvoice, installDueDatePatch, paymentPatch, xeroDueDate, type InvoiceRow, type InvoiceStore } from "./invoice.lifecycle";
import { XERO_FETCH_TIMEOUT_MS, timeoutSignal } from "./network-timeout.core";
import type { XeroPaymentInput } from "./payments.core";
import { xeroPaymentsListComplete } from "./payments.core";

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
  // Fails closed: a failed or empty job-source read never routes to the real books.
  const { data, error } = await admin.from("invoices").select("jobs(source)").eq("id", invoiceId).maybeSingle();
  const job = data?.jobs as { source: string | null } | null | undefined;
  if (error || !job) throw new Error(`Xero: could not read this invoice's job (${error?.message ?? "not found"}) – nothing sent to Xero.`);
  return job.source === "qa_test" ? "test" : "live";
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

/** TEST journeys only (Jo 27 Oct, Phase 3 path 3): delete the newest "TEST payment" on a TEST job's Demo Company invoice,
 *  as a person reversing it in Xero would, then read the invoice back through the normal sync (ledger reversal row). */
export async function reverseDemoTestPayment(invoiceId: string, actorId: string) {
  if ((await modeForInvoice(invoiceId)) !== "test") throw new Error("Test payment reversals are only allowed on TEST jobs.");
  const { data: inv } = await admin.from("invoices").select("job_id, xero_invoice_id").eq("id", invoiceId).single();
  if (!inv?.xero_invoice_id) throw new Error("No Demo Company invoice.");
  const call = await tenantCall("test");
  const got = await call(`/api.xro/2.0/Invoices/${encodeURIComponent(inv.xero_invoice_id)}`);
  const pays = ((got.Invoices?.[0]?.Payments ?? []) as { PaymentID?: string; Reference?: string; Status?: string }[]).filter((p) => p.PaymentID && String(p.Status ?? "AUTHORISED").toUpperCase() !== "DELETED");
  const last = pays.filter((p) => (p.Reference ?? "") === "TEST payment").at(-1) ?? pays.at(-1);
  if (!last?.PaymentID) throw new Error("No Demo Company payment to reverse.");
  await call(`/api.xro/2.0/Payments/${encodeURIComponent(last.PaymentID)}`, { method: "POST", body: { Status: "DELETED" } });
  await logEvent(inv.job_id, actorId, "xero_test_payment_reversed", "TEST payment deleted in Xero Demo Company", { invoice_id: invoiceId, xero_payment_id: last.PaymentID }, { internal: true });
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

/** Owner accepted a quote: create its ONE invoice (idempotent, one per quote) and push it to Xero. Installation quote →
 *  the installation invoice; accepted electrical fixes quote (batch 3b) → its own fixes invoice, paid in full, reference
 *  "Home Insulation Victoria <job> fixes". The installation invoice is never touched by a fixes quote. */
export async function createInvoiceForQuote(quoteId: string, actorId: string | null) {
  const { data: q } = await admin.from("quotes").select("id, job_id, kind, status, option_label, customer_total_inc_gst").eq("id", quoteId).single();
  if (!q) throw new Error("Quote not found");
  if (q.kind !== "installation" && q.kind !== "rectification") throw new Error(`A ${q.kind} quote has no invoice of its own.`);
  await requireHivicJob(q.job_id);
  const fixes = q.kind === "rectification";
  // Decision 302: the Xero deposit = the accepted quote's PIESA line ($349 for our electrician, the REC's onboarded rate otherwise).
  // A fixes invoice is paid in full before the fixes visit, so its upfront amount is its whole total.
  const upfront = fixes ? Number(q.customer_total_inc_gst) : (await (await import("./safety-check-amount.server")).quoteSafetyCheck(q.id)).incGst;
  const { row, created } = await ensureInvoice(dbStore, q, melbourneDate(new Date().toISOString()), upfront);
  if (created && fixes) await logEvent(q.job_id, actorId, "invoice_created_local", `Electrical fixes invoice raised for ${q.option_label}: ${row.total_inc_gst} inc GST – owner pays it in full on My job.`, { invoice_id: row.id, total_inc_gst: row.total_inc_gst, kind: q.kind }, { internal: true });
  else if (created) await logEvent(q.job_id, actorId, "invoice_created_local", `Invoice raised for ${q.option_label}: ${row.total_inc_gst} inc GST. Safety check payment (${row.deposit_amount}) due – owner pays on My job.`, { invoice_id: row.id, total_inc_gst: row.total_inc_gst });
  if (!row.xero_invoice_id) await pushInvoiceToXero(row.id, actorId);
  return row.id;
}

/** Installation booked/rebooked: the same invoice's final due date = Melbourne-local installation date. */
export { setInstallDueDate } from "./invoice-dates.server";

export async function pushInvoiceToXero(invoiceId: string, actorId: string | null, callOverride?: XeroCall) {
  await requireHivicInvoice(invoiceId); // before any lookup, lock or Xero call
  const { data: inv } = await admin.from("invoices").select("*, quotes(status, customer_total_inc_gst, veec_discount_inc_gst, quote_items(code, description, quantity, unit_price_inc_gst, line_total_inc_gst, sort)), jobs(job_number, owners(id, full_name, email, xero_contact_id), properties(address_line, suburb, state, postcode))").eq("id", invoiceId).single();
  if (!inv) throw new Error("Invoice not found");
  // Decision 209 wording (installation address, itemised insulation line, "VEEC incentive") applies to invoices created from
  // here on: an invoice already linked to Xero is never re-created or rewritten (batch 3b: electrical fixes get their own
  // invoice instead of a line on this one).
  if (inv.xero_invoice_id) return; // already linked – never create a second Xero invoice
  if (!(await claimLock(invoiceId))) throw new Error("A Xero sync for this invoice is already running – try again shortly.");
  const job = inv.jobs as unknown as { job_number: string; owners: { id: string; full_name: string; email: string | null; xero_contact_id: string | null }; properties: { address_line: string; suburb: string | null; state: string | null; postcode: string | null } | null };
  const quote = inv.quotes as unknown as { status: string; customer_total_inc_gst: number; veec_discount_inc_gst: number; quote_items: { code: string | null; description: string; quantity: number; unit_price_inc_gst: number; line_total_inc_gst: number; sort: number }[] };
  try {
    const guard = quoteGuard(quote, inv.total_inc_gst);
    if (guard) throw new Error(guard);
    const dueDate = xeroDueDate(inv as unknown as InvoiceRow);
    if (!dueDate) throw new Error("Invoice has no due date.");
    const mode = await modeForInvoice(invoiceId);
    const call = callOverride ?? (await tenantCall(mode));
    const kind = inv.kind === "rectification" ? "rectification" as const : "installation" as const;
    const reference = xeroReference(job.job_number, kind);
    const tracking = await findTrackingOption(call, mode);
    // An older fixes invoice (superseded fixes quote) shares the fixes reference: never adopt a Xero invoice another portal
    // invoice is already linked to.
    const { data: linked, error: linkedErr } = await admin.from("invoices").select("xero_invoice_id").eq("job_id", inv.job_id).neq("id", invoiceId).not("xero_invoice_id", "is", null);
    if (linkedErr) throw new Error(`Could not read the job's other invoices: ${linkedErr.message}`);
    let x = await findInvoiceByReference(call, reference, (linked ?? []).map((r) => String(r.xero_invoice_id)));
    let contactId = x?.Contact?.ContactID ?? job.owners.xero_contact_id;
    if (!x) {
      if (!contactId) contactId = (await findOrCreateContact(call, job.owners)).contactId;
      // Decision 209: "Ceiling insulation — {brand} {model} R{value} — {m²} m²" from the declared product + Ready Check area;
      // unknown facts keep the rate-card wording and raise an office item (never invented). Amounts are untouched.
      // A fixes invoice has no insulation line: its lines go as quoted.
      const { itemiseInvoiceLines, missingProductFacts } = await import("./invoice-itemisation.core");
      const lines = [...quote.quote_items].sort((a, b) => a.sort - b.sort);
      const facts = kind === "installation" ? await (await import("./invoice-itemisation.server")).installedProductFacts(inv.job_id) : null;
      const itemised = facts ? itemiseInvoiceLines(lines, facts) : { items: lines, officeFlag: null };
      const { formatPropertyAddress } = await import("./address");
      const installationAddress = formatPropertyAddress(job.properties) || null;
      const payload = buildInvoicePayload({ contactId: contactId!, jobNumber: job.job_number, dueDate, total: Number(inv.total_inc_gst), kind, items: itemised.items, veecIncentive: kind === "installation" ? quote.veec_discount_inc_gst : 0, tracking, installationAddress });
      assertHivicPayload(payload, mode);
      const res = await call("/api.xro/2.0/Invoices", { method: "POST", headers: { "Idempotency-Key": invoiceIdemKey(invoiceId) }, body: payload });
      x = res.Invoices[0];
      if (itemised.officeFlag && facts) {
        const { INVOICE_PRODUCT_UNCONFIRMED_EVENT } = await import("./invoice-itemisation.core");
        await logEvent(inv.job_id, actorId, INVOICE_PRODUCT_UNCONFIRMED_EVENT, `${itemised.officeFlag}: ${missingProductFacts(facts).join("; ")}`, { invoice_id: invoiceId, reasons: missingProductFacts(facts), needs_office: true }, { internal: true }).catch((e) => console.error("invoice product flag skipped", (e as Error).message));
      }
    }
    if (contactId && contactId !== job.owners.xero_contact_id) await admin.from("owners").update({ xero_contact_id: contactId }).eq("id", job.owners.id);
    const { error: linkErr } = await admin.from("invoices").update({ status: "deposit_due", xero_contact_id: contactId, xero_invoice_id: x.InvoiceID, xero_invoice_number: x.InvoiceNumber, xero_reference: x.Reference, xero_invoice_status: x.Status ?? null, xero_tracking_option_id: tracking?.optionId ?? null, xero_update_pending: false, last_synced_at: new Date().toISOString(), last_sync_error: null }).eq("id", invoiceId);
    if (linkErr) throw new Error(`Xero invoice ${x.InvoiceNumber} exists but could not be linked locally: ${linkErr.message}`);
    await syncLog(invoiceId, true, { xero_invoice_id: x.InvoiceID });
    await logEvent(inv.job_id, actorId, "xero_invoice_created", `Xero invoice ${x.InvoiceNumber} linked`, { invoice_id: invoiceId });
    // Decision 139: the owner's "Pay now" link is Xero's online invoice. Best-effort; Sync fetches it again if missing.
    await storeOnlineInvoiceUrl(invoiceId, x.InvoiceID, call).catch((e) => console.error("xero online invoice url skipped", (e as Error).message));
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
    // Jo 28 Oct: an accepted owner-pays repeat PIESA goes on this same invoice too (retry on every Sync).
    await repeatPiesaStep(inv as unknown as RepairsInvoice, call, await modeForInvoice(invoiceId), actorId)
      .catch((e) => console.error("xero repeat PIESA step skipped", (e as Error).message));
    const r = await call(`/api.xro/2.0/Invoices/${inv.xero_invoice_id}`);
    const x = r.Invoices[0] ?? {};
    const ev = evaluateXeroInvoice(x, Number(inv.deposit_amount));
    if (ev.voided && inv.kind === "rectification" && inv.quote_id) {
      // Batch 3b: an old fixes invoice whose fixes quote a newer one replaced is voided in Xero on purpose (Needs me "Old
      // fixes invoice unpaid — void it in Xero"). That is its normal end, not a sync problem: no error, no problem row.
      const { data: fq } = await admin.from("quotes").select("status").eq("id", inv.quote_id).maybeSingle();
      if (fq?.status === "superseded") {
        const was = String(inv.xero_invoice_status ?? "").toUpperCase();
        await admin.from("invoices").update({ xero_invoice_status: x.Status, last_sync_error: null, last_synced_at: new Date().toISOString(), ...(inv.status === "xero_sync_error" ? { status: "deposit_due" as const } : {}) }).eq("id", invoiceId);
        await syncLog(invoiceId, true, { status: x.Status, old_fixes_invoice: true }, undefined, "inbound");
        if (was !== String(x.Status ?? "").toUpperCase()) await logEvent(inv.job_id, actorId, "xero_invoice_voided", `Old fixes invoice ${inv.xero_invoice_number ?? ""} is ${x.Status} in Xero – replaced by the newer fixes quote`.replace("  ", " "), { invoice_id: invoiceId, old_fixes_invoice: true }, { internal: true });
        return;
      }
    }
    if (ev.voided) {
      const msg = `Xero invoice is ${x.Status} – payment not confirmed; admin must re-issue or override with reason.`;
      await admin.from("invoices").update({ status: "xero_sync_error", xero_invoice_status: x.Status, last_sync_error: msg, last_synced_at: new Date().toISOString() }).eq("id", invoiceId);
      await syncLog(invoiceId, false, { status: x.Status }, msg, "inbound");
      await logEvent(inv.job_id, actorId, "xero_invoice_voided", msg, { invoice_id: invoiceId }, { internal: true });
      return;
    }
    // Decision 139 + audit F01: ledger first (one record per Xero PaymentID; a recorded payment Xero now shows deleted/voided
    // gets one reversal), then the reconciled amount = Xero's live payments + card payments not yet matched in Xero. It
    // may go DOWN (a deleted Xero payment). Ledger trouble never fails the sync: Xero's own AmountPaid is used instead.
    const xeroPayments = (x.Payments ?? []) as XeroPaymentInput[];
    let ledgerChanged = 0;
    let paidCents = Math.round(Number(ev.paid) * 100);
    try {
      const { recordXeroPayments, reconciledInvoicePaidCents } = await import("./payments.server");
      const { reconciledPaidCents, xeroPaymentFacts } = await import("./payments.core");
      // Only a list that accounts for all of Xero's AmountPaid may reverse recorded payments (never on a partial shape).
      // Phase 3 path 3 (27 Oct): Xero leaves `Payments` out once the last payment is deleted; with AmountPaid 0 that is a
      // complete (empty) list, so the deleted payment is reversed in the ledger instead of still counting as paid.
      const fullList = xeroPaymentsListComplete(x.Payments, reconciledPaidCents([], xeroPaymentFacts(xeroPayments)), paidCents);
      ledgerChanged = await recordXeroPayments(invoiceId, inv.job_id, xeroPayments, actorId, { fullList });
      paidCents = await reconciledInvoicePaidCents(inv.job_id, invoiceId, { xeroPayments, xeroAmountPaid: ev.paid });
      // Audit R02: a same-amount card + Xero pair with no shared Stripe id counts once and is raised for the office to confirm.
      const { flagUnclearPaymentMatches } = await import("./payments.server");
      await flagUnclearPaymentMatches(inv.job_id, invoiceId, xeroPayments).catch((e) => console.error("payment match check skipped", (e as Error).message));
    } catch (e) { console.error("xero payment ledger skipped", (e as Error).message); }
    await applyPaidAmount(invoiceId, paidCents / 100, actorId, ev.depositPaidAt);
    // Jo 28 Oct: the owner paid the repeat PIESA on the same invoice → recorded once, then the normal PIESA offer starts.
    await (await import("./repeat-piesa.server")).repeatPaidFromInvoice(inv.job_id, invoiceId, paidCents, actorId)
      .catch((e) => console.error("repeat PIESA payment check skipped", (e as Error).message));
    await admin.from("invoices").update({ xero_invoice_status: x.Status ?? null, xero_online_url: x.OnlineInvoiceUrl ?? inv.xero_online_url, last_synced_at: new Date().toISOString(), last_sync_error: null }).eq("id", invoiceId);
    await syncLog(invoiceId, true, { amount_paid: ev.paid, reconciled_paid: paidCents / 100 }, undefined, "inbound");
    if (ledgerChanged) {
      const { afterPaymentsChanged } = await import("./payments.server");
      await afterPaymentsChanged(inv.job_id, invoiceId, actorId).catch((e) => console.error("payment effects skipped", (e as Error).message));
    }
    if (!x.OnlineInvoiceUrl && !inv.xero_online_url) await storeOnlineInvoiceUrl(invoiceId, inv.xero_invoice_id, call).catch((e) => console.error("xero online invoice url skipped", (e as Error).message));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("invoices").update({ last_sync_error: msg, last_synced_at: new Date().toISOString() }).eq("id", invoiceId);
    await syncLog(invoiceId, false, null, msg, "inbound");
    await logEvent(inv.job_id, actorId, "xero_sync_failed", `Xero payment sync failed: ${msg}`, { invoice_id: invoiceId }, { internal: true });
  } finally {
    await releaseLock(invoiceId);
  }
}

/** Decision 139: Xero's online invoice page is the owner's "Pay now" (card) link. GET /Invoices/{id}/OnlineInvoice, stored on the
 *  ONE invoice. Read-only in Xero; behind the same tenant routing and business-unit barrier as every other Xero call. */
export async function fetchOnlineInvoiceUrl(call: XeroCall, xeroInvoiceId: string): Promise<string | null> {
  const r = await call(`/api.xro/2.0/Invoices/${xeroInvoiceId}/OnlineInvoice`);
  const url = r?.OnlineInvoices?.[0]?.OnlineInvoiceUrl;
  return typeof url === "string" && /^https:\/\//.test(url) ? url : null;
}
async function storeOnlineInvoiceUrl(invoiceId: string, xeroInvoiceId: string, call: XeroCall) {
  const url = await fetchOnlineInvoiceUrl(call, xeroInvoiceId);
  if (url) await admin.from("invoices").update({ xero_online_url: url }).eq("id", invoiceId);
  return url;
}
/** Office "Refresh Pay now link": same barrier; read + one column write, no lock needed. */
export async function refreshOnlineInvoiceUrl(invoiceId: string, actorId: string | null, callOverride?: XeroCall) {
  await requireHivicInvoice(invoiceId);
  const { data: inv } = await admin.from("invoices").select("job_id, xero_invoice_id").eq("id", invoiceId).single();
  if (!inv?.xero_invoice_id) throw new Error("The Xero invoice has not been created yet.");
  const call = callOverride ?? (await tenantCall(await modeForInvoice(invoiceId)));
  const url = await storeOnlineInvoiceUrl(invoiceId, inv.xero_invoice_id, call);
  await logEvent(inv.job_id, actorId, url ? "xero_online_invoice_linked" : "xero_online_invoice_missing", url ? "Xero online invoice (Pay now) link stored" : "Xero returned no online invoice link – check the invoice is approved and online payments are switched on in Xero", { invoice_id: invoiceId }, { internal: true });
  return url;
}

/** Decision 139 poll fallback (15-min tick, env XERO_PAYMENT_POLL_ENABLED=true): re-sync up to `limit` linked, not fully
 *  paid invoices on open jobs, oldest sync first. Audit R03: eligibility is applied BEFORE the limit — settled
 *  (balance_paid_at) and closed-job invoices are filtered in the query, and any that slip through (e.g. older rows paid
 *  in full without balance_paid_at) are paged past, up to `maxPages` pages, until `limit` eligible invoices are found.
 *  All candidates are read first, then synced, so a sync moving a row to the back never shifts a later page. */
export async function pollXeroPayments(limit = 40, opts: { pageSize?: number; maxPages?: number; sync?: (invoiceId: string) => Promise<unknown> } = {}) {
  if (process.env["XERO_PAYMENT_POLL_ENABLED"] !== "true") return { enabled: false, checked: 0, failed: 0 };
  const pageSize = Math.max(1, opts.pageSize ?? 200), maxPages = Math.max(1, opts.maxPages ?? 10);
  const { pickXeroPollBatch, XERO_POLL_CLOSED_STAGES } = await import("./xero.core");
  const rows: { id: string; total_inc_gst: number | string | null; total_paid: number | string | null; jobs: { stage: string | null } | null }[] = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const { data, error } = await admin.from("invoices").select("id, total_inc_gst, total_paid, jobs!inner(business_unit, stage)")
      .not("xero_invoice_id", "is", null).is("balance_paid_at", null).eq("jobs.business_unit", "hivic").not("jobs.stage", "in", `(${XERO_POLL_CLOSED_STAGES.join(",")})`)
      .order("last_synced_at", { ascending: true, nullsFirst: true }).order("id", { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw new Error(`Xero payment poll could not read invoices: ${error.message}`);
    const got = (data ?? []) as unknown as typeof rows;
    rows.push(...got);
    if (got.length < pageSize || pickXeroPollBatch(rows, limit).length >= limit) break;
  }
  const sync = opts.sync ?? ((id: string) => syncInvoiceFromXero(id, null));
  let checked = 0, failed = 0;
  for (const id of pickXeroPollBatch(rows, limit)) {
    checked++;
    try { await sync(id); } catch (e) { failed++; console.error("xero payment poll failed", id, (e as Error).message); }
  }
  return { enabled: true, checked, failed };
}

/** Single place that turns the amount received on the invoice into deposit/balance state + audit events. Callers pass the
 *  RECONCILED amount (`reconciledInvoicePaidCents`, audit F01: Xero's live payments + card payments not yet in Xero);
 *  it is written as-is, so total_paid goes down when a Xero payment is deleted — no max() with the ledger. */
export async function applyPaidAmount(invoiceId: string, paid: number, actorId: string | null, depositReachedAt?: string | null) {
  await requireHivicInvoice(invoiceId);
  const { data: inv } = await admin.from("invoices").select("*").eq("id", invoiceId).single();
  if (!inv) return;
  const effective = Math.max(0, paid);
  const { patch, events } = paymentPatch(inv as unknown as InvoiceRow, effective, depositReachedAt ?? null, new Date().toISOString());
  await admin.from("invoices").update(patch as never).eq("id", invoiceId);
  // A fixes invoice has no safety check part (batch 3b): only the installation invoice records the safety check payment.
  if (events.includes("deposit_paid") && inv.kind === "installation") await logEvent(inv.job_id, actorId, "deposit_paid", `Safety check payment confirmed in Xero (${inv.deposit_amount})`, { invoice_id: invoiceId, amount_paid: paid });
  if (events.includes("balance_paid")) await logEvent(inv.job_id, actorId, "balance_paid", "Invoice fully paid in Xero", { invoice_id: invoiceId });
  if (events.includes("paid_reduced")) await logEvent(inv.job_id, actorId, "payment_total_reduced", `Amount received went down from ${Number(inv.total_paid).toFixed(2)} to ${effective.toFixed(2)} (a Xero payment was deleted or voided, or the same money had been counted twice)`, { invoice_id: invoiceId, was: Number(inv.total_paid), now: effective }, { internal: true });
}

// Shared by the repeat PIESA line below (batch 3b Task 3 replaces it with its own invoice).
type RepairsInvoice = { id: string; job_id: string; quote_id: string; kind: string; total_inc_gst: number | string; total_paid: number | string | null; deposit_amount: number | string; deposit_paid_at: string | null; balance_paid_at: string | null; status: string; xero_invoice_id: string | null; xero_invoice_number: string | null };
export type RepairsStepResult = "none" | "not_linked" | "busy" | "already" | "added" | "adopted" | "held";

// ---------- Jo 28 Oct (decision 233): owner-pays repeat PIESA on the SAME Xero invoice ----------
/** One pass under the invoice's sync lock: when the owner has accepted an owner-pays repeat PIESA, add ONE line for it to
 *  the job's ONE Xero invoice (same rules as the fixes line, `xero-repairs.core`), adopt a line already there, or hold it
 *  for the office as one Needs me row. Never a second invoice. */
async function repeatPiesaStep(inv: RepairsInvoice, call: XeroCall, mode: XeroMode, actorId: string | null): Promise<RepairsStepResult> {
  if (inv.kind !== "installation") return "none";
  if (!inv.xero_invoice_id) return "not_linked";
  const rpc = await import("./repeat-piesa.core");
  const { state } = await (await import("./repeat-piesa.server")).repeatPiesaContext(inv.job_id);
  if ((state.stage !== "owner_pay" && state.stage !== "offer") || state.payer !== "owner" || !state.deadline || !state.priceIncGst) return "none";
  const core = await import("./xero-repairs.core");
  const { toCents } = await import("./payments.core");
  const amountCents = toCents(state.priceIncGst);
  const deadline = state.deadline;
  const key = rpc.repeatLineKey(inv.id, deadline, amountCents);
  const { data: ev } = await admin.from("workflow_events").select("details").eq("job_id", inv.job_id).eq("event_type", rpc.REPEAT_XERO_ADDED_EVENT);
  const recorded = ((ev ?? []) as { details: Record<string, unknown> | null }[]).map((e) => e.details ?? {}).filter((d) => d["invoice_id"] === inv.id && d["deadline"] === deadline)
    .map((d) => ({ key: String(d["key"] ?? ""), rectQuoteId: deadline, amountCents: Number(d["amount_cents"] ?? 0) }));
  // Card path: a card payment moves the job on to "offer" before the line is on; keep adding it until it is recorded.
  if (!rpc.repeatLineDue({ state, lineAdded: recorded.length > 0 })) return "none";
  if (recorded.some((r) => r.key === key)) return "already";
  const baseTotalCents = toCents(inv.total_inc_gst);
  let x: import("./xero-repairs.core").XeroInvoiceForRepairs | null = null;
  try { x = (await call(`/api.xro/2.0/Invoices/${inv.xero_invoice_id}`))?.Invoices?.[0] ?? null; } catch (e) { console.error("xero repeat PIESA read failed", (e as Error).message); }
  // A line already on the invoice keeps the tag it was written with (a reopen line written with the raw-key tag before the batch 1 task 6 fix round).
  const tag = rpc.repeatLineTags(deadline).find((t) => (x?.LineItems ?? []).some((l) => (l.Description ?? "").includes(t))) ?? rpc.repeatLineTag(deadline);
  const d = core.repairsAmendDecision({ enabled: core.XERO_REPAIRS_AMEND_ENABLED, repairs: { rectQuoteId: deadline, amountCents }, key, recorded, baseTotalCents, xero: x, tag });
  const aud = (c: number) => `$${(c / 100).toFixed(2)}`;
  const invName = inv.xero_invoice_number ? `Xero invoice ${inv.xero_invoice_number}` : "the Xero invoice";
  const base = { invoice_id: inv.id, key, deadline, amount_cents: amountCents };
  const hold = async (reason: string) => {
    const details = { ...base, reason };
    const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", inv.job_id).eq("event_type", rpc.REPEAT_XERO_HELD_EVENT).contains("details", details);
    if (!count) await logEvent(inv.job_id, actorId, rpc.REPEAT_XERO_HELD_EVENT, `Repeat safety check (${aud(amountCents)}) not added to ${invName}: ${reason}. Office needs to: add it to the same invoice in Xero, then press Sync.`, { ...details, needs_office: true }, { internal: true });
    return "held" as const;
  };
  const adopt = async (newTotalCents: number, basis: string) => {
    if (baseTotalCents !== newTotalCents) {
      const { error } = await admin.from("invoices").update(core.amendedInvoicePatch(inv, newTotalCents) as never).eq("id", inv.id);
      if (error) throw new Error(`Xero invoice varied but the portal invoice could not be updated: ${error.message}`);
    }
    await logEvent(inv.job_id, actorId, rpc.REPEAT_XERO_ADDED_EVENT, `Repeat safety check (${aud(amountCents)}) is on ${invName} – invoice total now ${aud(newTotalCents)}`, { ...base, total_before_cents: baseTotalCents, total_after_cents: newTotalCents, paid_at_add_cents: toCents(inv.total_paid ?? 0), basis, xero_invoice_id: inv.xero_invoice_id }, { internal: true });
  };
  if (d.action === "none") return "none";
  if (d.action === "hold") return hold(d.reason.replace("electrical fixes", "repeat safety check"));
  if (d.action === "already") { await adopt(Math.round(Number(x!.Total ?? 0) * 100), d.basis); return "adopted"; }
  const { data: job } = await admin.from("jobs").select("job_number").eq("id", inv.job_id).maybeSingle();
  const u = core.buildRepairsAmendment({ xero: x!, jobNumber: String(job?.job_number ?? ""), rectQuoteId: deadline, amountCents, key, mode, description: rpc.repeatLineDescription(x!.Reference!, deadline) });
  let after: import("./xero-repairs.core").XeroInvoiceForRepairs | null = null;
  try { after = (await call(u.path, { method: u.method, headers: u.headers, body: u.body }))?.Invoices?.[0] ?? null; }
  catch (e) { return hold(`Xero refused the edit: ${(e as Error).message.slice(0, 200)}`); }
  const bad = core.verifyRepairsAmendment(x!, after, deadline, u.expectedTotalCents, tag);
  if (bad) return hold(`Xero's answer could not be confirmed (${bad})`);
  await syncLog(inv.id, true, { repeat_piesa_added: amountCents, key });
  await adopt(u.expectedTotalCents, "amended");
  return "added";
}

/** Owner accepted an owner-pays repeat PIESA: put it on the job's ONE Xero invoice now (best-effort; every Sync retries). */
export async function addRepeatPiesaToXeroInvoice(jobId: string, actorId: string | null, callOverride?: XeroCall): Promise<RepairsStepResult> {
  const inv = await jobInvoice(jobId);
  if (!inv?.xero_invoice_id) return "not_linked";
  await requireHivicInvoice(inv.id);
  if (!(await claimLock(inv.id))) return "busy";
  try {
    const mode = await modeForInvoice(inv.id);
    const call = callOverride ?? (await tenantCall(mode));
    return await repeatPiesaStep(inv as unknown as RepairsInvoice, call, mode, actorId);
  } finally {
    await releaseLock(inv.id);
  }
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
