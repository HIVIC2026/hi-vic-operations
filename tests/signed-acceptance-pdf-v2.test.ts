import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument } from "pdf-lib";
import { CUSTOMER_AGREEMENT_V1_3 } from "../src/lib/customer-agreement.core";
import { ACCEPTANCE_TICKS, AP_COUNTERSIGNER, formatSignedAt, type SignedAcceptanceInput } from "../src/lib/signed-acceptance.core";
import { signedAcceptancePdfV2 } from "../src/lib/signed-pdf.server";

const pdfText = async (b: Uint8Array) => {
  const d = await getDocument({ data: b.slice() }).promise; const out: string[] = [];
  for (let i = 1; i <= d.numPages; i++) out.push((await (await d.getPage(i)).getTextContent()).items.map((x: any) => x.str).join(" "));
  return out;
};
// Labels are drawn in capitals with letter spacing, so compare without case or spaces.
const flat = (s: string) => s.toLowerCase().replace(/\s+/g, "");

const SAMPLE: SignedAcceptanceInput = {
  jobNumber: "HV-1234", installerName: "Rapid Insulation", ownerName: "Sarah Brown", ownerTypedName: "Sarah Brown",
  address: "12 Example St, Box Hill VIC 3128", signedAt: "2026-11-08T08:42:00.000Z", validUntil: "Mon 8 Dec 2026",
  quoteLine: "Bradford Gold R5.0 ceiling batts, 137 m², supplied and installed",
  priceBeforeRebate: 3798, rebate: 1610, yourPrice: 2188, removalM2: 40,
  agreement: {
    version: "1.3", approvedOn: "2 Nov 2026", body: CUSTOMER_AGREEMENT_V1_3,
    facts: {
      owner_name: "Sarah Brown", address: "12 Example St, Box Hill VIC 3128", job_number: "HV-1234", installer_name: "Rapid Insulation",
      installer_phone: "03 9000 0000", installer_email: "office@rapidinsulation.com.au", product: "Bradford Gold R5.0 ceiling batts", area_m2: "137",
      price_before_rebate: "$3,798.00", rebate: "$1,610.00", your_price: "$2,188.00", valid_until: "Mon 8 Dec 2026",
      safety_check: "$349", deposit: "$183.90", rest: "$1,655.10",
    },
  },
};

