// Task 11: DEECA blank forms as PDFs plus the measured box of every Word form field (made at build time by
// scripts/official-form-blank-pdf.ts; LibreOffice exports no widgets for the legacy fields, so positions are measured).
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { OFFICIAL_TEMPLATES, type OfficialKey } from "../src/lib/official-forms.core";
import { docxFields } from "../src/lib/official-docx.core";
import { OFFICIAL_BLANK_PDF as piesa } from "../src/lib/official-pdf-piesa.data";
import { OFFICIAL_BLANK_PDF as piisa } from "../src/lib/official-pdf-piisa.data";

const docx = (k: OfficialKey) => unzipSync(new Uint8Array(readFileSync(OFFICIAL_TEMPLATES[k].originalFile)));
const flat = (s: string) => s.replace(/\s+/g, " ");
const docxText = (k: OfficialKey) => flat([...strFromU8(docx(k)["word/document.xml"]!).matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(""));
/** Page count Word recorded when DEECA saved the form (docProps/app.xml). */
const wordPages = (k: OfficialKey) => Number(strFromU8(docx(k)["docProps/app.xml"]!).match(/<Pages>(\d+)<\/Pages>/)![1]);

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
    for (const h of HEADINGS[key]) {
      expect(docxText(key)).toContain(h);
      expect(flat(text)).toContain(h);
    }
  });
}
