// I4: receipts and the tax invoice are new-look PDFs. Until Jo approves the sample (PDF_LOOK_APPROVED.receipts / .taxInvoice),
// filing them is held: nothing is read, made or stored.
import { afterEach, expect, mock, test } from "bun:test";

const touched: string[] = [];
const chain: any = new Proxy({}, { get: (_t, k) => (k === "then" ? undefined : () => chain) });
mock.module("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => { touched.push(t); return chain; }, storage: { from: (b: string) => { touched.push(`storage:${b}`); return chain; } } },
}));

const { fileReceiptPdf } = await import("../src/lib/receipt-pdf.server");
const { fileTaxInvoicePdf } = await import("../src/lib/tax-invoice-pdf.server");
const { PDF_LOOK_APPROVED } = await import("../src/lib/pdf-approvals.core");

afterEach(() => { PDF_LOOK_APPROVED.receipts = false; PDF_LOOK_APPROVED.taxInvoice = false; touched.length = 0; });

test("receipt: held while the receipt layout is not approved, and nothing is read or stored", async () => {
  expect(PDF_LOOK_APPROVED.receipts).toBe(false);
  expect(await fileReceiptPdf("job-1", "safety_check", "rk-1")).toEqual({ held: "Receipt not made: the new receipt layout is awaiting approval" });
  expect(touched).toEqual([]);
});

test("tax invoice: held while the tax invoice layout is not approved, and nothing is read or stored", async () => {
  expect(PDF_LOOK_APPROVED.taxInvoice).toBe(false);
  expect(await fileTaxInvoicePdf("job-1")).toEqual({ held: "Tax invoice not made: the new tax invoice layout is awaiting approval" });
  expect(touched).toEqual([]);
});
