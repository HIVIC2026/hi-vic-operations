// Task 11: DEECA blank forms as PDFs plus the measured box of every Word form field (made at build time by
// scripts/official-form-blank-pdf.ts; LibreOffice exports no widgets for the legacy fields, so positions are measured).
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { OPS, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { OFFICIAL_TEMPLATES, type OfficialKey } from "../src/lib/official-forms.core";
import { docxFields } from "../src/lib/official-docx.core";
import { OFFICIAL_BLANK_PDF as piesa } from "../src/lib/official-pdf-piesa.data";
import { OFFICIAL_BLANK_PDF as piisa } from "../src/lib/official-pdf-piisa.data";
import { rawWords, soffice } from "../scripts/official-form-pdf-build";

type Box = { x0: number; y0: number; x1: number; y1: number };
const meets = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const union = (bs: Box[]): Box => ({ x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)), x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)) });
/** Text below this height (pt from the page bottom) is footer: body text ends at the 42.5 pt bottom margin. */
const FOOTER_TOP = 40;
const hasSoffice = spawnSync("soffice", ["--version"]).status === 0;

/** The "OFFICIAL" label box and the footer line box ("VEU … page number") on a page, in PDF coordinates. */
async function footerBoxes(page: any): Promise<{ label: Box; footer: Box | null }> {
  const items = (await page.getTextContent()).items.filter((i: any) => i.str?.trim() && i.transform[5] < FOOTER_TOP);
  const box = (i: any): Box => ({ x0: i.transform[4], y0: i.transform[5] - 0.25 * i.height, x1: i.transform[4] + i.width, y1: i.transform[5] + i.height });
  const label = items.filter((i: any) => i.str.trim() === "OFFICIAL");
  expect(label.length).toBe(1);
  const rest = items.filter((i: any) => i.str.trim() !== "OFFICIAL");
  return { label: box(label[0]), footer: rest.length ? union(rest.map(box)) : null };
}

/**
 * Everything painted on a page: filled/stroked paths and images (the vector logos included), each with its bounding box,
 * whether it is white, and whether it is painted after the "OFFICIAL" label text (so would cover it).
 */
async function paintedBoxes(page: any): Promise<{ box: Box; white: boolean; afterLabel: boolean }[]> {
  const ol = await page.getOperatorList();
  type M = number[];
  const mul = (m: M, n: M): M => [m[0]! * n[0]! + m[2]! * n[1]!, m[1]! * n[0]! + m[3]! * n[1]!, m[0]! * n[2]! + m[2]! * n[3]!, m[1]! * n[2]! + m[3]! * n[3]!, m[0]! * n[4]! + m[2]! * n[5]! + m[4]!, m[1]! * n[4]! + m[3]! * n[5]! + m[5]!];
  const map = (m: M, x0: number, y0: number, x1: number, y1: number): Box => {
    const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [m[0]! * x! + m[2]! * y! + m[4]!, m[1]! * x! + m[3]! * y! + m[5]!]);
    return { x0: Math.min(...pts.map((p) => p[0]!)), y0: Math.min(...pts.map((p) => p[1]!)), x1: Math.max(...pts.map((p) => p[0]!)), y1: Math.max(...pts.map((p) => p[1]!)) };
  };
  const white = (c: any) => c && c[0] >= 250 && c[1] >= 250 && c[2] >= 250;
  let ctm: M = [1, 0, 0, 1, 0, 0], fill: any = [0, 0, 0], stroke: any = [0, 0, 0], path: Box | null = null;
  const stack: { ctm: M; fill: any; stroke: any }[] = [];
  const out: { box: Box; white: boolean; afterLabel: boolean }[] = [];
  let labelSeen = false;
  const FILLS = new Set([OPS.fill, OPS.eoFill]), STROKES = new Set([OPS.stroke, OPS.closeStroke]), BOTH = new Set([OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  ol.fnArray.forEach((fn: number, i: number) => {
    const a = ol.argsArray[i];
    if (fn === OPS.save) stack.push({ ctm, fill, stroke });
    else if (fn === OPS.restore) ({ ctm, fill, stroke } = stack.pop() ?? { ctm, fill, stroke });
    else if (fn === OPS.transform) ctm = mul(ctm, a);
    else if (fn === OPS.paintFormXObjectBegin && a[0]) ctm = mul(ctm, a[0]);
    else if (fn === OPS.setFillRGBColor) fill = a;
    else if (fn === OPS.setStrokeRGBColor) stroke = a;
    else if (fn === OPS.constructPath) { const mm = a[2]; path = mm ? map(ctm, mm[0], mm[1], mm[2], mm[3]) : null; }
    else if (fn === OPS.showText && a[0].map((g: any) => g?.unicode ?? "").join("") === "OFFICIAL") labelSeen = true;
    else if (path && FILLS.has(fn)) out.push({ box: path, white: white(fill), afterLabel: labelSeen });
    else if (path && STROKES.has(fn)) out.push({ box: path, white: white(stroke), afterLabel: labelSeen });
    else if (path && BOTH.has(fn)) out.push({ box: path, white: white(fill) && white(stroke), afterLabel: labelSeen });
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) out.push({ box: map(ctm, 0, 0, 1, 1), white: false, afterLabel: labelSeen });
  });
  return out;
}