describe("signed acceptance PDF v2", () => {
  test("exact tick wording", () => {
    expect(ACCEPTANCE_TICKS).toEqual([
      "I accept this quote, the Customer Agreement and the payment terms, and I've been given my Statement of rights under the VEU program. I'm 18 or over, I own this home (or I'm allowed to sign for the owner), and I'm happy to get my documents by email.",
      "I understand my install must be done within 30 days of my electrical safety check (PIESA), as the rebate rules require.",
    ]);
    expect(AP_COUNTERSIGNER).toEqual({ name: "Chris Lowe", role: "Director, DC Construction Solutions Pty Ltd" });
  });
  test("Melbourne date and time wording", () => {
    expect(formatSignedAt("2026-11-08T08:42:00.000Z")).toEqual({ long: "Sun 8 Nov 2026, 7:42pm", short: "8 Nov 2026, 7:42pm" });
    expect(formatSignedAt("2026-07-01T02:05:00.000Z").short).toBe("1 Jul 2026, 12:05pm");
  });
  test("5 pages; page 1 has the quote, scope lines, both ticks and both signatures", async () => {
    const r = await signedAcceptancePdfV2(SAMPLE);
    expect(r.layout.pages).toBe(5);
    expect(r.layout.split).toEqual([]);
    const [p1] = await pdfText(r.bytes);
    for (const s of ["Signed acceptance of your quote", "Signed online on Sun 8 Nov 2026, 7:42pm (Melbourne time)", "Yes, 40 m²", "Not included. Your electrician quotes these if the safety check finds any.",
      "How you pay: $349 now for the electrical safety check (PIESA). 10% to book your install day. The rest on install day.", AP_COUNTERSIGNER.name, AP_COUNTERSIGNER.role,
      "Version 1.3, 2 Nov 2026", "Bradford Gold R5.0 ceiling batts, 137 m², supplied and installed", "$3,798.00", "$1,610.00", "$2,188.00", "What Sarah agreed to",
      ...ACCEPTANCE_TICKS, "Sarah Brown", "8 Nov 2026, 7:42pm"]) expect(flat(p1!)).toContain(flat(s));
    for (const s of ["Old insulation removal", "Electrical upgrades", "Owner signature (typed online)", "Signed for Home Insulation Victoria", "Customer Agreement and payment terms"]) expect(flat(p1!)).toContain(flat(s));
    // Everything on page 1 stays on page 1; the agreement starts on page 2 and the payment terms on page 5.
    const p1Blocks = Object.entries(r.layout.blockPage).filter(([id]) => id.startsWith("a-"));
    expect(p1Blocks.length).toBeGreaterThan(5);
    expect(p1Blocks.every(([, pg]) => pg === 1)).toBe(true);
    expect(r.layout.blockPage["payment-terms"]).toBe(5);
  });
  test("signed box and agreement text", async () => {
    const pages = await pdfText((await signedAcceptancePdfV2(SAMPLE)).bytes);
    expect(pages[1]).toContain("Your ceiling insulation upgrade");
    expect(pages[1]).toContain("Install Bradford Gold R5.0 ceiling batts across 137 m² of your ceiling, as in your quote.");
    expect(pages[3]).toContain("Signed by Sarah Brown (typed name: Sarah Brown) on the quote page on 8 Nov 2026, 7:42pm.");
    expect(pages[3]).toContain("Version 1.3, 2 Nov 2026");
    expect(flat(pages[4]!)).toContain(flat("PAYMENT TERMS"));
    expect(pages.slice(1).join(" ")).not.toMatch(/Version 1\.3 /); // the plain version line is replaced by the signed box
  });
  test("no removal prints No", async () => {
    const t = (await pdfText((await signedAcceptancePdfV2({ ...SAMPLE, removalM2: null })).bytes))[0]!;
    expect(flat(t)).toMatch(/oldinsulationremovalno/);
  });
  test("a typed name that differs from the owner name is printed in both places", async () => {
    const pages = await pdfText((await signedAcceptancePdfV2({ ...SAMPLE, ownerTypedName: "Sarah B Brown" })).bytes);
    expect(pages[0]).toContain("Sarah B Brown");
    expect(pages[3]).toContain("(typed name: Sarah B Brown)");
  });
  test("signature names use the bold italic font; no lawyer wording anywhere", async () => {
    const r = await signedAcceptancePdfV2(SAMPLE);
    const raw = Buffer.from(r.bytes).toString("latin1");
    expect(raw).not.toMatch(/lawyer/i);
    expect((await pdfText(r.bytes)).join(" ")).not.toMatch(/lawyer/i);
    const doc = await PDFDocument.load(r.bytes);
    expect(`${doc.getTitle()} ${doc.getSubject() ?? ""} ${doc.getAuthor() ?? ""}`).not.toMatch(/lawyer/i);
    const d = await getDocument({ data: r.bytes.slice() }).promise;
    const pg = await d.getPage(1); const tc = await pg.getTextContent(); await pg.getOperatorList();
    const fontOf = (s: string) => { const it: any = tc.items.find((x: any) => x.str === s); return it ? String(pg.commonObjs.get(it.fontName)?.name ?? "") : ""; };
    expect(fontOf("Chris Lowe")).toMatch(/Italic/i);
  });
  test("a bad quote-time detail stops the document", async () => {
    await expect(signedAcceptancePdfV2({ ...SAMPLE, agreement: { ...SAMPLE.agreement, facts: { ...SAMPLE.agreement.facts, rest: "" } } })).rejects.toThrow(/Missing agreement detail: rest/);
  });
  test("flag off keeps the old builder", () => {
    const src = readFileSync("src/lib/assignment.server.ts", "utf8");
    expect(src).toMatch(/PDF_LOOK_APPROVED\.signedAcceptance\s*\?\s*.*signedAcceptancePdfV2[\s\S]*:\s*.*signedAcceptancePdf\(/);
  });
});

describe("signed acceptance helpers", () => {
  test("payment split: safety check, 10% of the rest, remainder", async () => {
    const { paymentSplitCents, formatValidUntil } = await import("../src/lib/signed-acceptance.core");
    expect(paymentSplitCents(218800, 34900)).toEqual({ safety: 34900, deposit: 18390, rest: 165510 });
    expect(paymentSplitCents(20000, 34900)).toEqual({ safety: 20000, deposit: 0, rest: 0 });
    expect(formatValidUntil(new Date("2026-12-08T12:00:00Z"))).toBe("Tue 8 Dec 2026");
  });
});

describe("legacy PDF path stays light (I2)", () => {
  test("signed-pdf.server has no static import of the new PDF kit (pdf-look.server, customer-agreement-pdf.server, fontkit)", () => {
    const src = readFileSync(new URL("../src/lib/signed-pdf.server.ts", import.meta.url), "utf8");
    const staticImports = src.split("\n").filter((l) => /^\s*import\s(?!type\b)/.test(l));
    for (const mod of ["pdf-look.server", "customer-agreement-pdf.server", "@pdf-lib/fontkit"]) {
      expect(staticImports.filter((l) => l.includes(mod)), mod).toEqual([]);
    }
  });
});
