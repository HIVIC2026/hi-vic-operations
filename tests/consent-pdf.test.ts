import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { ESC_AP_FULL_NAME, OWNER_DECLARATIONS, apDeclarationText, type ConsentFacts } from "../src/lib/consent.core";
import { consentAutoApRep } from "../src/lib/consent-ap-auto.core";
import { escConsentPdf } from "../src/lib/consent-pdf.server";

const pdfText = async (b: Uint8Array) => { const d = await getDocument({ data: b.slice() }).promise; const out: string[] = []; for (let i = 1; i <= d.numPages; i++) out.push((await (await d.getPage(i)).getTextContent()).items.map((x: any) => x.str).join(" ")); return out.join(" ").replace(/\s+/g, " "); };
const SAMPLE_FACTS: ConsentFacts = { ap_legal_entity: "DC Construction Solutions Pty Ltd t/a Home Insulation Victoria", owner: { name: "Sarah Brown", email: "sarah@example.com", phone: "0400 000 000" }, premises_address: "12 Example St, Box Hill VIC 3128" };
const SIGNED = { owner: { name: "Sarah Brown", at: "2026-11-10T09:00:00+11:00" }, ap: { name: "Chris Lowe", role: "Director", at: "2026-11-10T09:00:00+11:00" } };
// The approved sample names the AP "DC Construction Solutions Pty Ltd trading as Home Insulation Victoria" in the declarations.
const AP_SAMPLE = ESC_AP_FULL_NAME.replace(" (VEU Accredited Person A003654)", "");

describe("ESC owner consent PDF (website look)", () => {
  test("ESC template V1 wording verbatim, four Section 2 declarations, AP signer", async () => {
    const r = await escConsentPdf(SAMPLE_FACTS, SIGNED);
    const text = await pdfText(r.bytes);
    for (const h of ["Section 1: Information to be shared", "Section 2: Declaration by owner", "I declare that:", "Section 3 – Accredited person details and declaration", "Part A: Accredited person details", "Part B: Declaration by accredited person"]) expect(text).toContain(h);
    expect(OWNER_DECLARATIONS).toHaveLength(4);
    for (const d of OWNER_DECLARATIONS) expect(text).toContain(d.text.replace(ESC_AP_FULL_NAME, AP_SAMPLE));
    expect(text).toContain(apDeclarationText("Chris Lowe").replace(ESC_AP_FULL_NAME, AP_SAMPLE));
    for (const v of ["Sarah", "Brown", "12 Example St, Box Hill VIC 3128", "0400 000 000", "sarah@example.com", "Tue 10 Nov 2026", "Chris", "Lowe", "Director", "info@homeinsulationvictoria.com.au", `${AP_SAMPLE} (A003654)`]) expect(text).toContain(v);
    expect(text).toContain("Chris Lowe");
    expect(text).toContain("0416 252 406");
    expect(text).not.toMatch(/lawyer/i);
    expect(r.layout.pages).toBe(1);
    expect(r.layout.split).toEqual([]);
  });
  test("unsigned copy is pre-filled from the owner and property, with no owner signature or dates", async () => {
    const r = await escConsentPdf(SAMPLE_FACTS, null);
    const text = await pdfText(r.bytes);
    expect(text).toContain("12 Example St, Box Hill VIC 3128");
    expect(text).toContain("sarah@example.com");
    expect(text).not.toContain("Tue 10 Nov 2026");
    expect(text).not.toMatch(/lawyer/i);
    expect(r.layout.split).toEqual([]);
  });
  test("owner signed, AP not yet: owner date only", async () => {
    const text = await pdfText((await escConsentPdf(SAMPLE_FACTS, { owner: SIGNED.owner })).bytes);
    expect(text.match(/Tue 10 Nov 2026/g)?.length).toBe(1);
  });
  test("flag off keeps the text copy", () => {
    expect(readFileSync("src/lib/consent.server.ts", "utf8")).toMatch(/PDF_LOOK_APPROVED\.escConsent/);
  });
  test("the automatic AP signer is Chris Lowe, Director, and the signed PDF prints Director", async () => {
    const rep = consentAutoApRep()!;
    expect(rep.role).toBe("Director");
    const text = await pdfText((await escConsentPdf(SAMPLE_FACTS, { owner: SIGNED.owner, ap: { name: `${rep.first_name} ${rep.last_name}`, role: rep.role, at: SIGNED.ap.at, phone: rep.phone, email: rep.email } })).bytes);
    expect(text).toContain("Director");
    expect(text).toContain("Chris Lowe");
    expect(text).not.toContain("AP representative,");
  });
});
