// Regenerates src/lib/official-pdf-areas.data.ts: for every TEXT field box of the DEECA PIESA/PIISA blank PDFs
// (official-pdf-{piesa,piisa}.data.ts), the largest free rectangle the filled text may use, measured from the blank itself.
// BUILD-TIME ONLY (pdfjs); never import this under src/. official-form-pdf.server.ts draws inside these areas at run time.
//
// Method (Task 12 ruling: long text shrinks to 6 pt, then wraps to the right edge of its table cell / the page margin, never
// over DEECA's printed text):
//  1. Obstacles on each page = every printed text item (its line box), every stroked path and every filled path that is not a
//     light background (cell borders, rules, the blue section bars), every image, and every OTHER field box.
//     Paths that contain the field box itself (page and cell backgrounds) are not obstacles for that field.
//  2. Right edge = the first obstacle to the right on the field's own line, else the page's right text margin.
//  3. Top / bottom = the nearest obstacle above / below that overlaps the field's [left, right] span, else the page's
//     top / bottom text margin. Every edge keeps a 1 pt gap (1.5 pt on the right).
//  4. "b3.signature" (PIESA Part B3 prints no signature box): the free band below the B3 declaration's own line and the rule
//     under it, down to the next obstacle or the bottom text margin.
// Usage: bun scripts/official-form-pdf-areas.ts   (then: bun test tests/official-form-pdf.test.ts)
import { writeFileSync } from "node:fs";
import { OPS, getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { OfficialKey } from "../src/lib/official-forms.core";
import { OFFICIAL_BLANK_PDF as piesa, type FieldBox } from "../src/lib/official-pdf-piesa.data";
import { OFFICIAL_BLANK_PDF as piisa } from "../src/lib/official-pdf-piisa.data";

export type Box = { x0: number; y0: number; x1: number; y1: number };
export const BLANKS = { piesa, piisa } as const;
/** The forms' text margins (pt): body text sits inside 42.5 pt on every side; the footer is below the bottom one. */
export const MARGIN = 42.5;
const GAP = 1, GAP_RIGHT = 1.5;
const r2 = (n: number) => Math.round(n * 100) / 100;
const fieldBox = (f: FieldBox): Box => ({ x0: f.x, y0: f.y, x1: f.x + f.w, y1: f.y + f.h });
const contains = (o: Box, i: Box) => o.x0 <= i.x0 + 0.5 && o.y0 <= i.y0 + 0.5 && o.x1 >= i.x1 - 0.5 && o.y1 >= i.y1 - 0.5;
const overlapX = (a: Box, b: Box) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5;
const overlapY = (a: Box, b: Box) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5;
/** A fill this light is a cell/page background, not something text could cover up. */
const light = (hex: unknown) => {
  if (typeof hex !== "string" || !/^#[0-9a-f]{6}$/i.test(hex)) return false;
  return [1, 3, 5].every((i) => parseInt(hex.slice(i, i + 2), 16) >= 0xd0);
};

/** Printed text lines and painted paths/images of one blank page (PDF coordinates). Paths carry whether they are light fills. */
export async function pageObstacles(page: any): Promise<{ text: Box[]; paint: (Box & { lightFill: boolean })[] }> {
  const text: Box[] = [];
  for (const i of (await page.getTextContent()).items as any[]) {
    if (!i.str?.trim()) continue;
    const size = Math.hypot(i.transform[2], i.transform[3]) || i.height;
    text.push({ x0: i.transform[4], y0: i.transform[5] - 0.22 * size, x1: i.transform[4] + i.width, y1: i.transform[5] + 0.92 * size });
  }
  const ol = await page.getOperatorList();
  type M = number[];
  const mul = (m: M, n: M): M => [m[0]! * n[0]! + m[2]! * n[1]!, m[1]! * n[0]! + m[3]! * n[1]!, m[0]! * n[2]! + m[2]! * n[3]!, m[1]! * n[2]! + m[3]! * n[3]!, m[0]! * n[4]! + m[2]! * n[5]! + m[4]!, m[1]! * n[4]! + m[3]! * n[5]! + m[5]!];
  const map = (m: M, x0: number, y0: number, x1: number, y1: number): Box => {
    const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [m[0]! * x! + m[2]! * y! + m[4]!, m[1]! * x! + m[3]! * y! + m[5]!]);
    return { x0: Math.min(...pts.map((p) => p[0]!)), y0: Math.min(...pts.map((p) => p[1]!)), x1: Math.max(...pts.map((p) => p[0]!)), y1: Math.max(...pts.map((p) => p[1]!)) };
  };
  let ctm: M = [1, 0, 0, 1, 0, 0], fill: unknown = "#000000", lw = 1, path: Box | null = null;
  const stack: { ctm: M; fill: unknown; lw: number }[] = [];
  const paint: (Box & { lightFill: boolean })[] = [];
  const grow = (b: Box, d: number): Box => ({ x0: b.x0 - d, y0: b.y0 - d, x1: b.x1 + d, y1: b.y1 + d });
  const FILLS = new Set([OPS.fill, OPS.eoFill]);
  const STROKES = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const paintPath = (op: number) => {
    if (!path) return;
    if (FILLS.has(op)) paint.push({ ...path, lightFill: light(fill) });
    else if (STROKES.has(op)) paint.push({ ...grow(path, Math.max(lw * Math.hypot(ctm[0]!, ctm[1]!), 0.5) / 2), lightFill: false });
  };
  ol.fnArray.forEach((fn: number, i: number) => {
    const a = ol.argsArray[i];
    if (fn === OPS.save) stack.push({ ctm, fill, lw });
    else if (fn === OPS.restore) ({ ctm, fill, lw } = stack.pop() ?? { ctm, fill, lw });
    else if (fn === OPS.transform) ctm = mul(ctm, a);
    else if (fn === OPS.paintFormXObjectBegin && a[0]) ctm = mul(ctm, a[0]);
    else if (fn === OPS.setFillRGBColor) fill = a[0] ?? a;
    else if (fn === OPS.setLineWidth) lw = a[0];
    else if (fn === OPS.constructPath) {
      const mm = a[2];
      path = mm ? map(ctm, mm[0], mm[1], mm[2], mm[3]) : null;
      // pdfjs 4.10 folds the painting operator into constructPath (args[0]); older builds emit it as the next op.
      if (typeof a[0] === "number") { paintPath(a[0]); path = null; }
    }
    else if (FILLS.has(fn) || STROKES.has(fn)) { paintPath(fn); path = null; }
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) paint.push({ ...map(ctm, 0, 0, 1, 1), lightFill: false });
    else if (fn === OPS.endPath) path = null;
  });
  return { text, paint };
}

