import { describe, expect, test } from "bun:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument } from "pdf-lib";
import { gstOnFullPriceCents, taxInvoiceModel, type TaxInvoiceFacts } from "../src/lib/tax-invoice-pdf.core";
import { taxInvoicePdf } from "../src/lib/tax-invoice-pdf.server";

const pdfText = async (b: Uint8Array) => { const d = await getDocument({ data: b.slice() }).promise; const out: string[] = []; for (let i = 1; i <= d.numPages; i++) out.push((await (await d.getPage(i)).getTextContent()).items.map((x: any) => x.str).join(" ")); return out; };

const SAMPLE: TaxInvoiceFacts = {
  invoiceNumber: "INV-1234", invoiceDate: "Thu 13 Nov 2026", jobNumber: "HV-1234", ownerName: "Sarah Brown", installAddress: "12 Example St, Box Hill VIC 3128",
  installerName: "Rapid Insulation", installedOn: "Thu 13 Nov 2026",
  productLine: "Bradford Gold Hi-Performance Ceiling Batts · R5.0 · 137 m² · supplied and installed (includes removal of 40 m² of old insulation)",
  productCents: 344900, piesaCents: 34900, rebateCents: 161000,
  payments: [{ label: "Electrical safety check (PIESA)", paidOn: "8 Nov", cents: 34900 }, { label: "10% deposit", paidOn: "10 Nov", cents: 18390 }, { label: "Final payment", paidOn: "13 Nov", cents: 165510 }],
};

test("GST on the full price before the rebate", () => { expect(gstOnFullPriceCents(379800)).toBe(34527); });
test("sample payments add up to the price", () => { expect(SAMPLE.payments.map((p) => p.cents)).toEqual([34900, 18390, 165510]); });
test("sample invoice", () => {
  const m = taxInvoiceModel(SAMPLE) as any;
  expect(m.priceBeforeRebate).toBe("$3,798.00");
  expect(m.rebate).toBe("– $1,610.00");
  expect(m.payable).toBe("$2,188.00");
  expect(m.gstLine).toBe("Includes GST of $345.27, worked out on the price before the rebate (ATO rule for certificate rebates)");
  expect(m.balance).toBe("$0.00 · Paid in full ✓");
});
test("extraLines are added to the price before the rebate", () => {
  const m = taxInvoiceModel({ ...SAMPLE, extraLines: [{ label: "Home Insulation Victoria fee", cents: 34900 }], rebateCents: 161000 }) as any;
  expect(m.priceBeforeRebate).toBe("$4,147.00");
  expect(m.rows.map((r: any) => r.label)).toContain("Home Insulation Victoria fee");
  expect(m.gstLine).toContain("$377.00");
});
test("an unpaid part shows what is still to pay", () => {
  expect((taxInvoiceModel({ ...SAMPLE, payments: SAMPLE.payments.slice(0, 1) }) as any).balance).toBe("$1,839.00 still to pay");
});
test("every ESC field is printed", async () => {
  const r = (await taxInvoicePdf(SAMPLE)) as any;
  const pages = await pdfText(r.bytes);
  const t = pages.join(" ").replace(/\s+/g, " ");
  expect((await PDFDocument.load(r.bytes)).getPageCount()).toBe(1);
  for (const s of ["Tax invoice", "Invoice INV-1234", "Bill to", "Installation address", "Contracting business (Accredited Person)", "ABN 44 671 613 979", "1/33 Altree Court, Phillip ACT 2606", "VEU Accredited Person A003654", "Installed by", "Rapid Insulation, on Thu 13 Nov 2026", "Victorian Energy Upgrades rebate (price reduction)"]) expect(t.toLowerCase()).toContain(s.toLowerCase()); // labels are drawn in capitals, as in the approved sample
  // consumer name, address, business name/address/ABN, brand + model + R-value, total m², price before, incentive, amount paid after, date
  for (const s of ["Sarah Brown", "12 Example St, Box Hill VIC 3128", "DC Construction Solutions Pty Ltd", "Bradford Gold Hi-Performance Ceiling Batts", "R5.0", "137 m²", "$3,798.00", "– $1,610.00", "$2,188.00", "Date Thu 13 Nov 2026"]) expect(t).toContain(s);
  expect(t).not.toMatch(/lawyer/i);
  expect(Buffer.from(r.bytes).toString("latin1")).not.toMatch(/lawyer/i);
});
test("missing invoice number or product holds", async () => {
  expect(taxInvoiceModel({ ...SAMPLE, invoiceNumber: null })).toEqual({ held: "Tax invoice not made: no invoice number yet" });
  expect(taxInvoiceModel({ ...SAMPLE, productLine: null })).toEqual({ held: "Tax invoice not made: installed product not confirmed" });
  expect(await taxInvoicePdf({ ...SAMPLE, invoiceNumber: " " })).toEqual({ held: "Tax invoice not made: no invoice number yet" });
});
describe("other missing facts hold, never a blank", () => {
  for (const [k, why] of [["ownerName", "the owner's name"], ["installAddress", "the installation address"], ["installerName", "who installed it"], ["installedOn", "the install date"], ["invoiceDate", "the invoice date"]] as const)
    test(k, () => expect(taxInvoiceModel({ ...SAMPLE, [k]: "" })).toEqual({ held: `Tax invoice not made: ${why} is missing` }));
  test("rebate bigger than the price", () => expect(taxInvoiceModel({ ...SAMPLE, rebateCents: 400000 })).toEqual({ held: "Tax invoice not made: the rebate is more than the price" }));
  test("paid more than payable", () => expect(taxInvoiceModel({ ...SAMPLE, payments: [{ label: "x", paidOn: "1 Nov", cents: 300000 }] })).toEqual({ held: "Tax invoice not made: payments are more than the amount payable" }));
});
