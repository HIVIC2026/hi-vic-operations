// Renders the decision 334 sample "O45 – Final invoice" (bank transfer only: bank details + invoice number as the
// reference; no card wording, no "Invoice PDF attached" unless the PDF is attached) into docs/templates/invoices with the
// fixed sample data used by tests/approved-email-designs.test.ts, and prints the subject + text. Pure renderer only;
// nothing is sent. Run: bun scripts/render-decision-334-sample.ts
import { writeFileSync } from "node:fs";
import { renderFinalInvoiceEmail } from "../src/lib/completion-emails.core";
import { HIV_BANK_DETAILS } from "../src/lib/payments.core";

const DIR = new URL("../docs/templates/invoices/", import.meta.url).pathname;
const m = renderFinalInvoiceEmail({
  firstName: "Helen", ownerName: "Helen Yang", address: "824 High Street Road, Glen Waverley VIC 3150", installer: { name: "Reinsulate", phone: "0400 000 000" },
  invoiceNumber: "INV-3117", invoiceDate: "11 November 2026",
  lines: [{ description: "Ceiling insulation — CSR Bradford Gold Ceiling Batt R5.0 — 137.6 m²", amount: 2752 }, { description: "Old insulation removed and taken away, 40 m²", amount: 600 }, { description: "Electrical safety check (PIESA)", amount: 349 }, { description: "Accredited Provider fee", amount: 349 }],
  totalIncGst: 4050, gst: null, rebate: 1850,
  payments: [{ label: "24 Oct", amount: 349 }, { label: "4 Nov", amount: 185.1 }],
  balanceDue: 1665.9, bank: HIV_BANK_DETAILS, invoicePdfAttached: false,
  installed: { description: "Ceiling insulation — CSR Bradford Gold Ceiling Batt R5.0 — 137.6 m²", escModelCodes: ["467911"] },
});
writeFileSync(`${DIR}O45-final-invoice.html`, m.html);
if (import.meta.main) console.log(`--- O45 Final invoice — subject: ${m.subject}\n${m.text}\n`);
