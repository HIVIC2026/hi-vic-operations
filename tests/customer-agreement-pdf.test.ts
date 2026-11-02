import { describe, expect, test } from "bun:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument } from "pdf-lib";
import { CUSTOMER_AGREEMENT_V1_3, type AgreementFacts } from "../src/lib/customer-agreement.core";
import { customerAgreementPdf } from "../src/lib/customer-agreement-pdf.server";

const pdfText = async (b: Uint8Array) => {
  const d = await getDocument({ data: b.slice() }).promise; const out: string[] = [];
  for (let i = 1; i <= d.numPages; i++) out.push((await (await d.getPage(i)).getTextContent()).items.map((x: any) => x.str).join(" "));
  return out;
};
export const SAMPLE_FACTS: AgreementFacts = {
  owner_name: "Sarah Brown", address: "12 Example St, Box Hill VIC 3128", job_number: "HV-1234", installer_name: "Rapid Insulation",
  installer_phone: "03 9000 0000", installer_email: "office@rapidinsulation.com.au", product: "Bradford Gold R5.0 ceiling batts", area_m2: "137",
  price_before_rebate: "$3,798.00", rebate: "$1,610.00", your_price: "$2,188.00", valid_until: "Mon 8 Dec 2026",
  safety_check: "$349", deposit: "$183.90", rest: "$1,655.10",
};
const T = { version: "1.3", body: CUSTOMER_AGREEMENT_V1_3 };

describe("Customer Agreement PDF", () => {
  test("4 pages like the approved sample, payment terms on its own page", async () => {
    const r = await customerAgreementPdf(T, SAMPLE_FACTS);
    expect(r.layout.pages).toBe(4);
    expect(r.layout.split).toEqual([]);
    const pages = await pdfText(r.bytes);
    expect(pages.join(" ")).toContain("Install Bradford Gold R5.0 ceiling batts across 137 m² of your ceiling, as in your quote.");
    // The eyebrow is letter-spaced, so the text reader puts spaces between its letters.
    expect(pages.findIndex((p) => p.replace(/\s+/g, "").includes("PAYMENTTERMS"))).toBe(r.layout.blockPage["payment-terms"]! - 1);
    expect(pages.join(" ")).toContain("Version 1.3");
  });
  test("file name, no lawyer wording anywhere, no leftover markup", async () => {
    const r = await customerAgreementPdf(T, SAMPLE_FACTS);
    expect(r.fileName).toBe("Customer-Agreement-and-payment-terms-v1.3.pdf");
    const all = (await pdfText(r.bytes)).join(" ");
    expect(all).not.toMatch(/lawyer/i);
    expect(all).not.toMatch(/\{[a-z_0-9]+\}/);
    expect(all).not.toContain("[x]"); // section icons are drawn, not written as text
    expect(Buffer.from(r.bytes).toString("latin1")).not.toMatch(/lawyer/i);
    const doc = await PDFDocument.load(r.bytes);
    expect(`${doc.getTitle()} ${doc.getSubject() ?? ""} ${doc.getAuthor() ?? ""}`).not.toMatch(/lawyer/i);
  });
  test("values that would corrupt the markup are rejected", async () => {
    await expect(customerAgreementPdf(T, { ...SAMPLE_FACTS, product: "Gold | R5.0" })).rejects.toThrow(/product/);
    await expect(customerAgreementPdf(T, { ...SAMPLE_FACTS, address: "1 A St\\nBox Hill" })).rejects.toThrow(/address/);
    await expect(customerAgreementPdf(T, { ...SAMPLE_FACTS, address: "1 A St\nBox Hill" })).rejects.toThrow(/address/);
  });
  test("a missing detail stops the document", async () => {
    await expect(customerAgreementPdf(T, { ...SAMPLE_FACTS, rest: "" })).rejects.toThrow(/Missing agreement detail: rest/);
  });
});
