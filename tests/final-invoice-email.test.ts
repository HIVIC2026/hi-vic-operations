// Decision 334 (Jo, 25 Oct 2026): O45 final invoice — bank transfer only, once per invoice at install complete with a
// balance due. Pure due rule + invoice facts. Run: bun test tests/final-invoice-email.test.ts
import { describe, expect, test } from "bun:test";
import { FINAL_INVOICE_WITHIN_DAYS, finalInvoiceBlocker, finalInvoiceFacts, type FinalInvoiceDueFacts } from "../src/lib/final-invoice-email.core";
import { renderFinalInvoiceEmail } from "../src/lib/completion-emails.core";
import { HIV_BANK_DETAILS } from "../src/lib/payments.core";

const DONE = "2026-11-11T05:00:00.000Z";
const NOW = new Date("2026-11-11T06:00:00.000Z");
const due = (p: Partial<FinalInvoiceDueFacts> = {}): FinalInvoiceDueFacts => ({
  installationCompletedAt: DONE, stage: "evidence_outstanding", deletedAt: null, qaArchivedAt: null,
  invoice: { id: "inv1", xeroInvoiceId: "x1", xeroInvoiceNumber: "INV-3117" }, balanceDueCents: 166590, done: false, ...p,
});

describe("finalInvoiceBlocker", () => {
  test("due at install complete with a balance owing", () => {
    expect(finalInvoiceBlocker(due(), NOW)).toBeNull();
  });
  test("held: not complete, nothing owing, not in Xero, already sent, cancelled/on hold, deleted/archived, too old", () => {
    expect(finalInvoiceBlocker(due({ installationCompletedAt: null }), NOW)).toMatch(/not recorded complete/);
    expect(finalInvoiceBlocker(due({ balanceDueCents: 0 }), NOW)).toMatch(/Nothing owing/);
    expect(finalInvoiceBlocker(due({ invoice: null }), NOW)).toMatch(/No installation invoice/);
    expect(finalInvoiceBlocker(due({ invoice: { id: "inv1", xeroInvoiceId: null, xeroInvoiceNumber: null } }), NOW)).toMatch(/not in Xero/);
    expect(finalInvoiceBlocker(due({ done: true }), NOW)).toMatch(/Already sent/);
    for (const stage of ["cancelled", "on_hold"]) expect(finalInvoiceBlocker(due({ stage }), NOW)).toMatch(/cancelled or on hold/);
    expect(finalInvoiceBlocker(due({ deletedAt: "x" }), NOW)).toMatch(/deleted/);
    expect(finalInvoiceBlocker(due({ qaArchivedAt: "x" }), NOW)).toMatch(/archived/);
    expect(finalInvoiceBlocker(due(), new Date(Date.parse(DONE) + FINAL_INVOICE_WITHIN_DAYS * 86_400_000))).toMatch(/too long ago/);
  });
});

describe("finalInvoiceFacts", () => {
  const f = finalInvoiceFacts({
    invoiceNumber: " INV-3117 ", completedAt: DONE,
    items: [{ description: "Ceiling insulation — CSR Bradford Gold R5.0 — 137.6 m²", line_total_inc_gst: 2752 }, { description: "Electrical safety check (PIESA)", line_total_inc_gst: "349" }, { description: "Accredited Provider fee", line_total_inc_gst: 349 }],
    invoiceTotalIncGst: 1600, veecIncentiveIncGst: 1850,
    ledger: [{ amountCents: 18510, paidAt: "2026-11-04T01:00:00Z" }, { amountCents: 34900, paidAt: "2026-10-24T01:00:00Z" }],
    totalPaid: 534.1,
  });
  test("total before the VEEC incentive, the incentive, payments in date order, balance = after-VEEC total − paid", () => {
    expect(f.invoiceNumber).toBe("INV-3117");
    expect(f.invoiceDate).toBe("11 November 2026");
    expect(f.lines.map((l) => l.amount)).toEqual([2752, 349, 349]);
    expect(f.totalIncGst).toBe(3450);
    expect(f.rebate).toBe(1850);
    expect(f.gst).toBeNull();
    expect(f.payments).toEqual([{ label: "24 Oct", amount: 349 }, { label: "4 Nov", amount: 185.1 }]);
    expect(f.balanceDue).toBe(1065.9);
    expect(f.balanceDueCents).toBe(106590);
  });
  test("Xero paid ahead of the ledger adds one catch-up line so the sums agree", () => {
    const g = finalInvoiceFacts({ invoiceNumber: "INV-1", completedAt: DONE, items: [], invoiceTotalIncGst: 1000, veecIncentiveIncGst: null, ledger: [{ amountCents: 10000, paidAt: DONE }], totalPaid: 300 });
    expect(g.payments.at(-1)).toEqual({ label: "other payments", amount: 200 });
    expect(g.balanceDue).toBe(700);
  });
  test("the facts render: bank details, invoice number reference, no card wording", () => {
    const { balanceDueCents: _b, ...facts } = f;
    const m = renderFinalInvoiceEmail({ ...facts, firstName: "Helen", ownerName: "Helen Yang", address: null, installer: { name: "Reinsulate" }, bank: HIV_BANK_DETAILS, invoicePdfAttached: false });
    for (const s of ["Pay by bank transfer", "Account name: Home Insulation Victoria", "BSB 082-902 · Account 777966349", "Reference: INV-3117", "Amount: $1,065.90"]) expect(m.html).toContain(s);
    for (const s of ["card", "Stripe", "Invoice PDF attached"]) expect(m.text).not.toContain(s);
  });
});
