// Audit R07 / F03 (Jo approved the fix 25 Oct 2026): electrical fixes the owner approves AFTER the installation quote are
// added to the SAME Xero invoice as ONE extra line, so the portal plan (quote total + fixes), the invoice total, the paid
// status and the balance agree. Pure rules only — no database, no network; `xero.server.ts` does the reads and the write.
//
// Safety:
//   • Only an AUTHORISED invoice with nothing paid or credited against it is edited (Xero refuses to edit an invoice
//     with a payment or credit allocated). Anything else is HELD for the office as one Needs me row — never a second
//     invoice: payments, the ledger and every step threshold live on the ONE invoice (decisions 139/140/141).
//   • Idempotent by the repairs revision (invoice + fixes quote + amount): recorded once; a line already on the Xero
//     invoice (lost response) or an invoice the office already varied by hand is adopted, never added twice.
//   • Existing lines are sent back exactly as Xero returned them (LineItemID kept), so the installation lines and the
//     BAS Excluded VEEC incentive line (decision 391) are untouched; the new line carries the same Business Unit tracking
//     and the same locked reference rule ("Home Insulation Victoria <job> – …").
import { assertHivicPayload, assertHivicReference, XERO_REFERENCE_PREFIX, type XeroMode } from "./xero.core";

/** Code switch for the automatic write. Same state as the invoice push (`XERO_LIVE_CALLS_ENABLED`, on since Jo 24 Oct
 *  2026); live calls still need that switch and the tenant routing. Off = every approved fixes amount is held for the office. */
export const XERO_REPAIRS_AMEND_ENABLED = true;

export const REPAIRS_ADDED_EVENT = "xero_invoice_repairs_added";
export const REPAIRS_HELD_EVENT = "xero_invoice_repairs_held";
export const REPAIRS_LINE_LABEL = "Electrical fixes";
export const REPAIRS_ACCOUNT_CODE = "200";

const cents = (n: unknown) => Math.round(Number(n ?? 0) * 100);

/** The repairs revision: one invoice, one accepted fixes quote, one amount. */
export const repairsKey = (invoiceId: string, rectQuoteId: string, amountCents: number) => `xero-repairs:v1:${invoiceId}:${rectQuoteId}:${Math.round(amountCents)}`;
/** Short tag printed on the line so a lost response can be recognised on the Xero invoice itself. */
export const repairsTag = (rectQuoteId: string) => `fixes quote ${rectQuoteId.replace(/-/g, "").slice(0, 8)}`;
export const repairsLineDescription = (reference: string, rectQuoteId: string) => `${reference} – ${REPAIRS_LINE_LABEL} approved after the safety check (${repairsTag(rectQuoteId)})`;

export type XeroLine = { LineItemID?: string; Description?: string; Quantity?: number; UnitAmount?: number; LineAmount?: number; AccountCode?: string; TaxType?: string; Tracking?: { Name: string; Option: string; [k: string]: unknown }[]; [k: string]: unknown };
export type XeroInvoiceForRepairs = {
  InvoiceID?: string; Status?: string; Reference?: string; Total?: number; AmountPaid?: number; AmountCredited?: number; LineAmountTypes?: string;
  LineItems?: XeroLine[]; Payments?: { Status?: string; Amount?: number }[]; CreditNotes?: unknown[]; Prepayments?: unknown[]; Overpayments?: unknown[];
};
export type RecordedRepairs = { key: string; rectQuoteId: string; amountCents: number };

export type RepairsDecision =
  | { action: "none" }
  | { action: "already"; basis: "recorded" | "line_on_invoice" | "total_matches" }
  | { action: "amend" }
  | { action: "hold"; reason: string };

const aud = (c: number) => `$${(c / 100).toFixed(2)}`;
const live = (p: { Status?: string; Amount?: number }) => !["DELETED", "VOIDED"].includes(String(p.Status ?? "").toUpperCase()) && Number(p.Amount ?? 0) > 0;

export const REPAIRS_SWITCHED_OFF = "Adding electrical fixes to the Xero invoice is switched off";
export const REPAIRS_PAID_HOLD = "Xero won't let an invoice with a payment or credit on it be edited";

/** What to do for one invoice. `baseTotalCents` = the accepted installation quote total, i.e. the invoice total before
 *  any fixes were added (never the local row, which this very step may already have varied). */
