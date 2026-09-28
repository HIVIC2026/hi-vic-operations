// Pure Xero logic (no database). Every Xero call goes through the injected `XeroCall`,
// so tests can mock it and never hit the live Xero API.
export type XeroCall = (path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => Promise<any>;

export const TRACKING_CATEGORY = "Projects";
export const TRACKING_OPTION = "Home Insulation Victoria";
export const LOCK_STALE_MS = 2 * 60 * 1000;

export const r2 = (n: number) => Math.round(n * 100) / 100;
export const xeroReference = (jobNumber: string) => `HI VIC ${jobNumber}`;
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

export async function findTrackingOption(call: XeroCall) {
  const r = await call("/api.xro/2.0/TrackingCategories");
  const cat = (r.TrackingCategories ?? []).find((c: any) => c.Name === TRACKING_CATEGORY && c.Status === "ACTIVE");
  const opt = cat?.Options?.find((o: any) => o.Name === TRACKING_OPTION && (o.Status ?? "ACTIVE") === "ACTIVE");
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

/** Find an existing live invoice for this job reference (adopt after a lost response). */
export async function findInvoiceByReference(call: XeroCall, reference: string) {
  const r = await call(`/api.xro/2.0/Invoices?where=${encodeURIComponent(`Type=="ACCREC"&&Reference=="${q(reference)}"`)}`);
  return (r.Invoices ?? []).find((i: any) => !["VOIDED", "DELETED"].includes(i.Status)) ?? null;
}

export function buildInvoicePayload(a: {
  contactId: string; jobNumber: string; dueDate: string;
  items: { description: string; quantity: number | string; unit_price_inc_gst: number | string }[];
  veecDiscount: number | string; tracking: { categoryName: string; optionName: string };
}) {
  const prefix = `${xeroReference(a.jobNumber)} – `;
  const Tracking = [{ Name: a.tracking.categoryName, Option: a.tracking.optionName }];
  const lines = a.items.map((i) => ({ Description: prefix + i.description, Quantity: Number(i.quantity), UnitAmount: Number(i.unit_price_inc_gst), AccountCode: "200", Tracking }));
  if (Number(a.veecDiscount) > 0) lines.push({ Description: prefix + "VEEC discount", Quantity: 1, UnitAmount: -Number(a.veecDiscount), AccountCode: "200", Tracking });
  return { Invoices: [{ Type: "ACCREC", Contact: { ContactID: a.contactId }, LineAmountTypes: "Inclusive", Reference: xeroReference(a.jobNumber), DueDate: a.dueDate, Status: "AUTHORISED", LineItems: lines }] };
}

/** Translate a Xero invoice into portal payment facts. Voided/deleted never clears the deposit. */
export function evaluateXeroInvoice(x: { Status?: string; AmountPaid?: number; Payments?: { Date?: string; Amount?: number }[] }, depositAmount: number) {
  if (x.Status === "VOIDED" || x.Status === "DELETED") return { voided: true as const, paid: 0, depositPaidAt: null as string | null };
  const paid = Number(x.AmountPaid ?? 0);
  // Earliest date by which cumulative payments reached the deposit.
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
