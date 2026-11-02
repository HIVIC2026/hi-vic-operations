import { describe, expect, test } from "bun:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument } from "pdf-lib";
import { CUSTOMER_AGREEMENT_V1_3, type AgreementFacts } from "../src/lib/customer-agreement.core";
import { AGREEMENT_BOLD_LEADS, customerAgreementPdf } from "../src/lib/customer-agreement-pdf.server";

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

  test("every bold lead-in is in the body and is drawn in the Bold font", async () => {
    const lines = CUSTOMER_AGREEMENT_V1_3.split("\n").map((l) => l.replace(/^- /, ""));
    for (const lead of AGREEMENT_BOLD_LEADS) expect(lines.some((l) => l.startsWith(`${lead} `))).toBe(true);
    const r = await customerAgreementPdf(T, SAMPLE_FACTS);
    const d = await getDocument({ data: r.bytes.slice() }).promise;
    const bold: string[] = []; const regular: string[] = [];
    for (let i = 1; i <= d.numPages; i++) {
      const pg = await d.getPage(i);
      const tc = await pg.getTextContent();
      await pg.getOperatorList(); // loads the fonts
      for (const it of tc.items as any[]) {
        const name: string = (pg.commonObjs.has(it.fontName) ? pg.commonObjs.get(it.fontName).name : "") ?? "";
        (/Bold/i.test(name) && !/Extra/i.test(name) ? bold : regular).push(it.str);
      }
    }
    const boldText = bold.join(" ");
    for (const lead of AGREEMENT_BOLD_LEADS) {
      for (const word of lead.split(" ")) expect(boldText).toContain(word);
    }
    // The text after a lead-in is not bold.
    expect(boldText).not.toContain("your installer calls you");
    expect(regular.join(" ")).toContain("your installer calls you");
  });
  test("no email address is split across lines and sections land on the approved pages", async () => {
    const r = await customerAgreementPdf(T, SAMPLE_FACTS);
    const d = await getDocument({ data: r.bytes.slice() }).promise;
    const items: string[] = [];
    for (let i = 1; i <= d.numPages; i++) for (const it of (await (await d.getPage(i)).getTextContent()).items as any[]) items.push(it.str);
    const joined = items.join("\n");
    for (const e of ["info@homeinsulationvictoria.com.au", "office@rapidinsulation.com.au"]) expect(items.some((t) => t.includes(e))).toBe(true);
    expect(joined).not.toMatch(/\.co\s+m\.au/);
    // Sections 1-10 are the 10 numbered sections in order: 1-3 on page 1, 4-7 on page 2, 8-10 on page 3 (as the approved sample).
    const secs = Object.entries(r.layout.blockPage).filter(([id]) => id.startsWith("sec")).slice(0, 10).map(([, p]) => p);
    expect(secs).toEqual([1, 1, 1, 2, 2, 2, 2, 3, 3, 3]);
    expect(r.layout.blockPage["payment-terms"]).toBe(4);
  });
});