const docx = (k: OfficialKey) => unzipSync(new Uint8Array(readFileSync(OFFICIAL_TEMPLATES[k].originalFile)));
const flat = (s: string) => s.replace(/\s+/g, " ");
const docxText = (k: OfficialKey) => flat([...strFromU8(docx(k)["word/document.xml"]!).matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(""));
/** Page count Word recorded when DEECA saved the form (docProps/app.xml). */
const wordPages = (k: OfficialKey) => Number(strFromU8(docx(k)["docProps/app.xml"]!).match(/<Pages>(\d+)<\/Pages>/)![1]);

// Blank PDFs are converted from a "build copy" of the DEECA form: only the anchored footer "OFFICIAL" label and the
// last-page logo frame are moved (scripts/official-form-pdf-build.ts). These tests prove nothing else changed and that
// the moves removed the overlaps.
// LibreOffice paginates the PIESA one page longer than Word did (Part 2 starts page 2, B1 alone on page 5): 8 vs Word's
// recorded 7, with or without the font replacements (the gap is layout, not fonts). Wording and boxes are unaffected;
// pinned so a change in either count fails loudly. PIISA matches Word.
const LIBREOFFICE_EXTRA_PAGES: Record<OfficialKey, number> = { piesa: 1, piisa: 0 };

const HEADINGS: Record<OfficialKey, string[]> = {
  piesa: ["Section A – Initial electrical safety assessment", "PART 2 – MAINS POWER", "PART 7 – IDENTIFYING POTENTIAL HAZARDS IN CEILING SPACE", "Section C – Completed Pre-Installation Electrical Safety Assessment", "Property Owner / Owner’s Representative Declaration"],
  piisa: ["PART 1 – PROPERTY DETAILS", "PART 3 – SAFE SYSTEM OF WORK", "PART 8 – INSTALLER DECLARATION", "Table 1: Common hazards and guidance resources when installing insulation"],
};

for (const [key, data] of [["piesa", piesa], ["piisa", piisa]] as const) {
  const bytes = new Uint8Array(Buffer.from(data.pdfBase64, "base64"));

  test(`${key}: made from the bundled DEECA form`, async () => {
    expect(data.sourceSha256).toBe(OFFICIAL_TEMPLATES[key].sha256);
    expect(createHash("sha256").update(readFileSync(OFFICIAL_TEMPLATES[key].originalFile)).digest("hex")).toBe(data.sourceSha256);
  });

  test(`${key}: one measured box per form field, on a real page, with a positive size`, async () => {
    const fields = docxFields(strFromU8(docx(key)["word/document.xml"]!));
    expect(data.fieldCount).toBe(fields.length);
    expect(data.fields.map((f) => f.name)).toEqual(fields.map((f) => `hiv${f.n}`));
    const pdf = await PDFDocument.load(bytes);
    for (const [i, box] of data.fields.entries()) {
      expect(box.kind).toBe(fields[i]!.kind);
      expect(box.page).toBeGreaterThanOrEqual(0);
      expect(box.page).toBeLessThan(pdf.getPageCount());
      expect(box.w).toBeGreaterThan(0);
      expect(box.h).toBeGreaterThan(0);
      const { width, height } = pdf.getPage(box.page).getSize();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(width);
      expect(box.y + box.h).toBeLessThanOrEqual(height);
    }
  });

  test(`${key}: blank PDF has the DEECA form's pages and its wording`, async () => {
    const doc = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
    expect(doc.numPages).toBe(wordPages(key) + LIBREOFFICE_EXTRA_PAGES[key]);
    let text = "";
    for (let p = 1; p <= doc.numPages; p++) text += " " + (await (await doc.getPage(p)).getTextContent()).items.map((i) => ("str" in i ? i.str + (i.hasEOL ? " " : "") : "")).join("");
    // The footer classification label prints whole on every page (Inter, the default fallback for Aptos, wrapped it to "OFFICIA / L").
    for (let p = 1; p <= doc.numPages; p++) {
      const items = (await (await doc.getPage(p)).getTextContent()).items.map((i) => ("str" in i ? i.str.trim() : ""));
      expect(items).toContain("OFFICIAL");
      expect(items).not.toContain("OFFICIA");
    }
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const { label, footer } = await footerBoxes(page);
      if (footer) expect(meets(label, footer)).toBe(false);
      if (p === doc.numPages) {
        // Last page: the footer line must not cross the logos (or any other drawing), and the label must not be painted over.
        expect(footer).not.toBeNull();
        const drawn = await paintedBoxes(page);
        expect(drawn.filter((d) => !d.white).length).toBeGreaterThan(50); // the two vector logos are hundreds of paths
        expect(drawn.filter((d) => !d.white && meets(d.box, footer!)).map((d) => d.box)).toEqual([]);
        expect(drawn.filter((d) => d.afterLabel && meets(d.box, label)).map((d) => d.box)).toEqual([]);
      }
    }
    for (const h of HEADINGS[key]) {
      expect(docxText(key)).toContain(h);
      expect(flat(text)).toContain(h);
    }
  });

  test.skipIf(!hasSoffice)(`${key}: same words in the same order as the untouched DEECA form's conversion`, () => {
    const dir = mkdtempSync(join(tmpdir(), `words-${key}-`));
    try {
      writeFileSync(join(dir, "untouched.docx"), readFileSync(OFFICIAL_TEMPLATES[key].originalFile));
      soffice(dir, "untouched.docx");
      writeFileSync(join(dir, "blank.pdf"), bytes);
      const before = rawWords(join(dir, "untouched.pdf"));
      expect(before.length).toBeGreaterThan(1000);
      expect(rawWords(join(dir, "blank.pdf"))).toEqual(before);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);
}