/** The free area of each text field ("hiv{n}") plus "b3.signature" on the PIESA. Pure given the page obstacles. */
export function areasFor(key: OfficialKey, fields: FieldBox[], pages: { w: number; h: number; text: Box[]; paint: (Box & { lightFill: boolean })[] }[]): Record<string, Box> {
  const out: Record<string, Box> = {};
  const obstaclesFor = (f: FieldBox) => {
    const pg = pages[f.page]!, me = fieldBox(f);
    return [
      ...pg.text,
      ...pg.paint.filter((p) => !p.lightFill && !contains(p, me)),
      ...fields.filter((o) => o.page === f.page && o.name !== f.name).map(fieldBox),
    ];
  };
  const vertical = (obs: Box[], x0: number, x1: number, top: number, bottom: number, pageH: number) => {
    const span = { x0, x1, y0: 0, y1: 0 };
    const above = obs.filter((o) => overlapX(o, span) && o.y0 >= top - 0.5).map((o) => o.y0);
    const below = obs.filter((o) => overlapX(o, span) && o.y1 <= bottom + 0.5).map((o) => o.y1);
    return { y1: Math.min(pageH - MARGIN, ...above) - GAP, y0: Math.max(MARGIN, ...below) + GAP };
  };
  for (const f of fields) {
    if (f.kind !== "text") continue;
    const pg = pages[f.page]!, me = fieldBox(f), obs = obstaclesFor(f);
    const right = obs.filter((o) => overlapY(o, me) && o.x0 >= me.x0 + 0.5).map((o) => o.x0);
    const x1 = Math.min(pg.w - MARGIN, ...right) - GAP_RIGHT;
    const { y0, y1 } = vertical(obs, me.x0, x1, me.y1, me.y0, pg.h);
    out[f.name] = { x0: r2(me.x0), y0: r2(y0), x1: r2(x1), y1: r2(y1) };
  }
  if (key === "piesa") {
    // Part B3 has no signature box: the band under the declaration line (and the rule below it).
    const decl = fields[137]!;
    const pg = pages[decl.page]!, obs = obstaclesFor(decl), me = fieldBox(decl);
    const x1 = pg.w - MARGIN - GAP_RIGHT;
    const span = { x0: me.x0, x1, y0: 0, y1: 0 };
    const under = obs.filter((o) => overlapX(o, span) && o.y1 <= me.y0 + 0.5);
    const lineBottom = Math.min(me.y0, ...obs.filter((o) => overlapX(o, span) && overlapY(o, me)).map((o) => o.y0));
    // The row's own rule (a thin line straight under the declaration) is part of the line, not the floor.
    const rule = under.filter((o) => o.y1 - o.y0 < 2 && lineBottom - o.y1 < 10).sort((a, b) => b.y1 - a.y1)[0];
    const top = rule ? rule.y0 : lineBottom;
    const floor = Math.max(MARGIN, ...under.filter((o) => o.y1 < top - 0.5).map((o) => o.y1));
    out["b3.signature"] = { x0: r2(me.x0), y0: r2(floor + GAP), x1: r2(x1), y1: r2(top - GAP) };
  }
  return out;
}

export async function measureAreas(key: OfficialKey): Promise<Record<string, Box>> {
  const blank = BLANKS[key];
  const doc = await getDocument({ data: new Uint8Array(Buffer.from(blank.pdfBase64, "base64")), verbosity: 0 }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const [, , w, h] = page.view as number[];
    pages.push({ w: w!, h: h!, ...(await pageObstacles(page)) });
  }
  return areasFor(key, blank.fields, pages);
}

if (import.meta.main) {
  const body = [];
  for (const key of ["piesa", "piisa"] as OfficialKey[]) {
    const a = await measureAreas(key);
    body.push(`  ${key}: {\n${Object.entries(a).map(([k, b]) => `    ${JSON.stringify(k)}: ${JSON.stringify(b)},`).join("\n")}\n  },`);
    console.log(`${key}: ${Object.keys(a).length} areas`);
  }
  const src = `// GENERATED by \`bun scripts/official-form-pdf-areas.ts\` from the DEECA blank PDFs (official-pdf-{piesa,piisa}.data.ts) — do not edit by hand.
// The free area each filled text may use, per text field (hiv{n}) and PIESA "b3.signature": pt, PDF coordinates (origin bottom-left),
// on the field's own page. Bounded by DEECA's printed text, rules, section bars, other fields and the page text margins.
export type FieldArea = { x0: number; y0: number; x1: number; y1: number };
export const OFFICIAL_PDF_AREAS: Record<"piesa" | "piisa", Record<string, FieldArea>> = {
${body.join("\n")}
};
`;
  writeFileSync(new URL("../src/lib/official-pdf-areas.data.ts", import.meta.url).pathname, src);
  console.log("wrote src/lib/official-pdf-areas.data.ts");
}
