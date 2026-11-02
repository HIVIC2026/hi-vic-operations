// Regenerates src/lib/official-pdf-{piesa,piisa}.data.ts: the DEECA PIESA/PIISA blank forms as PDFs plus the measured box
// of every Word form field (hiv{n}, official-docx.core uniqueFieldNames order). BUILD-TIME ONLY (needs LibreOffice and
// poppler's pdftotext); never import this under src/. Task 12 draws text/ticks into the boxes with pdf-lib at run time.
//
// Method (LibreOffice 24.2 exports no PDF widgets for the legacy FORMTEXT/FORMCHECKBOX fields, so positions are measured):
//  1. Blank PDF  = soffice --convert-to pdf of the DEECA .docx "build copy": the untouched form with only the anchored
//     footer label and last-page logo frame repositioned (official-form-pdf-build.ts buildCopy, fix round 2 ruling).
//     Guard: its pdftotext -raw word sequence must equal the untouched form's conversion, word for word.
//  2. Marker PDF = the same .docx after uniqueFieldNames, every field shown as a short unique text marker "#n#" of about
//     the field's own width (text: the field's result replaced; checkbox: the box replaced by the marker squeezed to box
//     width with Word character scaling, so line height and wrapping stay the same), converted the same way.
//  3. Each marker's page + bounding box is read from the marker PDF (pdftotext -bbox) and stored in pt, PDF coordinates
//     (origin bottom-left of the page): {name, kind, page (0-based), x, y, w, h}.
//  4. Writes nothing if any field has no marker, a marker is found twice, or the page counts differ.
// Usage: bun scripts/official-form-blank-pdf.ts
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { OFFICIAL_TEMPLATES, type OfficialKey } from "../src/lib/official-forms.core";
import { docxFields, uniqueFieldNames } from "../src/lib/official-docx.core";
import { buildCopy, buildCopyDocument, rawWords, soffice } from "./official-form-pdf-build";

const ROOT = new URL("..", import.meta.url).pathname;
/** Word character scale (%) for checkbox markers: "#nnn#" squeezed to about the width of the box LibreOffice draws. */
const CHECK_SCALE = 41;
/** "#nnn#" is about 2.78 em wide in the forms' Arial; a text field's blank result is k en spaces (0.5 em each). */
const MARKER_EM = 2.78;
/** The form's own words may move at most this much (pt) between the blank and marker PDFs, else the boxes are not trusted. */
const MAX_SHIFT_PT = 1;

type FieldBox = { name: string; kind: "text" | "check"; page: number; x: number; y: number; w: number; h: number };

const runStart = (xml: string, idx: number) => {
  for (let i = xml.lastIndexOf("<w:r", idx); i >= 0; i = xml.lastIndexOf("<w:r", i - 1)) if (xml[i + 4] === ">" || xml[i + 4] === " ") return i;
  return -1;
};

/** Every field shown as "#n#": text fields keep the field and get the marker as their result; checkboxes are replaced by a squeezed marker run. */
function markerXml(xml: string): string {
  const edits: { start: number; end: number; text: string }[] = [];
  for (const f of docxFields(xml)) {
    const marker = `#${String(f.n).padStart(3, "0")}#`;
    if (f.kind === "text") {
      const result = xml.slice(f.resStart, f.resEnd);
      const shown = [...result.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]!).join("");
      const scale = /^\u2002+$/.test(shown) ? Math.round((shown.length * 0.5 * 100) / MARKER_EM) : 100;
      const rPr = (result.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? "<w:rPr></w:rPr>").replace("</w:rPr>", `<w:w w:val="${scale}"/></w:rPr>`);
      edits.push({ start: f.resStart, end: f.resEnd, text: `<w:r>${rPr}<w:t xml:space="preserve">${marker}</w:t></w:r>` });
    } else {
      const s = runStart(xml, f.begin);
      const endFld = xml.indexOf('w:fldCharType="end"', f.begin);
      const e = xml.indexOf("</w:r>", endFld) + "</w:r>".length;
      const slice = xml.slice(s, e);
      const keep = (slice.match(/<w:bookmark(?:Start|End)[^>]*\/>/g) ?? []).join("");
      const beginRPr = slice.match(/^<w:r[^>]*>(<w:rPr>[\s\S]*?<\/w:rPr>)?/)?.[1] ?? "<w:rPr></w:rPr>";
      const rPr = beginRPr.replace("</w:rPr>", `<w:w w:val="${CHECK_SCALE}"/></w:rPr>`);
      edits.push({ start: s, end: e, text: `${keep}<w:r>${rPr}<w:t xml:space="preserve">${marker}</w:t></w:r>` });
    }
  }
  let out = xml;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

