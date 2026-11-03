// Renders website-look PDF samples (TEST names only, nothing read from or written to the database, nothing sent) to
// docs/approved-samples/2026-11-02/built/ for Jo's side-by-side. Run: bun scripts/render-pdf-samples.ts agreement
// Later documents add their name to RENDERERS.
import { mkdirSync, writeFileSync } from "node:fs";
import { CUSTOMER_AGREEMENT_V1_3, type AgreementFacts } from "../src/lib/customer-agreement.core";
import { customerAgreementPdf } from "../src/lib/customer-agreement-pdf.server";
import { escConsentPdf } from "../src/lib/consent-pdf.server";
import { officialFormPdf } from "../src/lib/official-form-pdf.server";
import { fullAnswers } from "./official-form-samples";
import { sampleSignaturePng } from "./sample-signature-png";
import { taxInvoicePdf } from "../src/lib/tax-invoice-pdf.server";
import { LOGO_PNG } from "../src/lib/email-hero-assets";

export const AGREEMENT_SAMPLE_FACTS: AgreementFacts = {
  owner_name: "Sarah Brown", address: "12 Example St, Box Hill VIC 3128", job_number: "HV-1234", installer_name: "Rapid Insulation",
  installer_phone: "03 9000 0000", installer_email: "office@rapidinsulation.com.au", product: "Bradford Gold R5.0 ceiling batts",
  area_m2: "137", price_before_rebate: "$3,798.00", rebate: "$1,610.00", your_price: "$2,188.00", valid_until: "Mon 8 Dec 2026",
  safety_check: "$349", deposit: "$183.90", rest: "$1,655.10",
};

const RENDERERS: Record<string, () => Promise<{ file: string; bytes: Uint8Array }>> = {
  agreement: async () => ({
    file: "customer-agreement.pdf",
    bytes: (await customerAgreementPdf({ version: "1.3", body: CUSTOMER_AGREEMENT_V1_3 }, AGREEMENT_SAMPLE_FACTS)).bytes,
  }),
  // Task 15: the ESC owner consent, signed by both (the unsigned copy is esc-consent-unsigned.pdf).
  "esc-consent": async () => ({
    file: "esc-consent.pdf",
    bytes: (await escConsentPdf(
      { ap_legal_entity: "DC Construction Solutions Pty Ltd t/a Home Insulation Victoria", owner: { name: "Sarah Brown", email: "sarah@example.com", phone: "0400 000 000" }, premises_address: "12 Example St, Box Hill VIC 3128" },
      { owner: { name: "Sarah Brown", at: "2026-11-10T09:00:00+11:00" }, ap: { name: "Chris Lowe", role: "Director", at: "2026-11-10T09:00:00+11:00" } },
      { jobNumber: "HV-1234" },
    )).bytes,
  }),
  // Task 12: the filled DEECA forms, with made-up Mitti signature pictures (sample-signature-png.ts).
  piesa: async () => ({
    file: "official-piesa.pdf",
    bytes: (await officialFormPdf("piesa", fullAnswers("piesa"), {
      "b3.signature": { images: [{ bytes: sampleSignaturePng("Sam Sparks"), contentType: "image/png", signedOn: "2026-11-07" }] },
      "c.signature": { images: [{ bytes: sampleSignaturePng("Sam Sparks C"), contentType: "image/png", signedOn: "2026-11-12" }] },
    })).bytes,
  }),
  piisa: async () => ({
    file: "official-piisa.pdf",
    bytes: (await officialFormPdf("piisa", fullAnswers("piisa"), {
      "p8.signature": { images: [{ bytes: sampleSignaturePng("Will Casdorff"), contentType: "image/png", signedOn: "2026-11-20" }] },
    })).bytes,
  }),
  // Part 10 Task 7: an installer's own customer — both logos, the approved lines (our own logo stands in for the installer's).
  "tax-invoice-own-customer": async () => {
    const r = await taxInvoicePdf({
      invoiceNumber: "INV-1234", invoiceDate: "Thu 13 Nov 2026", jobNumber: "HV-1234", ownerName: "Sarah Brown", installAddress: "12 Example St, Box Hill VIC 3128",
      installerName: "Rapid Insulation", installedOn: "Thu 13 Nov 2026", productLine: "Bradford Gold R5.0 · R5.0 · 120 m² · supplied and installed",
      productCents: 200000, piesaCents: 34900, rebateCents: 60000, extraLines: [{ label: "Home Insulation Victoria fee", cents: 34900 }],
      payments: [{ label: "Electrical safety check (PIESA)", paidOn: "8 Nov", cents: 34900 }, { label: "10% deposit", paidOn: "10 Nov", cents: 17490 }, { label: "Final payment", paidOn: "13 Nov", cents: 157410 }],
      ownCustomer: { installerName: "Rapid Insulation", installerLogoUrl: "https://example.invalid/rapid-logo.png", installerLogo: { bytes: new Uint8Array(Buffer.from(LOGO_PNG, "base64")), width: 400, height: 171 } },
    }, { cobrandApproved: true });
    if ("held" in r) throw new Error(r.held);
    console.log(`tax-invoice-own-customer: ${r.layout.pages} page(s), split: ${r.layout.split.join(",") || "none"}`);
    return { file: "tax-invoice-own-customer.pdf", bytes: r.bytes };
  },
};

if (import.meta.main) {
  const names = process.argv.slice(2);
  const bad = names.filter((n) => !RENDERERS[n]);
  if (names.length === 0 || bad.length) {
    console.error(`Usage: bun scripts/render-pdf-samples.ts <${Object.keys(RENDERERS).join("|")}>...${bad.length ? ` (unknown: ${bad.join(", ")})` : ""}`);
    process.exit(1);
  }
  const dir = new URL("../docs/approved-samples/2026-11-02/built/", import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  for (const n of names) {
    const { file, bytes } = await RENDERERS[n]!();
    writeFileSync(dir + file, bytes);
    console.log(`wrote ${dir}${file}`);
  }
}
