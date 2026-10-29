// Batch 1 final fix F1: "Two separate payments" lives on the OFFICE job Money card (the owner-side block never rendered
// for the office). The loader carries the unclear pairs through; the card shows them with the button.
import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

const pair = { invoiceId: "inv-1", invoice: "install", reference: "INV-1", pairKey: "pi_3Abc123456|x1", amountCents: 34_900, xeroPaymentId: "x1", xeroPaidAt: "2026-10-26T03:00:00.000Z" };
mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: { from() {
  const q: any = { select() { return q; }, eq() { return q; }, in() { return q; }, order() { return q; }, limit() { return q; }, maybeSingle() { return q; },
    then(res: (v: unknown) => void) { return res({ data: null, error: null }); } };
  return q;
} } }));
mock.module("../src/lib/payments.server", () => ({ jobPaymentView: async () => ({
  invoiceId: "inv-1", steps: [], paidCents: 34_900, reference: "INV-1", bank: { configured: false }, onlineInvoiceUrl: null, provisional: null,
  // Batch 3b: the view carries each invoice (install / fixes / repeat) and the money on each.
  invoices: { install: { id: "inv-1", xero_invoice_number: "INV-1", xero_reference: "Home Insulation Victoria HV-1", total_inc_gst: 1000, xero_invoice_id: "x-1" }, fixes: null, repeat: null }, paid: { install: 34_900, fixes: 0, repeat: 0 },
  plan: { grandTotalCents: 100_000 }, unclearPairs: [pair],
}) }));
const { loadJobMoney } = await import("../src/lib/office-job-page.server");

test("loadJobMoney carries the unclear card + Xero pairs to the office Money card", async () => {
  const m = await loadJobMoney("job-1");
  expect(m.view?.unclearPairs).toEqual([pair]);
});

test("the TEST office gets no pairs (it cannot press the office-only button)", async () => {
  const m = await loadJobMoney("job-1", true);
  expect(m.view?.unclearPairs).toEqual([]);
});

test("MoneyCard shows the pair line and the Two separate payments button, calling markPaymentsSeparateFn", () => {
  const src = readFileSync("src/components/portal/office-job.tsx", "utf8");
  const card = src.slice(src.indexOf("export function MoneyCard"), src.indexOf("/* ---------------- Contact history"));
  expect(card).toContain("useAction(markPaymentsSeparateFn)");
  expect(card).toContain("v?.unclearPairs");
  expect(card).toContain("Card payment and a same-amount Xero payment — counted once.");
  expect(card).toContain(">Two separate payments</button>");
});

test("the unreachable owner-side panel no longer carries the button", () => {
  const src = readFileSync("src/components/portal/panels.tsx", "utf8");
  expect(src).not.toContain("markPaymentsSeparateFn");
  expect(src).not.toContain("Two separate payments");
});