export function repairsAmendDecision(i: {
  enabled: boolean;
  repairs: { rectQuoteId: string; amountCents: number } | null;
  key: string | null;
  recorded: RecordedRepairs[];
  baseTotalCents: number;
  xero: XeroInvoiceForRepairs | null;
}): RepairsDecision {
  if (!i.repairs || i.repairs.amountCents <= 0 || !i.key) return { action: "none" };
  if (i.recorded.some((r) => r.key === i.key)) return { action: "already", basis: "recorded" };
  const other = i.recorded.find((r) => r.key !== i.key);
  if (other) return { action: "hold", reason: `The electrical fixes changed after they were added to the Xero invoice (was ${aud(other.amountCents)}, now ${aud(i.repairs.amountCents)}) — adjust the Xero invoice by hand` };
  if (!i.enabled) return { action: "hold", reason: REPAIRS_SWITCHED_OFF };
  const x = i.xero;
  if (!x) return { action: "hold", reason: "The Xero invoice could not be read" };
  if (!x.Reference?.startsWith(XERO_REFERENCE_PREFIX)) return { action: "hold", reason: "The Xero invoice reference is not a Home Insulation Victoria reference" };
  const tag = repairsTag(i.repairs.rectQuoteId);
  if ((x.LineItems ?? []).some((l) => (l.Description ?? "").includes(tag))) return { action: "already", basis: "line_on_invoice" };
  const xeroTotal = cents(x.Total);
  // The office varied the invoice by hand (e.g. removed a payment, added the fixes, re-applied it): adopt it.
  if (xeroTotal === i.baseTotalCents + i.repairs.amountCents) return { action: "already", basis: "total_matches" };
  if (x.Status !== "AUTHORISED") return { action: "hold", reason: `The Xero invoice is ${x.Status ?? "in an unknown state"}, so it can't be edited` };
  if (xeroTotal !== i.baseTotalCents) return { action: "hold", reason: `The Xero invoice total (${aud(xeroTotal)}) doesn't match the accepted quote (${aud(i.baseTotalCents)})` };
  const paid = cents(x.AmountPaid) > 0 || cents(x.AmountCredited) > 0 || (x.Payments ?? []).some(live)
    || (x.CreditNotes ?? []).length > 0 || (x.Prepayments ?? []).length > 0 || (x.Overpayments ?? []).length > 0;
  if (paid) return { action: "hold", reason: REPAIRS_PAID_HOLD };
  if (!(x.LineItems ?? []).length || (x.LineItems ?? []).some((l) => !l.LineItemID)) return { action: "hold", reason: "The Xero invoice lines could not be read in full" };
  return { action: "amend" };
}

/** Tracking for the new line = the Business Unit tracking already on the invoice's lines (same tracking as the original). */
export function invoiceTracking(lines: XeroLine[]): { Name: string; Option: string }[] | undefined {
  const t = lines.find((l) => l.Tracking?.length)?.Tracking;
  return t?.length ? t.map((x) => ({ Name: x.Name, Option: x.Option })) : undefined;
}

/** POST /Invoices/{id}: every existing line sent back exactly as Xero returned it (LineItemID kept, so nothing is
 *  changed or dropped), plus ONE repairs line. Idempotency-Key = the repairs revision. */
export function buildRepairsAmendment(a: { xero: XeroInvoiceForRepairs; jobNumber: string; rectQuoteId: string; amountCents: number; key: string; mode: XeroMode }) {
  const x = a.xero;
  if (!x.InvoiceID) throw new Error("Xero invoice id missing.");
  assertHivicReference(x.Reference);
  const existing = x.LineItems ?? [];
  const line: XeroLine = { Description: repairsLineDescription(x.Reference!, a.rectQuoteId), Quantity: 1, UnitAmount: a.amountCents / 100, AccountCode: REPAIRS_ACCOUNT_CODE };
  const tracking = invoiceTracking(existing);
  if (tracking) line.Tracking = tracking;
  const body = { Invoices: [{ InvoiceID: x.InvoiceID, Reference: x.Reference!, ...(x.LineAmountTypes ? { LineAmountTypes: x.LineAmountTypes } : {}), LineItems: [...existing, line] }] };
  assertHivicPayload(body as never, a.mode);
  return { path: `/api.xro/2.0/Invoices/${x.InvoiceID}`, method: "POST" as const, headers: { "Idempotency-Key": `hivic-${a.key.replace(/:/g, "-")}` }, body, expectedTotalCents: cents(x.Total) + a.amountCents };
}

/** Xero's answer must hold every original line, the repairs line and the varied total — otherwise the write is not trusted. */
export function verifyRepairsAmendment(before: XeroInvoiceForRepairs, after: XeroInvoiceForRepairs | null | undefined, rectQuoteId: string, expectedTotalCents: number): string | null {
  if (!after) return "Xero returned no invoice after the edit";
  if (after.InvoiceID !== before.InvoiceID) return "Xero returned a different invoice";
  if (cents(after.Total) !== expectedTotalCents) return `Xero invoice total is ${aud(cents(after.Total))}, expected ${aud(expectedTotalCents)}`;
  const ids = new Set((after.LineItems ?? []).map((l) => l.LineItemID));
  if ((before.LineItems ?? []).some((l) => !ids.has(l.LineItemID))) return "An original invoice line is missing after the edit";
  if (!(after.LineItems ?? []).some((l) => (l.Description ?? "").includes(repairsTag(rectQuoteId)))) return "The electrical fixes line is missing after the edit";
  return null;
}

/** Local invoice row after the Xero invoice was varied: the total is Xero's new total, the balance follows it, and an
 *  invoice that was "fully paid" at the old total is not fully paid any more (paid in full = the full varied total). */
export function amendedInvoicePatch(row: { total_inc_gst: number | string; total_paid: number | string | null; deposit_amount: number | string; deposit_paid_at: string | null; balance_paid_at: string | null; status: string }, newTotalCents: number) {
  const patch: Record<string, unknown> = { total_inc_gst: newTotalCents / 100, balance_amount: (newTotalCents - cents(row.deposit_amount)) / 100 };
  if (row.balance_paid_at && cents(row.total_paid) < newTotalCents) {
    patch["balance_paid_at"] = null;
    patch["status"] = row.deposit_paid_at ? "deposit_paid" : "deposit_due";
  }
  return patch;
}
