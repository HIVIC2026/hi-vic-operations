import { describe, expect, test } from "bun:test";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDF_PAGE, PDF_FOOTER_LEFT, paginate, type PdfBlock, type PdfDoc } from "../src/lib/pdf-look.core";
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
    const t = (await text(bytes))[0]!;
    expect(t).toContain("O’Brien");
    expect(t).not.toContain("🏠");
    expect(t).toContain("Sarah ? O’Brien");
  });
  test("every swap flag starts off", () => {
    expect(Object.keys(PDF_LOOK_APPROVED).sort()).toEqual(["escConsent", "officialFormPdf", "receipts", "signedAcceptance", "taxInvoice", "veecForm"]);
    expect(Object.values(PDF_LOOK_APPROVED).every((v) => v === false)).toBe(true);
  });

  test("keepTogether false lets a block start on the current page and flow; default moves it whole", () => {
    const space = 500;
    const mk = (keepTogether: boolean) => paginate([{ id: "a", height: 300, keepTogether: true }, { id: "b", height: 300, keepTogether, childHeights: [150, 150] }], space, space);
    expect(mk(true)).toEqual([{ page: 1, id: "a" }, { page: 2, id: "b" }]);
    expect(mk(false)).toEqual([{ page: 1, id: "a" }, { page: 1, id: "b", part: 0 }, { page: 2, id: "b", part: 1 }]);
    // No children to split at: moves whole whatever the flag says.
    expect(paginate([{ id: "a", height: 300, keepTogether: true }, { id: "b", height: 300, keepTogether: false }], space, space)).toEqual([{ page: 1, id: "a" }, { page: 2, id: "b" }]);
  });
});

// ---- real render paths -----------------------------------------------------------------------------------------------
const para = (id: string, label: string): PdfBlock => ({ id, kind: "para", text: `${label} ${"lorem ipsum dolor sit amet ".repeat(22)}` });
const PNG_1PX = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const pageItems = async (b: Uint8Array) => { const d = await getDocument({ data: b }).promise; const out: { str: string; y: number }[][] = []; for (let i = 1; i <= d.numPages; i++) out.push((await (await d.getPage(i)).getTextContent()).items.map((x: any) => ({ str: x.str as string, y: x.transform[5] as number }))); return out; };
const contentOf = async (b: Uint8Array, n: number) => {
  const { PDFDocument, PDFRawStream, decodePDFRawStream } = await import("pdf-lib");
  const doc = await PDFDocument.load(b);
  const c = doc.getPage(n).node.Contents()!;
  const streams = "asArray" in c ? (c as any).asArray().map((r: any) => doc.context.lookup(r)) : [c];
  return streams.map((s: any) => (s instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(s).decode()).toString("latin1") : "")).join("\n");
};
const BLUE = /0\.2[34]\d* 0\.31\d* 0\.7[67]\d* rg/;

