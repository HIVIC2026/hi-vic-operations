import { describe, expect, test } from "bun:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDF_PAGE, PDF_FOOTER_LEFT, paginate } from "../src/lib/pdf-look.core";
import { renderPdf } from "../src/lib/pdf-look.server";
import { PDF_LOOK_APPROVED } from "../src/lib/pdf-approvals.core";
const text = async (b: Uint8Array) => { const d = await getDocument({ data: b }).promise; const out: string[] = []; for (let i = 1; i <= d.numPages; i++) out.push((await (await d.getPage(i)).getTextContent()).items.map((x: any) => x.str).join(" ")); return out; };

describe("pdf-look kit", () => {
  test("page size and footer", async () => {
    const { bytes, layout } = await renderPdf({ title: "T", blocks: [{ id: "h", kind: "header", eyebrow: "RECEIPT · JOB HV-1234" }, { id: "p", kind: "para", text: "Thanks, Sarah" }] });
    const { PDFDocument } = await import("pdf-lib");
    const p = (await PDFDocument.load(bytes)).getPage(0).getSize();
    expect([p.width, p.height]).toEqual([450, 636.96]);
    const [t1] = await text(bytes);
    expect(t1).toContain("DC Construction Solutions Pty Ltd");
    expect(t1).toContain(PDF_FOOTER_LEFT);
    expect(t1).toContain("Page 1 of 1");
    expect(layout.topBarPages).toEqual([1]);
  });
  test("a section that doesn't fit moves whole to the next page", () => {
    const space = PDF_PAGE.height - PDF_PAGE.top - PDF_PAGE.bottom;
    const r = paginate([{ id: "a", height: space - 50, keepTogether: true }, { id: "b", height: 120, keepTogether: true }], space, space);
    expect(r).toEqual([{ page: 1, id: "a" }, { page: 2, id: "b" }]);
  });
  test("oversized section splits at child boundaries", () => {
    const space = 500;
    const r = paginate([{ id: "big", height: 900, keepTogether: true, childHeights: [300, 300, 300] }], space, space);
    expect(r).toEqual([{ page: 1, id: "big", part: 0 }, { page: 2, id: "big", part: 1 }, { page: 3, id: "big", part: 2 }]);
  });
  test("characters outside the font never throw", async () => {
    const { bytes } = await renderPdf({ title: "T", blocks: [{ id: "p", kind: "para", text: "Sarah 🏠 O’Brien – 137 m² ✓" }] });
    expect((await text(bytes))[0]).toContain("O’Brien");
  });
  test("every swap flag starts off", () => {
    expect(Object.keys(PDF_LOOK_APPROVED).sort()).toEqual(["escConsent", "officialFormPdf", "receipts", "signedAcceptance", "taxInvoice", "veecForm"]);
    expect(Object.values(PDF_LOOK_APPROVED).every((v) => v === false)).toBe(true);
  });
});
