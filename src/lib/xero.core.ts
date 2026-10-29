// Pure Xero logic (no database). Every Xero call goes through the injected `XeroCall`,
// so tests can mock it and never hit the live Xero API.
import { currentFeeWording } from "./hiv-quote.core";

export type XeroCall = (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<any>;

export const TRACKING_CATEGORY = "Projects"; // Jo 27 Oct: DC Xero uses Projects → Home Insulation Victoria, no fallback category
export const TRACKING_OPTION = "Home Insulation Victoria";
export const LOCK_STALE_MS = 2 * 60 * 1000;

export const r2 = (n: number) => Math.round(n * 100) / 100;
/** Locked Xero/customer-facing reference (owner decision 2026-10-03). */
export const XERO_REFERENCE_PREFIX = "Home Insulation Victoria ";
/** Batch 3b (Jo 29 Oct 2026): one Xero invoice per kind. The installation reference is unchanged; electrical fixes and each
 *  owner-paid repeat safety check get their own invoice with a suffix ("… HV-1234 fixes", "… HV-1234 safety check 2"). */
export type XeroInvoiceKind = "installation" | "rectification" | "repeat_safety_check";
export function xeroReference(jobNumber: string, kind: XeroInvoiceKind, repeatNo?: number): string {
  const base = `${XERO_REFERENCE_PREFIX}${jobNumber}`;
  if (kind === "rectification") return `${base} fixes`;
  if (kind === "repeat_safety_check") {
    if (!repeatNo || !Number.isInteger(repeatNo) || repeatNo < 2) throw new Error("A repeat safety check reference needs its number (2, 3, …).");
    return `${base} safety check ${repeatNo}`;
  }
  return base;
}

// ---------- Business-unit barrier (fail closed) ----------
export const HIVIC_BUSINESS_UNIT = "hivic";
export const NOT_HIVIC_ERROR = "Xero automation blocked: this is not a Home Insulation Victoria job.";
/** Throws unless the job is exactly business_unit = 'hivic'. Missing job / missing value = blocked. */
export function assertHivicJob(job: { business_unit?: string | null } | null | undefined): void {
  if (!job || job.business_unit !== HIVIC_BUSINESS_UNIT) throw new Error(NOT_HIVIC_ERROR);
}
/** Resolve the job behind any invoice ID a caller supplies, then apply the barrier. */
export async function assertHivicInvoice(invoiceId: string, loadJobForInvoice: (id: string) => Promise<{ business_unit?: string | null } | null>) {
  assertHivicJob(await loadJobForInvoice(invoiceId));
}
/** Second defensive check on every outgoing invoice payload: Home Insulation Victoria reference + Projects = Home Insulation Victoria on every line. */
export function assertHivicPayload(payload: { Invoices: { Reference?: string | undefined; LineItems: { Tracking?: { Name: string; Option: string }[] | undefined }[] }[] }, mode: XeroMode = "live") {
  for (const inv of payload.Invoices) {
    if (!inv.Reference?.startsWith(XERO_REFERENCE_PREFIX)) throw new Error(`Xero write blocked: invoice reference must start with '${XERO_REFERENCE_PREFIX}'.`);
    if (!inv.LineItems.length) throw new Error("Xero write blocked: invoice has no lines.");
    if (mode === "test") continue; // Demo Company TEST invoices only: Projects tracking not required
    if (!inv.LineItems.every((l) => l.Tracking?.some((t) => t.Name === TRACKING_CATEGORY && t.Option === TRACKING_OPTION)))
      throw new Error(`Xero write blocked: every line must be tracked ${TRACKING_CATEGORY} = ${TRACKING_OPTION}.`);
  }
}
/** Due-date updates may only touch an invoice whose stored reference is a Home Insulation Victoria reference. */
export function assertHivicReference(reference: string | null | undefined) {
  if (!reference?.startsWith(XERO_REFERENCE_PREFIX)) throw new Error("Xero write blocked: stored invoice reference is not a Home Insulation Victoria reference.");
}
/** Due-date updates to existing Xero invoices are prepared but switched off until explicitly enabled. */
export const XERO_DUE_DATE_UPDATES_ENABLED = false;
export const contactIdemKey = (ownerId: string) => `hivic-contact-${ownerId}`;
export const invoiceIdemKey = (invoiceId: string) => `hivic-invoice-${invoiceId}`;

/** Calendar date (YYYY-MM-DD) of an instant in Melbourne time. */
export function melbourneDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

const q = (s: string) => s.replace(/"/g, '\\"');

/** Accepted-quote guard: returns an error message or null. */
export function quoteGuard(quote: { status: string; customer_total_inc_gst: number | string }, invoiceTotal: number | string): string | null {
  if (quote.status !== "accepted") return `Quote is ${quote.status}, not accepted – invoice not pushed.`;
  if (r2(Number(quote.customer_total_inc_gst)) !== r2(Number(invoiceTotal))) return `Invoice total ${invoiceTotal} does not match accepted quote total ${quote.customer_total_inc_gst} – invoice not pushed.`;
  return null;
}

export async function findTrackingOption(call: XeroCall, mode: XeroMode = "live"): Promise<{ categoryName: string; optionName: string; optionId: string } | null> {
  const r = await call("/api.xro/2.0/TrackingCategories");
  const cat = (r.TrackingCategories ?? []).find((c: any) => c.Name === TRACKING_CATEGORY && c.Status === "ACTIVE");
  const opt = cat?.Options?.find((o: any) => o.Name === TRACKING_OPTION && (o.Status ?? "ACTIVE") === "ACTIVE");
  if ((!cat || !opt) && mode === "test") return null; // Demo Company only – real invoices stay strict
  if (!cat || !opt) throw new Error(`Xero tracking option "${TRACKING_CATEGORY} = ${TRACKING_OPTION}" not found – ask the Xero admin to add it (the portal will not create it).`);
  return { categoryName: cat.Name as string, optionName: opt.Name as string, optionId: opt.TrackingOptionID as string };
}

/** Reuse an existing Xero contact (by email, then exact name) before creating one. */
export async function findOrCreateContact(call: XeroCall, owner: { id: string; full_name: string; email: string | null }) {
  const lookups = [owner.email ? `EmailAddress=="${q(owner.email)}"` : null, `Name=="${q(owner.full_name)}"`].filter(Boolean) as string[];
  for (const where of lookups) {
    const r = await call(`/api.xro/2.0/Contacts?where=${encodeURIComponent(where)}`);
    const hit = (r.Contacts ?? []).find((c: any) => c.ContactStatus !== "ARCHIVED");
    if (hit) return { contactId: hit.ContactID as string, created: false };
  }
  const c = await call("/api.xro/2.0/Contacts", { method: "POST", headers: { "Idempotency-Key": contactIdemKey(owner.id) }, body: { Contacts: [{ Name: owner.full_name, EmailAddress: owner.email ?? undefined }] } });
  return { contactId: c.Contacts[0].ContactID as string, created: true };
}

/** Find an existing live invoice for this exact reference (adopt after a lost response). The reference must match exactly,
 *  so the installation reference never picks up "… fixes" or "… safety check 2". `excludeInvoiceIds` = Xero invoices already
 *  linked to another portal invoice (an older fixes invoice shares the fixes reference and must never be adopted). */
export async function findInvoiceByReference(call: XeroCall, reference: string, excludeInvoiceIds: readonly string[] = []) {
  assertHivicReference(reference); // exact Home Insulation Victoria reference only – never a broad DC invoice search
  const r = await call(`/api.xro/2.0/Invoices?where=${encodeURIComponent(`Type=="ACCREC"&&Reference=="${q(reference)}"`)}`);
  return (r.Invoices ?? []).find((i: any) => i.Reference === reference && !["VOIDED", "DELETED"].includes(i.Status) && !excludeInvoiceIds.includes(i.InvoiceID)) ?? null;
}

/** Name of the negative incentive line (Activity Guide v1.2 Table 4 / decision 209: "VEEC incentive", not "discount"). */
export const VEEC_INCENTIVE_LINE = "VEEC incentive";
/** Decision 391 (Jo, 25 Oct 2026, from tax advice): GST is charged on the full installation price, so the VEEC incentive
 *  line carries NO GST ("BAS Excluded"). It goes to the VEEC account the accountant names; until then it stays on Sales
 *  "200", because a code that doesn't exist in Xero would stop every invoice push. Invoices already in Xero are unchanged. */
export const VEEC_INCENTIVE_TAX_TYPE = "BASEXCLUDED";
export const VEEC_INCENTIVE_ACCOUNT_CODE = "200";
export const INSTALLATION_ADDRESS_LABEL = "Installation address";

/** ONE full detailed invoice per accepted quote: every accepted customer-facing quote line once, plus (installation only)
 *  the VEEC incentive as a negative line. A fixes invoice (batch 3b) carries only the fixes quote's lines.
 *  Amounts are inc GST (LineAmountTypes Inclusive) so Xero never adds GST again; lines must sum to the accepted total exactly.
 *  Decision 209 (Jo 24 Oct 2026): the first line also carries the installation address (the Reference stays the locked
 *  "Home Insulation Victoria <job>"); the insulation line's wording is prepared by `itemiseInvoiceLines` before this call.
 *  Business name, address and ABN come from the Xero invoice template (Jo's organisation settings), not from here.
 *  Invoices already in Xero are never rewritten: `pushInvoiceToXero` returns as soon as `xero_invoice_id` is set, so this
 *  wording applies to invoices created from this change on. */
export function buildInvoicePayload(a: {
  contactId: string; jobNumber: string; dueDate: string; total: number;
  /** Batch 3b: which invoice this is (default installation). A fixes invoice carries only the fixes lines and never a VEEC
   *  incentive line. */
  kind?: "installation" | "rectification";
  items: { description: string; quantity: number | string; unit_price_inc_gst: number | string; line_total_inc_gst: number | string }[];
  /** The VEEC incentive taken off the price (quotes.veec_discount_inc_gst), inc GST. */
  veecIncentive: number | string; tracking: { categoryName: string; optionName: string } | null;
  /** Installation address; printed on the first line when known, never invented. */
  installationAddress?: string | null;
}) {
  const kind = a.kind ?? "installation";
  const ref = xeroReference(a.jobNumber, kind);
  const Tracking = a.tracking ? [{ Name: a.tracking.categoryName, Option: a.tracking.optionName }] : undefined;
  const address = a.installationAddress?.trim() ? ` – ${INSTALLATION_ADDRESS_LABEL}: ${a.installationAddress.trim()}` : "";
  const LineItems: { Description: string; Quantity: number; UnitAmount: number; AccountCode: string; TaxType?: string; Tracking: { Name: string; Option: string }[] | undefined }[] = a.items.map((i, n) => {
    const q = Number(i.quantity), u = Number(i.unit_price_inc_gst), lt = Number(i.line_total_inc_gst);
    const exact = Math.round(q * u * 100) === Math.round(lt * 100);
    const head = `${ref}${n === 0 ? address : ""}`;
    return exact
      ? { Description: `${head} – ${currentFeeWording(i.description)}`, Quantity: q, UnitAmount: u, AccountCode: "200", Tracking }
      : { Description: `${head} – ${currentFeeWording(i.description)} (${q} × ${u})`, Quantity: 1, UnitAmount: lt, AccountCode: "200", Tracking };
  });
  if (kind === "installation" && Number(a.veecIncentive) > 0) LineItems.push({ Description: `${ref} – ${VEEC_INCENTIVE_LINE}`, Quantity: 1, UnitAmount: -Number(a.veecIncentive), AccountCode: VEEC_INCENTIVE_ACCOUNT_CODE, TaxType: VEEC_INCENTIVE_TAX_TYPE, Tracking });
  const sum = LineItems.reduce((s, l) => s + Math.round(l.Quantity * l.UnitAmount * 100), 0);
  if (sum !== Math.round(a.total * 100)) throw new Error(`Quote lines (${sum / 100}) don't add up to the accepted total (${a.total}) – invoice not pushed.`);
  return { Invoices: [{ Type: "ACCREC", Contact: { ContactID: a.contactId }, LineAmountTypes: "Inclusive", Reference: ref, DueDate: a.dueDate, Status: "AUTHORISED", LineItems }] };
}

/** Prepared (not sent while disabled) Xero due-date update for an existing invoice. Idempotent: same input, same request. */
export function buildDueDateUpdate(xeroInvoiceId: string, dueDate: string, invoiceId: string) {
  return { path: `/api.xro/2.0/Invoices/${xeroInvoiceId}`, method: "POST", headers: { "Idempotency-Key": `hivic-due-${invoiceId}-${dueDate}` }, body: { Invoices: [{ InvoiceID: xeroInvoiceId, DueDate: dueDate }] } };
}

/** Translate a Xero invoice into portal payment facts. Voided/deleted never clears the deposit. */
export function evaluateXeroInvoice(x: { Status?: string; AmountPaid?: number; Payments?: { Date?: string; Amount?: number }[] }, depositAmount: number) {
  if (x.Status === "VOIDED" || x.Status === "DELETED") return { voided: true as const, paid: 0, depositPaidAt: null as string | null };
  const paid = Number(x.AmountPaid ?? 0);
  // Earliest date by which cumulative payments on the one invoice reached the configured minimum deposit.
  let run = 0, depositPaidAt: string | null = null;
  for (const p of [...(x.Payments ?? [])].sort((a, b) => parseXeroDate(a.Date) - parseXeroDate(b.Date))) {
    run += Number(p.Amount ?? 0);
    if (run >= depositAmount && p.Date) { depositPaidAt = new Date(parseXeroDate(p.Date)).toISOString(); break; }
  }
  return { voided: false as const, paid, depositPaidAt };
}

export function parseXeroDate(d?: string) {
  if (!d) return 0;
  const m = /\/Date\((\d+)/.exec(d);
  return m ? Number(m[1]) : Date.parse(d);
}

export const lockHeld = (lockAt: string | null, now = Date.now()) => !!lockAt && now - Date.parse(lockAt) < LOCK_STALE_MS;

// ---------- Payment poll fallback (audit R03) ----------
/** Jobs whose invoices the poll never re-reads. */
export const XERO_POLL_CLOSED_STAGES = ["cancelled", "complete"] as const;
export type XeroPollRow = { id: string; total_inc_gst: number | string | null; total_paid: number | string | null; jobs?: { stage?: string | null } | null };
/** Eligible = not fully paid and the job not closed. Applied BEFORE the limit (audit R03: the oldest 40 linked invoices
 *  used to be taken first and settled ones skipped afterwards, so a newer unpaid invoice was never reached). */
export function xeroPollEligible(r: XeroPollRow): boolean {
  const stage = r.jobs?.stage ?? "";
  if ((XERO_POLL_CLOSED_STAGES as readonly string[]).includes(stage)) return false;
  return Math.round(Number(r.total_paid ?? 0) * 100) < Math.round(Number(r.total_inc_gst ?? 0) * 100);
}
/** From candidate pages (oldest sync first), the first `limit` eligible ids. Rotation comes from the order: every
 *  synced invoice gets a fresh `last_synced_at` and moves to the back, so nothing eligible starves. */
export function pickXeroPollBatch(rows: XeroPollRow[], limit: number): string[] {
  const out: string[] = [];
  for (const r of rows) {
    if (out.length >= limit) break;
    if (xeroPollEligible(r) && !out.includes(r.id)) out.push(r.id);
  }
  return out;
}

// ---------- Organisation routing (fail closed) ----------
/** Live jobs may call Xero only when this switch is turned on. Off = no Xero calls for real jobs.
 *  Jo 24 Oct 2026: ON — the live Home Insulation Victoria Xero organisation is ready. */
export const XERO_LIVE_CALLS_ENABLED = true;
export type XeroMode = "test" | "live";
export type XeroTenant = { tenantId: string; tenantName?: string | null };
const DEMO = /demo company/i;
const LIVE = /^dc construction solutions pty ltd$/i;
/** Read-only description of the existing routes. Availability does not enable a route. */
export function describeXeroRouting(conns: XeroTenant[]) {
  const testOrganisation = conns.find(c => DEMO.test(c.tenantName ?? ""))?.tenantName ?? null;
  const liveCandidates = conns.filter(c => LIVE.test(c.tenantName ?? "") && !DEMO.test(c.tenantName ?? ""))
    .map(c => c.tenantName ?? "Unnamed organisation");
  let liveOrganisation: string | null = null;
  let liveBlocker: string | null = null;
  try { liveOrganisation = pickXeroTenant(conns, "live").tenantName ?? "Unnamed organisation"; }
  catch (error) { liveBlocker = error instanceof Error ? error.message : "The real-job Xero route could not be verified."; }
  return { liveCallsEnabled: XERO_LIVE_CALLS_ENABLED, testOrganisation, liveOrganisation, liveCandidates, liveBlocker };
}
/** Jo 27 Oct: TEST jobs use Demo; real Home Insulation Victoria work uses DC's books with the existing business-unit barrier. Never "first org". */
export function pickXeroTenant(conns: XeroTenant[], mode: XeroMode): XeroTenant {
  const name = (t: XeroTenant) => t.tenantName ?? "";
  if (mode === "test") {
    const t = conns.find((c) => DEMO.test(name(c)));
    if (!t) throw new Error("Xero Demo Company is not connected – TEST jobs never use the real books. Ask Jo to authorise the Demo Company.");
    return t;
  }
  if (!XERO_LIVE_CALLS_ENABLED) throw new Error("Xero is switched off for real jobs.");
  const t = conns.find((c) => LIVE.test(name(c)) && !DEMO.test(name(c)));
  if (!t) throw new Error("DC Construction Solutions Xero organisation is not connected.");
  return t;
}