describe("pdf-look kit: rendered multi-page", () => {
  const doc = {
    title: "Multi",
    blocks: [
      { id: "h", kind: "header", eyebrow: "TEST" },
      { id: "big", kind: "section", number: "1", title: "BIGSECTION", children: Array.from({ length: 9 }, (_, i) => para(`big-${i}`, `BIGCHILD${i}`)) },
      { id: "before-break", kind: "para", text: "BEFOREBREAK" },
      { id: "pb", kind: "pageBreak" },
      { id: "after-break", kind: "para", text: "AFTERBREAK" },
      { id: "pic", kind: "image", bytes: PNG_1PX, width: 20, height: 20 },
      { id: "bigbox", kind: "box", children: Array.from({ length: 9 }, (_, i) => para(`box-${i}`, `BOXCHILD${i}`)) },
      { id: "sig", kind: "signature", label: "Signed", name: "Chris Lowe", at: "2 Nov 2026" },
    ] as PdfBlock[],
  };

  test("top bar on page 1 only, same top margin later, footer on every page, splits and images reported", async () => {
    const { bytes, layout } = await renderPdf(doc);
    expect(layout.pages).toBeGreaterThanOrEqual(4);
    expect(layout.topBarPages).toEqual([1]);
    expect(layout.split).toEqual(["big", "bigbox"]);
    // Top bar drawn in page 1's content only.
    expect(BLUE.test(await contentOf(bytes, 0))).toBe(true);
    for (let n = 1; n < layout.pages; n++) expect(/0\.2[34]\d* 0\.31\d* 0\.7[67]\d* rg\s+[\d.]+ [\d.]+ 450 6 re/.test(await contentOf(bytes, n))).toBe(false);

    const pages = await pageItems(bytes);
    pages.forEach((items, i) => expect(items.map((x) => x.str).join(" ")).toContain(`Page ${i + 1} of ${layout.pages}`));

    // Pages 2.. start with a paragraph (continued section children): same top margin, to the point.
    const tops = pages.slice(1, 3).map((items) => Math.max(...items.filter((x) => !x.str.startsWith("Page ") && x.str !== PDF_FOOTER_LEFT).map((x) => x.y)));
    expect(Math.abs(tops[0]! - tops[1]!)).toBeLessThan(0.5);
    expect(tops[0]!).toBeGreaterThan(PDF_PAGE.height - PDF_PAGE.top - 12);

    // Split section: heading on its first page, each child on exactly one page, in order, over several pages.
    const where = (marker: string) => { const hits = pages.map((it, i) => (it.some((x) => x.str.includes(marker)) ? i + 1 : 0)).filter(Boolean); expect(hits.length).toBe(1); return hits[0]!; };
    const bigPages = Array.from({ length: 9 }, (_, i) => where(`BIGCHILD${i}`));
    expect(bigPages).toEqual([...bigPages].sort((a, b) => a - b));
    expect(new Set(bigPages).size).toBeGreaterThan(1);
    expect(where("BIGSECTION")).toBe(bigPages[0]!);
    expect(layout.blockPage["big"]).toBe(bigPages[0]!);
    const boxPages = Array.from({ length: 9 }, (_, i) => where(`BOXCHILD${i}`));
    expect(boxPages).toEqual([...boxPages].sort((a, b) => a - b));
    expect(new Set(boxPages).size).toBeGreaterThan(1);
    expect(layout.blockPage["bigbox"]).toBe(boxPages[0]!);

    // pageBreak: the block after it starts a later page than the block before it.
    expect(where("AFTERBREAK")).toBeGreaterThan(where("BEFOREBREAK"));
    expect(layout.blockPage["after-break"]).toBe(where("AFTERBREAK"));

    // Image report (logo excluded).
    expect(layout.images).toEqual([{ block: "pic", page: layout.blockPage["pic"]! }]);
  });

  test("keepTogether false flows a section from the current page; default moves it whole", async () => {
    const filler: PdfBlock = para("fill", "FILL");
    const mk = (keepTogether: boolean): PdfDoc => ({ title: "K", blocks: [filler, filler, { ...filler, id: "fill2" }, { id: "s", kind: "section", title: "S", keepTogether, children: [para("s0", "S0"), para("s1", "S1"), para("s2", "S2"), para("s3", "S3"), para("s4", "S4"), para("s5", "S5")] }] });
    const whole = await renderPdf(mk(true));
    const flowing = await renderPdf(mk(false));
    expect(whole.layout.split).toEqual([]);
    expect(flowing.layout.split).toEqual(["s"]);
    expect(flowing.layout.blockPage["s"]).toBe(1);
    expect(whole.layout.blockPage["s"]).toBe(2);
  });

  test("signature names use the embedded Open Sans bold italic face", async () => {
    const { bytes } = await renderPdf({ title: "S", blocks: [{ id: "sig", kind: "signature", label: "Signed", name: "Chris Lowe", at: "2 Nov" }] });
    const { PDFDocument, PDFName, PDFDict } = await import("pdf-lib");
    const ctx = (await PDFDocument.load(bytes)).context;
    const names = ctx.enumerateIndirectObjects().flatMap(([, o]) => (o instanceof PDFDict && o.get(PDFName.of("FontName")) ? [String(o.get(PDFName.of("FontName")))] : []));
    expect(names.some((n) => /Bold-?Italic/i.test(n))).toBe(true);
  });
});