type Word = { page: number; x0: number; y0: number; x1: number; y1: number; height: number; text: string };

/** Every word of a PDF with its box (pdftotext -bbox: top-left origin), page 0-based. */
function pdfWords(file: string): { pages: number; words: Word[] } {
  const r = spawnSync("pdftotext", ["-bbox", file, "-"], { encoding: "utf8", maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error(`pdftotext failed: ${r.stderr}`);
  const words: Word[] = [];
  let page = -1, height = 0;
  for (const line of r.stdout.split("\n")) {
    const pm = line.match(/<page width="([\d.]+)" height="([\d.]+)">/);
    if (pm) { page++; height = Number(pm[2]); continue; }
    const wm = line.match(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/);
    if (wm) words.push({ page, height, x0: Number(wm[1]), y0: Number(wm[2]), x1: Number(wm[3]), y1: Number(wm[4]), text: wm[5]! });
  }
  return { pages: page + 1, words };
}

const MARKER = /#(\d{3})#/g;
const round = (v: number) => Math.round(v * 100) / 100;

/** "#nnn#" markers: n → every place found, in pt, PDF coordinates (origin bottom-left). */
function findMarkers(words: Word[]): { found: Map<number, Omit<FieldBox, "name" | "kind">[]>; glued: string[] } {
  const found = new Map<number, Omit<FieldBox, "name" | "kind">[]>();
  const glued: string[] = [];
  for (const w of words) {
    for (const m of w.text.matchAll(MARKER)) {
      // A marker glued to neighbouring text: take its share of the word's width by character count.
      const whole = w.text === m[0];
      const per = (w.x1 - w.x0) / w.text.length;
      const x = whole ? w.x0 : w.x0 + per * m.index!;
      const width = whole ? w.x1 - w.x0 : per * m[0].length;
      if (!whole) glued.push(w.text);
      const n = Number(m[1]);
      found.set(n, [...(found.get(n) ?? []), { page: w.page, x: round(x), y: round(w.height - w.y1), w: round(width), h: round(w.y1 - w.y0) }]);
    }
  }
  return { found, glued };
}

/**
 * How far the form's own words moved between the blank and marker PDFs: each blank word is paired with the nearest
 * same-text word on the same page of the marker PDF. null if the two PDFs do not hold the same words on each page.
 */
function layoutShift(blank: Word[], marker: Word[]): { dx: number; dy: number; worst: string } | null {
  const own = marker.map((w) => ({ ...w, text: w.text.replace(MARKER, "") })).filter((w) => w.text);
  const bag = (ws: Word[]) => ws.map((w) => `${w.page}|${w.text}`).sort().join("\n");
  if (bag(own) !== bag(blank)) return null;
  let dx = 0, dy = 0, worst = "";
  for (const a of blank) {
    let best: { ex: number; ey: number } | null = null;
    for (const b of own) {
      if (b.page !== a.page || b.text !== a.text) continue;
      const ex = Math.abs(a.x0 - b.x0), ey = Math.abs(a.y1 - b.y1);
      if (!best || ex + ey < best.ex + best.ey) best = { ex, ey };
    }
    if (best!.ex + best!.ey > dx + dy) { dx = best!.ex; dy = best!.ey; worst = `"${a.text}" page ${a.page}`; }
  }
  return { dx: round(dx), dy: round(dy), worst };
}

for (const key of ["piesa", "piisa"] as OfficialKey[]) {
  const t = OFFICIAL_TEMPLATES[key];
  const bytes = new Uint8Array(readFileSync(join(ROOT, t.originalFile)));
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (sha !== t.sha256) throw new Error(`${key}: bundled original does not match the recorded SHA-256`);
  const parts = unzipSync(bytes);
  const named = uniqueFieldNames(strFromU8(parts["word/document.xml"]!));
  const fields = docxFields(named);
  const dir = mkdtempSync(join(tmpdir(), `blank-${key}-`));
  try {
    writeFileSync(join(dir, "untouched.docx"), bytes);
    soffice(dir, "untouched.docx");
    const copy = buildCopy(parts, strToU8, strFromU8);
    writeFileSync(join(dir, "blank.docx"), zipSync(copy));
    const blank = soffice(dir, "blank.docx");
    const before = rawWords(join(dir, "untouched.pdf")), after = rawWords(join(dir, "blank.pdf"));
    if (before.join(" ") !== after.join(" ")) throw new Error(`${key}: STOP — build-copy tweaks changed the form's words (${before.length} vs ${after.length})`);
    writeFileSync(join(dir, "marker.docx"), zipSync({ ...copy, "word/document.xml": strToU8(buildCopyDocument(markerXml(named))) }));
    soffice(dir, "marker.docx");
    const markerText = pdfWords(join(dir, "marker.pdf"));
    const blankText = pdfWords(join(dir, "blank.pdf"));
    const pages = markerText.pages;
    const { found, glued } = findMarkers(markerText.words);
    const blankPages = (await PDFDocument.load(blank)).getPageCount();
    const shift = layoutShift(blankText.words, markerText.words);
    const problems: string[] = [];
    if (pages !== blankPages) problems.push(`marker PDF has ${pages} pages, blank PDF ${blankPages}`);
    if (!shift) problems.push("the form's own words differ between the blank and marker PDFs (markers reflowed the layout)");
    else if (shift.dy > MAX_SHIFT_PT || shift.dx > MAX_SHIFT_PT) problems.push(`markers moved the form's own words by up to ${shift.dx} pt across / ${shift.dy} pt down (worst ${shift.worst}); limit ${MAX_SHIFT_PT} pt`);
    const boxes: FieldBox[] = [];
    for (const f of fields) {
      const at = found.get(f.n) ?? [];
      if (at.length !== 1) { problems.push(`hiv${f.n}: marker found ${at.length} times`); continue; }
      boxes.push({ name: `hiv${f.n}`, kind: f.kind, ...at[0]! });
    }
    for (const n of found.keys()) if (n >= fields.length) problems.push(`unexpected marker #${n}#`);
    if (problems.length) throw new Error(`${key}: STOP — not writing anything:\n  ${problems.join("\n  ")}`);
    const out = `// GENERATED by \`bun scripts/official-form-blank-pdf.ts\` from the bundled DEECA ${key.toUpperCase()} Word form — do not edit by hand.
// ${key.toUpperCase()} blank PDF (LibreOffice conversion of the form's build copy: footer label + last-page logos repositioned, words unchanged) and the measured box of every form field hiv{n}.
// sourceSha256 = SHA-256 of the DEECA .docx. Boxes are in pt, PDF coordinates (origin bottom-left of the page), page 0-based.
export type FieldBox = { name: string; kind: "text" | "check"; page: number; x: number; y: number; w: number; h: number };
export const OFFICIAL_BLANK_PDF: { sourceSha256: string; fieldCount: number; pdfBase64: string; fields: FieldBox[] } = {
  sourceSha256: ${JSON.stringify(sha)},
  fieldCount: ${fields.length},
  fields: [
${boxes.map((b) => `    ${JSON.stringify(b)},`).join("\n")}
  ],
  pdfBase64: ${JSON.stringify(Buffer.from(blank).toString("base64"))},
};
`;
    writeFileSync(join(ROOT, `src/lib/official-pdf-${key}.data.ts`), out);
    console.log(`${key}: ${fields.length} fields measured on ${pages} pages, blank PDF ${blank.length} bytes, layout shift ≤ ${shift!.dx} pt across / ${shift!.dy} pt down (worst ${shift!.worst})${glued.length ? `; ${glued.length} markers glued to text (width shared by characters): ${glued.join(" ")}` : ""}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
