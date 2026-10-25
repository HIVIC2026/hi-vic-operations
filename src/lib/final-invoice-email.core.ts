// Decision 334 (Jo, 25 Oct 2026): the O45 final invoice email goes when the install is recorded complete and a balance is
// due — once per invoice — through the decision-325 owner-email trigger pattern (one `owner_email_triggered` event per key
// BEFORE the guarded send). The balance is paid by bank transfer only (bank details + invoice number as the reference);
// card stays only for the safety check and fixes (decisions 140/144). Pure: the due rule and the invoice facts the
// approved renderer prints. No I/O; owner-email-triggers.server.ts reads the facts and sends.
import { toCents } from "./payments.core";

/** No final invoice email for installs recorded complete more than this many days ago (no backlog when wired). */
export const FINAL_INVOICE_WITHIN_DAYS = 14;
export const FINAL_INVOICE_STOP_STAGES = ["cancelled", "on_hold"] as const;

export type FinalInvoiceDueFacts = {
  installationCompletedAt: string | null; stage: string; deletedAt: string | null; qaArchivedAt?: string | null;
  invoice: { id: string; xeroInvoiceId: string | null; xeroInvoiceNumber: string | null } | null;
  balanceDueCents: number; done: boolean;
};

/** Why O45 can't go yet (null = it may). Needs: install complete (recent), an invoice in Xero with its number (the bank
 *  reference), a balance still owing, and nothing sent for this invoice before. */
export function finalInvoiceBlocker(f: FinalInvoiceDueFacts, now: Date = new Date()): string | null {
  if (!f.installationCompletedAt) return "Install not recorded complete";
  if (f.deletedAt || f.qaArchivedAt) return "Job deleted or archived";
  if ((FINAL_INVOICE_STOP_STAGES as readonly string[]).includes(f.stage)) return "Job cancelled or on hold";
  if (now.getTime() - Date.parse(f.installationCompletedAt) >= FINAL_INVOICE_WITHIN_DAYS * 86_400_000) return "Install finished too long ago";
  if (!f.invoice) return "No installation invoice";
  if (!f.invoice.xeroInvoiceId || !f.invoice.xeroInvoiceNumber?.trim()) return "Invoice not in Xero yet (no invoice number for the reference)";
  if (f.balanceDueCents <= 0) return "Nothing owing";
  if (f.done) return "Already sent for this invoice";
  return null;
}

const dayMonth = (iso: string) => new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short" }).format(new Date(iso));
const longDate = (iso: string) => new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));

export type FinalInvoiceFactsInput = {
  invoiceNumber: string; completedAt: string;
  /** Accepted quote lines in order (already itemised for decision 209 by the caller). */
  items: { description: string; line_total_inc_gst: number | string }[];
  /** invoices.total_inc_gst = the amount after the VEEC incentive (what the owner pays). */
  invoiceTotalIncGst: number | string;
  /** quotes.veec_discount_inc_gst (the negative "VEEC incentive" line on the Xero invoice). */
  veecIncentiveIncGst: number | string | null;
  /** Ledger (owner_payment_recorded) for this invoice. */
  ledger: { amountCents: number; paidAt: string }[];
  /** invoices.total_paid (Xero) — the ledger never counts less than it. */
  totalPaid: number | string | null;
};

/** The approved renderer's invoice facts: lines, total before/after the VEEC incentive, payments so far, balance due. GST is
 *  left off (null) — the invoice email never computes tax figures Xero did not give us. */
export function finalInvoiceFacts(i: FinalInvoiceFactsInput) {
  const rebate = Math.max(0, toCents(i.veecIncentiveIncGst ?? 0)) / 100;
  const afterVeecCents = toCents(i.invoiceTotalIncGst);
  const ledgerCents = i.ledger.reduce((s, r) => s + Math.max(0, Math.round(r.amountCents)), 0);
  const paidCents = Math.max(ledgerCents, toCents(i.totalPaid ?? 0));
  const payments = [...i.ledger].filter((r) => r.amountCents > 0).sort((a, b) => Date.parse(a.paidAt) - Date.parse(b.paidAt)).map((r) => ({ label: dayMonth(r.paidAt), amount: Math.round(r.amountCents) / 100 }));
  // Xero total paid ahead of the ledger (e.g. a payment not yet in the ledger): one catch-up line so the sums agree.
  if (paidCents > ledgerCents) payments.push({ label: "other payments", amount: (paidCents - ledgerCents) / 100 });
  return {
    invoiceNumber: i.invoiceNumber.trim(), invoiceDate: longDate(i.completedAt),
    lines: i.items.map((l) => ({ description: String(l.description ?? "").trim(), amount: Number(l.line_total_inc_gst) })),
    totalIncGst: (afterVeecCents + Math.round(rebate * 100)) / 100, gst: null as number | null, rebate,
    payments, balanceDue: Math.max(0, afterVeecCents - paidCents) / 100,
    balanceDueCents: Math.max(0, afterVeecCents - paidCents),
  };
}
