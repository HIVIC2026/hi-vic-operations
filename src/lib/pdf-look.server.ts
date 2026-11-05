// Website-look PDF renderer (Open Sans, blue top bar, business block, footer with "Page N of M"). No database, no network.
// Layout rules are pure (pdf-look.core.ts); this file measures with the embedded fonts, paginates, draws, then writes the footers.
import { PDFDocument, rgb, setCharacterSpacing, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { LOGO_PNG } from "./email-hero-assets";
import { OPEN_SANS_400, OPEN_SANS_700, OPEN_SANS_700_ITALIC, OPEN_SANS_800 } from "./pdf-fonts.data";
import { pdfSafeText } from "./pdf-text.core";
import {
  BUSINESS_ADDRESS, BUSINESS_LINES, PDF_COLOURS, PDF_FOOTER_LEFT, PDF_PAGE, moneyLabelLines, paginateDetailed, wrapText,
  type PdfBlock, type PdfDoc, type PdfLayoutReport,
} from "./pdf-look.core";

const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = {
  blue: hex(PDF_COLOURS.blue), ink: hex(PDF_COLOURS.ink), green: hex(PDF_COLOURS.green), box: hex(PDF_COLOURS.box),
  muted: hex(PDF_COLOURS.muted), line: hex("#e3e8f2"), dgreen: hex("#07a554"), white: rgb(1, 1, 1),
};
// Type scale measured from the approved sample PDF (its 12px body prints at 8.4pt, so px x 0.7).
const BODY = 8.4, BODY_LH = 12.6, SMALL = 7.75, SMALL_LH = 11.4, LABEL = 6.65, GAP = 3.5, BULLET_GAP = 2.1;
const FACT = 8.05, FACT_LH = 11.7, H1 = 21, H1_LH = 23.1, SUB = 9.1, SUB_LH = 14, H2 = 11.2, BIZ = 7.35, BIZ_LH = 11.2, EYEBROW = 7.7;
const BAR_H = 5.6, BAR_GAP = 19.6, LOGO_H = 32.2, LOGO_W = 32.2 * (400 / 171);
const HEAD_TOP = 8.4, HEAD_LINE = 16.6, BADGE = 15.4;
// Page-1 sizes of the signed acceptance, measured from the approved sample (type px x 0.7, spacing px x 0.75).
const K = {
  body: 7.2, bodyLh: 9.6, gap: 3.75, h1: 13.3, h1Lh: 15.3, h1Top: 3, sub: 7.35, subLh: 9.8, subGap: 1.5, titleBottom: 9,
  label: 6.3, labelLh: 8.4, fact: 7.2, factLh: 9.6, padX: 7.5, padY: 3.75, headGap: 8, eyebrowLh: 9.8, gridGap: 4.5,
  head: 9.1, headLh: 9.6, headTop: 7.5, headPad: 2.6, headRule: 1.1, headBottom: 0.8, sigName: 10.5, sigNameLh: 14, sigNameGap: 1.5,
  rowPad: 4.5, totLh: 12.1, tot: 9.1, tickPadX: 9, tickPadY: 5.25, tickBadge: 12, tickGap: 6.75, tickMargin: 4.5,
} as const;
// Receipt blocks (the approved receipt samples: type px x 0.7, spacing px x 0.7).
const R = {
  paidTop: 7.6, paidPadY: 9.8, paidPadX: 12.6, paidRadius: 8.4, paidL1: 9.8, paidL1Lh: 14.2, paidL2: 8.4, paidL2Lh: 12.2, amt: 19.6, amtLh: 26.1,
  tblTop: 9.5, thSize: 6.3, thLh: 8.4, thPad: 2.8, thRule: 1.05, rowSize: 8.05, rowLh: 10.35, rowPad: 4.9, rowLine: 0.7, totSize: 9.1, totLh: 12.1, noteSize: 7.35, noteLh: 9.8,
} as const;
const K_BIZ = 7, K_BIZ_LH = 10.5; // page-1 business block of the compact documents (10px / 1.5 in their samples)
const R_INSET = 2.2; // the sample's body has 3px (2.25pt) of right padding
const PAID_FILL = hex("#e8f9ef");
const paidH = () => R.paidTop + 2 * R.paidPadY + Math.max(R.paidL1Lh + R.paidL2Lh, R.amtLh);
// Ledger rows wrap their label beside the amount (long product lines) and the note wraps under the total.
type LedgerShape = { rows: { label: string; amount: string; strong?: boolean }[]; note?: string };
const LEDGER_GAP = 6;
const ledgerLabelLines = (F: Fonts, w: number, r: LedgerShape["rows"][number]) => lines(r.strong ? F.b : F.r, R.rowSize, r.label, w - R_INSET - tw(r.strong ? F.b : F.r, R.rowSize, r.amount) - LEDGER_GAP);
const ledgerNoteLines = (F: Fonts, w: number, note: string) => lines(F.r, R.noteSize, note, w - R_INSET);
const ledgerH = (b: LedgerShape, w: number, F: Fonts) => R.tblTop + 2 * R.thPad + R.thLh + R.thRule + b.rows.reduce((s, r) => s + 2 * R.rowPad + ledgerLabelLines(F, w, r).length * R.rowLh + R.rowLine, 0) + 2 * R.rowPad + R.totLh + (b.note ? ledgerNoteLines(F, w, b.note).length * R.noteLh + R.rowPad : 0);
const CONTENT_W = PDF_PAGE.width - 2 * PDF_PAGE.side;
const PAGE_BOTTOM = PDF_PAGE.bottom;

type Fonts = { r: PDFFont; b: PDFFont; x: PDFFont; i: PDFFont };
type Ctx = { pdf: PDFDocument; fonts: Fonts; logo: () => Promise<PDFImage>; images: Map<string, PDFImage> };

/** Section numbers drawn as little vector icons (the Open Sans files have no glyph for them). */
const ICON_NUMBERS = new Set(["✓", "⚡", "↩"]);

/** Every string in the document goes through the Open Sans character set (ids, kinds and image bytes are left alone). */
function sanitize<T>(v: T, safe: (s: string) => string, key = ""): T {
  if (typeof v === "string") return (key === "id" || key === "kind" || (key === "number" && ICON_NUMBERS.has(v)) ? v : safe(v)) as T;
  if (Array.isArray(v)) return v.map((x) => sanitize(x, safe)) as T;
  if (v && typeof v === "object" && !(v instanceof Uint8Array)) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sanitize(x, safe, k)])) as T;
  }
  return v;
}

const tw = (f: PDFFont, size: number, s: string, spacing = 0) => f.widthOfTextAtSize(s, size) + spacing * s.length;
const lines = (f: PDFFont, size: number, s: string, w: number) => wrapText(s, (t) => tw(f, size, t), w);

function roundRect(page: PDFPage, x: number, top: number, w: number, h: number, r: number, o: { fill?: ReturnType<typeof rgb>; stroke?: ReturnType<typeof rgb>; sw?: number }) {
  // pdf-lib's SVG paths are y-down from the given origin.
  const p = `M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`;
  page.drawSvgPath(p, { x, y: top, ...(o.fill ? { color: o.fill } : {}), ...(o.stroke ? { borderColor: o.stroke, borderWidth: o.sw ?? 0.75 } : {}) });
}
function text(page: PDFPage, s: string, x: number, baseline: number, f: PDFFont, size: number, color: ReturnType<typeof rgb>, o: { spacing?: number; right?: boolean; skew?: boolean } = {}) {
  if (!s) return;
  const sp = o.spacing ?? 0;
  const px = o.right ? x - tw(f, size, s, sp) : x;
  if (sp) page.pushOperators(setCharacterSpacing(sp));
  page.drawText(s, { x: px, y: baseline, font: f, size, color });
  if (sp) page.pushOperators(setCharacterSpacing(0));
}
/** Baseline for a line of height `lh` whose top is `top`. */
const base = (top: number, lh: number, size: number) => top - lh / 2 - size * 0.35;
function drawLines(page: PDFPage, ls: string[], x: number, top: number, f: PDFFont, size: number, lh: number, color: ReturnType<typeof rgb>, o: { right?: boolean } = {}) {
  ls.forEach((l, i) => text(page, l, x, base(top - i * lh, lh, size), f, size, color, o));
}

// ---- measuring ------------------------------------------------------------------------------------------------------
function measure(b: PdfBlock, w: number, F: Fonts): number {
  switch (b.kind) {
    case "header": {
      const n = BUSINESS_LINES.length + (b.withAddress ? 1 : 0);
      return Math.max(LOGO_H, n * (b.compact ? K_BIZ_LH : BIZ_LH)) + (b.compact ? K.headGap + K.eyebrowLh : 18.2 + 11.4);
    }
    case "title": if (b.compact) return K.h1Top + lines(F.x, K.h1, b.text, w).length * K.h1Lh + (b.sub ? K.subGap + lines(F.r, K.sub, b.sub, w).length * K.subLh : 0) + K.titleBottom;
      return 2.8 + lines(F.x, H1, b.text, w).length * H1_LH + (b.sub ? 2.8 + lines(F.r, SUB, b.sub, w).length * SUB_LH : 0) + 11.2;
    case "para": { if (b.compact) return (b.lead ? runLines(F, K.body, b.lead, b.text, w) : lines(F.r, K.body, b.text, w)).length * K.bodyLh + K.gap;
      const s = b.small ? SMALL : BODY; const lh = b.small ? SMALL_LH : BODY_LH; return (b.lead ? runLines(F, s, b.lead, b.text, w) : lines(F.r, s, b.text, w)).length * lh + GAP; }
    case "facts": if (b.compact) return gridRows(b.rows.map((r) => ({ label: r[0], text: r[1], ...(b.boxes ? { boxes: true } : {}) })), b.full, b.fullFrom, b.fullAt).reduce((sum, r) => sum + gridRowH(r, w, F), 0) + K.gridGap;
      return factRows(b.rows).reduce((s, r) => s + factRowH(r, w, F), 0) + 4.2;
    case "section": return sectionHead(b) + b.children.reduce((s, c) => s + measure(c, w, F), 0);
    case "bullets": if (b.compact) return b.items.reduce((s, t, i) => s + runLines(F, K.body, "", t, w - cBulletIndent(b.levels?.[i])).length * K.bodyLh + C_BULLET_GAP, 0);
      return b.items.reduce((s, t, i) => s + runLines(F, BODY, b.leads?.[i] ?? "", t, w - BULLET_INDENT).length * BODY_LH + BULLET_GAP, 0);
    case "money": if (b.compact) return b.rows.reduce((sum, r) => sum + compactMoneyRowH(r, w, F), 0) + 4.5;
      return b.rows.reduce((s, r) => s + moneyRowH(r, w, F), 0) + 1 + 5.6;
    case "ticks": if (b.compact) return b.items.reduce((sum, t) => sum + tickH(t, w, F), 0);
      return b.items.reduce((s, t) => s + Math.max(11, lines(F.r, BODY, t, w - 16).length * BODY_LH) + 2, 0) + GAP;
    case "signature": return 3 + sigH(b, w, F) + (b.sub ? 2 + lines(F.r, SMALL, b.sub, w).length * SMALL_LH : 0) + GAP;
    case "box": return BOX_PAD * 2 + b.children.reduce((s, c) => s + measure(c, w - 2 * BOX_PAD, F), 0) + GAP;
    case "image": return b.height + GAP;
    case "heading": return K.headTop + K.headLh + K.headPad + K.headRule + K.headBottom;
    case "signatures": return gridRowH(sigCells(b.cells), w, F);
    case "noteBox": return noteH(b, w, F);
    case "paid": return paidH();
    case "ledger": return ledgerH(b, w, F);
    case "subheading": return SUBH.top + SUBH.lh + SUBH.bottom;
    case "sigRow": return SIG_ROW_TOP + sigRowH(b.cells, w, F);
    case "group": return b.children.reduce((s, c) => s + measure(c, w, F), 0);
    case "pageBreak": return 0;
    case "spacer": return b.height;
  }
}
const BOX_PAD = 7.5;
const sectionHead = (_b: { number?: string }) => HEAD_TOP + HEAD_LINE + 3.5;
const BULLET_INDENT = 11.9;

type Run = { s: string; bold: boolean };
/** Lines of runs: an optional bold lead-in followed by regular text, wrapped together. */
function runLines(F: Fonts, size: number, lead: string, rest: string, w: number): Run[][] {
  const words: Run[] = [...lead.split(/\s+/).filter(Boolean).map((s) => ({ s, bold: true })), ...rest.split(/\s+/).filter(Boolean).map((s) => ({ s, bold: false }))];
  const wd = (r: Run) => tw(r.bold ? F.b : F.r, size, r.s);
  const sp = tw(F.r, size, " ");
  const out: Run[][] = [];
  let cur: Run[] = []; let cw = 0;
  for (const r of words) {
    const add = cur.length ? sp + wd(r) : wd(r);
    if (cur.length && cw + add > w) { out.push(cur); cur = [r]; cw = wd(r); } else { cur.push(r); cw += add; }
  }
  out.push(cur);
  return out;
}
function drawRuns(page: PDFPage, ls: Run[][], x: number, top: number, F: Fonts, size: number, lh: number, color: ReturnType<typeof rgb>) {
  const sp = tw(F.r, size, " ");
  ls.forEach((l, i) => {
    // Consecutive words in the same font are drawn as one string, so the text stays searchable.
    const segs: Run[] = [];
    for (const r of l) { const last = segs[segs.length - 1]; if (last && last.bold === r.bold) last.s += ` ${r.s}`; else segs.push({ ...r }); }
    let cx = x;
    segs.forEach((r, k) => { const f = r.bold ? F.b : F.r; if (k) cx += sp; text(page, r.s, cx, base(top - i * lh, lh, size), f, size, color); cx += tw(f, size, r.s); });
  });
}
// Money rows (Jo 5 Nov 2026): labels wrap left of the amount (moneyLabelLines); a label that fits keeps the old height.
type MoneyRow = { strong?: boolean; label: string; amount: string };
const moneyParts = (r: MoneyRow, w: number, F: Fonts) => {
  const size = r.strong ? 9.8 : BODY, f = r.strong ? F.b : F.r;
  const parts = r.label.split("\n");
  if (parts.length > 1 && !r.strong) return { head: moneyLabelLines(parts[0]!, r.amount, w, (t) => tw(F.b, size, t)), detail: parts.slice(1).flatMap((l) => moneyLabelLines(l, r.amount, w, (t) => tw(F.r, BODY, t))) };
  return { head: moneyLabelLines(r.label, r.amount, w, (t) => tw(f, size, t)), detail: null };
};
const moneyRowH = (r: MoneyRow, w: number, F: Fonts) => {
  const p = moneyParts(r, w, F);
  if (p.detail) return 9.8 + p.head.length * BODY_LH + p.detail.length * 11.4 + 0.7;
  return (r.strong ? 24 : 22.4) + (p.head.length - 1) * (r.strong ? 13 : BODY_LH);
};
const compactMoneyLines = (r: MoneyRow, w: number, F: Fonts) => moneyLabelLines(r.label, r.amount, w, (t) => tw(r.strong ? F.x : F.r, r.strong ? K.tot : K.body, t));
const compactMoneyRowH = (r: MoneyRow, w: number, F: Fonts) => {
  const n = compactMoneyLines(r, w, F).length;
  return r.strong ? 2 * K.rowPad + n * K.totLh : 2 * K.rowPad + n * K.bodyLh + 0.75;
};
/** Three cells sit side by side in one row (as in the approved agreement); otherwise two per row. */
const factRows = (rows: [string, string][]) => { const out: [string, string][][] = []; const n = rows.length === 3 ? 3 : 2; for (let i = 0; i < rows.length; i += n) out.push(rows.slice(i, i + n)); return out; };
const FACT_PAD_X = 9.1, FACT_PAD_Y = 7, FACT_LABEL_H = 11.2;
/** Equal columns, but a column never narrower than its longest unbreakable word (an email stays on one line). */
function factCols(r: [string, string][], w: number, F: Fonts): number[] {
  const min = r.map((c) => Math.max(tw(F.b, LABEL, c[0].toUpperCase(), 0.67), ...c[1].split(/\s+/).map((t) => tw(F.r, FACT, t))) + 2 * FACT_PAD_X + 0.5);
  const fixed = new Set<number>();
  let share = w / r.length;
  for (let guard = 0; guard < r.length; guard++) {
    const free = r.length - fixed.size;
    share = (w - [...fixed].reduce((s, i) => s + min[i]!, 0)) / free;
    const over = min.findIndex((m, i) => !fixed.has(i) && m > share + 0.01);
    if (over < 0) break;
    fixed.add(over);
  }
  return min.map((m, i) => (fixed.has(i) ? m : share));
}
function factCellH(c: [string, string], w: number, F: Fonts) { return FACT_PAD_Y * 2 + FACT_LABEL_H + lines(F.r, FACT, c[1], w - 2 * FACT_PAD_X).length * FACT_LH; }
function factRowH(r: [string, string][], w: number, F: Fonts) { const cs = factCols(r, w, F); return Math.max(...r.map((c, i) => factCellH(c, cs[i]!, F))); }
function sigH(b: { name: string; label: string; at: string }, w: number, F: Fonts) {
  const nameW = w * 0.62 - 15;
  return 5 + 8.5 + Math.max(lines(F.i, 11.25, b.name, nameW).length * 14, 14) + 5;
}

// ---- compact bullets, sub-headings, signature rows, check boxes (the VEEC form) ---------------------------------------
const C_BULLET_GAP = 1.5;
const cBulletIndent = (level = 0) => 12 + 12 * level;
const SUBH = { top: 7.5, lh: 11.2, size: 8.4, bottom: 3.75 } as const;
const SIG_ROW_TOP = 6, SIG_IMG_GAP = 6;
type SigCell = Extract<PdfBlock, { kind: "sigRow" }>["cells"][number];
const sigCellW = (cells: SigCell[], w: number, i: number) => (w * cells[i]!.weight) / cells.reduce((s, c) => s + c.weight, 0);
const sigLabelLines = (F: Fonts, c: SigCell, cw: number) => wrapText(c.label.toUpperCase(), (t) => tw(F.b, K.label, t, 0.5), cw - 2 * K.padX);
const sigNameW = (c: SigCell, cw: number) => cw - 2 * K.padX - (c.image ? c.image.width + SIG_IMG_GAP : 0);
function sigCellH(c: SigCell, cw: number, F: Fonts) {
  const nameH = c.name ? Math.max(1, lines(F.i, K.sigName, c.name, sigNameW(c, cw)).length) * K.sigNameLh : 0;
  const mid = Math.max(c.image?.height ?? 0, nameH);
  return 2 * K.padY + sigLabelLines(F, c, cw).length * K.labelLh + (mid ? mid + 2 * K.sigNameGap : 0) + (c.text ? lines(F.r, K.fact, c.text, cw - 2 * K.padX).length * K.factLh : 0);
}
const sigRowH = (cells: SigCell[], w: number, F: Fonts) => Math.max(...cells.map((c, i) => sigCellH(c, sigCellW(cells, w, i), F)));

/** Check boxes inside grid text: "[x]" ticked, "[ ]" empty; each takes BOX_W of the line. */
const BOX_W = 8.5, BOX_S = 6.6;
const BOX_SPLIT = /(\[[ x]\])/;
const boxLineW = (F: Fonts, size: number, s: string) => s.split(BOX_SPLIT).reduce((sum, p) => sum + (/^\[[ x]\]$/.test(p) ? BOX_W : tw(F.r, size, p)), 0);
function drawBoxLines(page: PDFPage, ls: string[], x: number, top: number, F: Fonts, size: number, lh: number) {
  ls.forEach((l, i) => {
    const bl = base(top - i * lh, lh, size);
    let cx = x;
    for (const part of l.split(BOX_SPLIT)) {
      if (/^\[[ x]\]$/.test(part)) {
        const on = part === "[x]";
        roundRect(page, cx + 0.8, bl + BOX_S - 0.6, BOX_S, BOX_S, 1.3, { ...(on ? { fill: C.green } : {}), stroke: on ? C.green : C.ink, sw: 0.8 });
        cx += BOX_W;
      } else if (part) { text(page, part, cx, bl, F.r, size, C.ink); cx += tw(F.r, size, part); }
    }
  });
}

// ---- page-1 grids (compact) -----------------------------------------------------------------------------------------
type GridCell = { label: string; text: string; name?: string; boxes?: boolean };
const gridRows = (cells: GridCell[], full?: boolean, fullFrom?: number, fullAt?: number[]) => {
  const out: GridCell[][] = [];
  if (fullAt) { // listed cells sit alone; the others pair up in order between them
    let pend: GridCell[] = [];
    const flush = () => { while (pend.length) out.push(pend.splice(0, 2)); };
    cells.forEach((c, i) => { if (fullAt.includes(i)) { flush(); out.push([c]); } else pend.push(c); });
    flush();
    return out;
  }
  const split = full ? 0 : fullFrom ?? cells.length;
  for (let i = 0; i < Math.min(split, cells.length); i += 2) out.push(cells.slice(i, Math.min(i + 2, split)));
  for (let i = split; i < cells.length; i++) out.push([cells[i]!]);
  return out;
};
const sigCells = (cs: { label: string; name: string; line: string }[]): GridCell[] => cs.map((c) => ({ label: c.label, name: c.name, text: c.line }));
const cellLines = (F: Fonts, c: GridCell, w: number) => (c.boxes ? wrapText(c.text, (t) => boxLineW(F, K.fact, t), w) : lines(F.r, K.fact, c.text, w));
function gridCellH(c: GridCell, cw: number, F: Fonts) {
  const nameH = c.name == null ? 0 : 2 * K.sigNameGap + Math.max(1, lines(F.i, K.sigName, c.name, cw - 2 * K.padX).length) * K.sigNameLh;
  return 2 * K.padY + K.labelLh + nameH + (c.text ? cellLines(F, c, cw - 2 * K.padX).length * K.factLh : 0);
}
function gridRowH(r: GridCell[], w: number, F: Fonts) { const cw = w / (r.length === 1 ? 1 : 2); return Math.max(...r.map((c) => gridCellH(c, cw, F))); }
function drawGrid(page: PDFPage, rows: GridCell[][], x: number, top: number, w: number, F: Fonts) {
  const hs = rows.map((r) => gridRowH(r, w, F));
  const total = hs.reduce((s, h) => s + h, 0);
  roundRect(page, x, top, w, total, 7.5, { fill: C.box, stroke: C.line });
  let y = top;
  rows.forEach((r, ri) => {
    const cw = w / (r.length === 1 ? 1 : 2);
    r.forEach((c, ci) => {
      const cx = x + ci * cw;
      text(page, c.label.toUpperCase(), cx + K.padX, base(y - K.padY, K.labelLh, K.label), F.b, K.label, C.muted, { spacing: 0.5 });
      let ty = y - K.padY - K.labelLh;
      if (c.name != null) {
        ty -= K.sigNameGap;
        drawLines(page, lines(F.i, K.sigName, c.name, cw - 2 * K.padX), cx + K.padX, ty, F.i, K.sigName, K.sigNameLh, C.ink);
        ty -= Math.max(1, lines(F.i, K.sigName, c.name, cw - 2 * K.padX).length) * K.sigNameLh + K.sigNameGap;
      }
      if (c.text && c.boxes) drawBoxLines(page, cellLines(F, c, cw - 2 * K.padX), cx + K.padX, ty, F, K.fact, K.factLh);
      else if (c.text) drawLines(page, lines(F.r, K.fact, c.text, cw - 2 * K.padX), cx + K.padX, ty, F.r, K.fact, K.factLh, C.ink);
      if (ci < r.length - 1) page.drawLine({ start: { x: cx + cw, y }, end: { x: cx + cw, y: y - hs[ri]! }, thickness: 0.75, color: C.line });
    });
    y -= hs[ri]!;
    if (ri < rows.length - 1) page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 0.75, color: C.line });
  });
}
const tickH = (t: string, w: number, F: Fonts) => 2 * K.tickPadY + 1.5 + Math.max(K.tickBadge, lines(F.r, K.body, t, w - 2 * K.tickPadX - K.tickBadge - K.tickGap - 1.5).length * K.bodyLh) + K.tickMargin;
/** The agreement's "Signed" box: label, the signed line, then a muted version line. */
const NOTE_PAD_X = 10.5, NOTE_PAD_Y = 9, NOTE_TOP = 10.5;
function noteH(b: { text: string; sub?: string }, w: number, F: Fonts) {
  const iw = w - 2 * NOTE_PAD_X - 1.5;
  return NOTE_TOP + 2 * NOTE_PAD_Y + 1.5 + 9.84 + 1.5 + lines(F.r, BODY, b.text, iw).length * BODY_LH + (b.sub ? lines(F.r, BODY, b.sub, iw).length * BODY_LH : 0) + GAP;
}

// ---- drawing --------------------------------------------------------------------------------------------------------
type Img = { block: string; page: number };
async function draw(b: PdfBlock, page: PDFPage, pageNo: number, x: number, top: number, w: number, X: Ctx, imgs: Img[]): Promise<void> {
  const F = X.fonts;
  switch (b.kind) {
    case "header": {
      const logo = await X.logo();
      page.drawImage(logo, { x, y: top - LOGO_H, width: LOGO_W, height: LOGO_H });
      // Part 10 Task 7: the installer's logo beside ours (same height, width from its own ratio, capped); counted as a picture.
      if (b.partnerLogo && b.partnerLogo.bytes.length && b.partnerLogo.height > 0) {
        let img = X.images.get(`${b.id}:partner`);
        if (!img) { img = await embedImage(X.pdf, b.partnerLogo.bytes); X.images.set(`${b.id}:partner`, img); }
        const pw = Math.min(LOGO_H * (b.partnerLogo.width / b.partnerLogo.height), LOGO_W * 1.5);
        page.drawImage(img, { x: x + LOGO_W + 12, y: top - LOGO_H, width: pw, height: LOGO_H });
        imgs.push({ block: b.id, page: pageNo });
      }
      const biz = b.withAddress ? [...BUSINESS_LINES.slice(0, 3), BUSINESS_ADDRESS, ...BUSINESS_LINES.slice(3)] : [...BUSINESS_LINES];
      const bizSize = b.compact ? K_BIZ : BIZ, bizLh = b.compact ? K_BIZ_LH : BIZ_LH;
      biz.forEach((l, i) => text(page, l, x + w - (b.compact ? R_INSET : 0), base(top - i * bizLh, bizLh, bizSize), F.r, bizSize, C.muted, { right: true }));
      const rowH = Math.max(LOGO_H, biz.length * bizLh);
      if (b.compact) text(page, b.eyebrow, x, base(top - rowH - K.headGap, K.eyebrowLh, 7.35), F.b, 7.35, C.blue, { spacing: 1.1 });
      else text(page, b.eyebrow, x, base(top - rowH - 18.2, 11.4, EYEBROW), F.b, EYEBROW, C.blue, { spacing: 1.23 });
      return;
    }
    case "title": {
      if (b.compact) {
        let cy = top - K.h1Top;
        const ct = lines(F.x, K.h1, b.text, w);
        drawLines(page, ct, x, cy, F.x, K.h1, K.h1Lh, C.ink); cy -= ct.length * K.h1Lh;
        if (b.sub) { cy -= K.subGap; drawLines(page, lines(F.r, K.sub, b.sub, w), x, cy, F.r, K.sub, K.subLh, C.muted); }
        return;
      }
      let y = top - 2.8;
      const t = lines(F.x, H1, b.text, w);
      drawLines(page, t, x, y, F.x, H1, H1_LH, C.ink); y -= t.length * H1_LH;
      if (b.sub) { y -= 2.8; drawLines(page, lines(F.r, SUB, b.sub, w), x, y, F.r, SUB, SUB_LH, C.muted); }
      return;
    }
    case "para": {
      if (b.compact) {
        if (b.lead) drawRuns(page, runLines(F, K.body, b.lead, b.text, w), x, top, F, K.body, K.bodyLh, C.ink);
        else drawLines(page, lines(F.r, K.body, b.text, w), x, top, F.r, K.body, K.bodyLh, C.ink);
        return;
      }
      const s = b.small ? SMALL : BODY; const lh = b.small ? SMALL_LH : BODY_LH;
      if (b.lead) drawRuns(page, runLines(F, s, b.lead, b.text, w), x, top, F, s, lh, b.muted || b.small ? C.muted : C.ink);
      else drawLines(page, lines(F.r, s, b.text, w), x, top, F.r, s, lh, b.muted || b.small ? C.muted : C.ink);
      return;
    }
    case "facts": {
      if (b.compact) { drawGrid(page, gridRows(b.rows.map((r) => ({ label: r[0], text: r[1], ...(b.boxes ? { boxes: true } : {}) })), b.full, b.fullFrom, b.fullAt), x, top, w, F); return; }
      const rows = factRows(b.rows);
      const hs = rows.map((r) => factRowH(r, w, F));
      const total = hs.reduce((s, h) => s + h, 0);
      roundRect(page, x, top, w, total, 7.5, { fill: C.box, stroke: C.line });
      let y = top;
      rows.forEach((r, ri) => {
        const cols = factCols(r, w, F);
        r.forEach((c, ci) => {
          const cw = cols[ci]!; const cx = x + cols.slice(0, ci).reduce((s2, v) => s2 + v, 0);
          text(page, c[0].toUpperCase(), cx + FACT_PAD_X, base(y - FACT_PAD_Y, 9.84, LABEL), F.b, LABEL, C.muted, { spacing: 0.67 });
          drawLines(page, lines(F.r, FACT, c[1], cw - 2 * FACT_PAD_X), cx + FACT_PAD_X, y - FACT_PAD_Y - FACT_LABEL_H, F.r, FACT, FACT_LH, C.ink);
          if (ci < r.length - 1) page.drawLine({ start: { x: cx + cw, y }, end: { x: cx + cw, y: y - hs[ri]! }, thickness: 0.75, color: C.line });
        });
        y -= hs[ri]!;
        if (ri < rows.length - 1) page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 0.75, color: C.line });
      });
      return;
    }
    case "section": {
      await drawSection(b, page, pageNo, x, top, w, X, imgs, 0, b.children.length - 1, true);
      return;
    }
    case "bullets": {
      if (b.compact) {
        let cy = top;
        for (const [i, t] of b.items.entries()) {
          const lvl = b.levels?.[i] ?? 0; const ind = cBulletIndent(lvl);
          const ls = runLines(F, K.body, "", t, w - ind);
          const dotY = base(cy, K.bodyLh, K.body) + K.body * 0.33;
          if (lvl) page.drawCircle({ x: x + ind - 6, y: dotY, size: 1.3, borderColor: C.ink, borderWidth: 0.7 });
          else page.drawCircle({ x: x + ind - 6, y: dotY, size: 1.4, color: C.ink });
          drawRuns(page, ls, x + ind, cy, F, K.body, K.bodyLh, C.ink);
          cy -= ls.length * K.bodyLh + C_BULLET_GAP;
        }
        return;
      }
      let y = top;
      for (const [i, t] of b.items.entries()) {
        const ls = runLines(F, BODY, b.leads?.[i] ?? "", t, w - BULLET_INDENT);
        page.drawCircle({ x: x + 4.5, y: base(y, BODY_LH, BODY) + BODY * 0.33, size: 1.5, color: C.ink });
        drawRuns(page, ls, x + BULLET_INDENT, y, F, BODY, BODY_LH, C.ink);
        y -= ls.length * BODY_LH + BULLET_GAP;
      }
      return;
    }
    case "money": {
      if (b.compact) {
        let cy = top - 1.5;
        b.rows.forEach((r, i) => {
          const h = compactMoneyRowH(r, w, F);
          const size = r.strong ? K.tot : K.body; const f = r.strong ? F.x : F.r; const lh = r.strong ? K.totLh : K.bodyLh;
          const bl = base(cy - K.rowPad, lh, size);
          compactMoneyLines(r, w, F).forEach((l, li) => text(page, l, x, bl - li * lh, f, size, C.ink));
          text(page, r.amount, x + w, bl, f, size, C.ink, { right: true });
          cy -= h;
          if (!r.strong && i < b.rows.length - 1) page.drawLine({ start: { x, y: cy + 0.4 }, end: { x: x + w, y: cy + 0.4 }, thickness: 0.75, color: C.line });
        });
        return;
      }
      let y = top - 1;
      b.rows.forEach((r, i) => {
        const h = moneyRowH(r, w, F);
        const size = r.strong ? 9.8 : BODY; const f = r.strong ? F.b : F.r;
        const col = r.green ? C.dgreen : C.ink;
        const p = moneyParts(r, w, F);
        // The first line keeps the old one-line baseline; wrapped lines follow under it (the amount stays on line one).
        const bl = base(y - 0.35, p.detail ? 9.8 + BODY_LH + (r.label.split("\n").length - 1) * 11.4 + 0.7 : r.strong ? 24 : 22.4, size);
        if (p.detail) {
          // Multi-line label: bold first line(s), muted detail lines under it.
          p.head.forEach((l, li) => text(page, l, x, base(y - 4.9 - li * BODY_LH, BODY_LH, size), F.b, size, C.ink));
          p.detail.forEach((l, li) => text(page, l, x, base(y - 4.9 - p.head.length * BODY_LH - li * 11.4, 11.4, BODY), F.r, BODY, C.muted));
        } else p.head.forEach((l, li) => text(page, l, x, bl - li * (r.strong ? 13 : BODY_LH), r.strong ? F.b : F.r, size, r.green ? C.dgreen : C.ink));
        text(page, r.amount, x + w, bl, f, size, col, { right: true });
        y -= h;
        if (!r.strong && i < b.rows.length - 1) page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 0.75, color: C.line });
      });
      return;
    }
    case "ticks": {
      if (b.compact) {
        let cy = top;
        for (const t of b.items) {
          const h = tickH(t, w, F) - K.tickMargin;
          roundRect(page, x, cy, w, h, 7.5, { fill: C.box, stroke: C.line });
          const bx = x + K.tickPadX + 0.75, by = cy - K.tickPadY - 0.75;
          roundRect(page, bx, by, K.tickBadge, K.tickBadge, 3, { fill: C.green });
          page.drawLine({ start: { x: bx + 3, y: by - 6.2 }, end: { x: bx + 5.2, y: by - 8.6 }, thickness: 1.2, color: C.white });
          page.drawLine({ start: { x: bx + 5.2, y: by - 8.6 }, end: { x: bx + 9, y: by - 3.4 }, thickness: 1.2, color: C.white });
          drawLines(page, lines(F.r, K.body, t, w - 2 * K.tickPadX - K.tickBadge - K.tickGap - 1.5), x + K.tickPadX + 0.75 + K.tickBadge + K.tickGap, cy - K.tickPadY - 0.75, F.r, K.body, K.bodyLh, C.ink);
          cy -= h + K.tickMargin;
        }
        return;
      }
      let y = top;
      for (const t of b.items) {
        const ls = lines(F.r, BODY, t, w - 16);
        const h = Math.max(11, ls.length * BODY_LH);
        roundRect(page, x, y - 1, 8.5, 8.5, 2, { fill: C.green });
        page.drawLine({ start: { x: x + 2, y: y - 5.2 }, end: { x: x + 3.7, y: y - 7 }, thickness: 1.1, color: C.white });
        page.drawLine({ start: { x: x + 3.7, y: y - 7 }, end: { x: x + 6.6, y: y - 3 }, thickness: 1.1, color: C.white });
        drawLines(page, ls, x + 16, y, F.r, BODY, BODY_LH, C.ink);
        y -= h + 2;
      }
      return;
    }
    case "signature": {
      const h = sigH(b, w, F);
      const y0 = top - 3;
      roundRect(page, x, y0, w, h, 7.5, { fill: C.box, stroke: C.line });
      const w1 = w * 0.62;
      page.drawLine({ start: { x: x + w1, y: y0 }, end: { x: x + w1, y: y0 - h }, thickness: 0.75, color: C.line });
      text(page, b.label.toUpperCase(), x + 7.5, base(y0 - 5, 8.5, LABEL), F.b, LABEL, C.muted, { spacing: 0.5 });
      text(page, "DATE", x + w1 + 7.5, base(y0 - 5, 8.5, LABEL), F.b, LABEL, C.muted, { spacing: 0.5 });
      drawLines(page, lines(F.i, 11.25, b.name, w1 - 15), x + 7.5, y0 - 5 - 8.5, F.i, 11.25, 14, C.ink);
      drawLines(page, lines(F.r, BODY, b.at, w - w1 - 15), x + w1 + 7.5, y0 - 5 - 8.5, F.r, BODY, 14, C.ink);
      if (b.sub) drawLines(page, lines(F.r, SMALL, b.sub, w), x, y0 - h - 2, F.r, SMALL, SMALL_LH, C.muted);
      return;
    }
    case "box": {
      const inner = w - 2 * BOX_PAD;
      const h = BOX_PAD * 2 + b.children.reduce((s, c) => s + measure(c, inner, F), 0);
      roundRect(page, x, top, w, h, 7.5, { fill: C.box });
      let y = top - BOX_PAD;
      for (const c of b.children) { await draw(c, page, pageNo, x + BOX_PAD, y, inner, X, imgs); y -= measure(c, inner, F); }
      return;
    }
    case "image": {
      let img = X.images.get(b.id);
      if (!img) { img = await embedImage(X.pdf, b.bytes); X.images.set(b.id, img); }
      page.drawImage(img, { x, y: top - b.height, width: b.width, height: b.height });
      imgs.push({ block: b.id, page: pageNo });
      return;
    }
    case "heading": {
      const hy = top - K.headTop;
      text(page, b.text, x, base(hy, K.headLh, K.head), F.b, K.head, C.ink);
      const ry = hy - K.headLh - K.headPad;
      page.drawLine({ start: { x, y: ry - K.headRule / 2 }, end: { x: x + w, y: ry - K.headRule / 2 }, thickness: K.headRule, color: C.ink });
      return;
    }
    case "signatures": { drawGrid(page, gridRows(sigCells(b.cells)), x, top, w, F); return; }
    case "noteBox": {
      const iw = w - 2 * NOTE_PAD_X - 1.5;
      const h = noteH(b, w, F) - NOTE_TOP - GAP;
      const y0 = top - NOTE_TOP;
      roundRect(page, x, y0, w, h, 9, { fill: C.white, stroke: C.line });
      text(page, b.label.toUpperCase(), x + NOTE_PAD_X + 0.75, base(y0 - NOTE_PAD_Y - 0.75, 9.84, LABEL), F.b, LABEL, C.muted, { spacing: 0.67 });
      let ty = y0 - NOTE_PAD_Y - 0.75 - 9.84 - 1.5;
      const tl = lines(F.r, BODY, b.text, iw);
      drawLines(page, tl, x + NOTE_PAD_X + 0.75, ty, F.r, BODY, BODY_LH, C.ink); ty -= tl.length * BODY_LH;
      if (b.sub) drawLines(page, lines(F.r, BODY, b.sub, iw), x + NOTE_PAD_X + 0.75, ty, F.r, BODY, BODY_LH, C.muted);
      return;
    }
    case "paid": {
      const top0 = top - R.paidTop;
      const h = paidH() - R.paidTop;
      w -= R_INSET;
      roundRect(page, x, top0, w, h, R.paidRadius, { fill: PAID_FILL });
      const inner = top0 - R.paidPadY;
      text(page, b.label, x + R.paidPadX, base(inner, R.paidL1Lh, R.paidL1), F.b, R.paidL1, C.ink);
      text(page, b.line, x + R.paidPadX, base(inner - R.paidL1Lh, R.paidL2Lh, R.paidL2), F.r, R.paidL2, C.ink);
      text(page, b.amount, x + w - R.paidPadX, base(top0 - h / 2 + R.amtLh / 2, R.amtLh, R.amt), F.x, R.amt, C.dgreen, { right: true });
      return;
    }
    case "ledger": {
      w -= R_INSET;
      let y = top - R.tblTop;
      const thH = 2 * R.thPad + R.thLh;
      text(page, b.head.label.toUpperCase(), x, base(y - R.thPad, R.thLh, R.thSize), F.b, R.thSize, C.muted, { spacing: 0.5 });
      text(page, b.head.amount.toUpperCase(), x + w, base(y - R.thPad, R.thLh, R.thSize), F.b, R.thSize, C.muted, { spacing: 0.5, right: true });
      y -= thH;
      page.drawLine({ start: { x, y: y - R.thRule / 2 }, end: { x: x + w, y: y - R.thRule / 2 }, thickness: R.thRule, color: C.ink });
      y -= R.thRule;
      for (const r of b.rows) {
        const f = r.strong ? F.b : F.r;
        const ls = ledgerLabelLines(F, w + R_INSET, r);
        drawLines(page, ls, x, y - R.rowPad, f, R.rowSize, R.rowLh, C.ink);
        const rowH = ls.length * R.rowLh;
        text(page, r.amount, x + w, base(y - R.rowPad - rowH / 2 + R.rowLh / 2, R.rowLh, R.rowSize), f, R.rowSize, C.ink, { right: true });
        y -= 2 * R.rowPad + rowH + R.rowLine;
        page.drawLine({ start: { x, y: y + R.rowLine / 2 }, end: { x: x + w, y: y + R.rowLine / 2 }, thickness: R.rowLine, color: C.line });
      }
      const tl = base(y - R.rowPad, R.totLh, R.totSize);
      const tickW = b.total.tick ? 9 : 0;
      text(page, b.total.label, x, tl, F.x, R.totSize, C.ink);
      text(page, b.total.amount, x + w - tickW, tl, F.x, R.totSize, C.ink, { right: true });
      if (b.total.tick) {
        const cx = x + w - 6.2, cy = tl + R.totSize * 0.3;
        page.drawLine({ start: { x: cx, y: cy }, end: { x: cx + 2, y: cy - 2.3 }, thickness: 0.8, color: C.ink });
        page.drawLine({ start: { x: cx + 2, y: cy - 2.3 }, end: { x: cx + 6.2, y: cy + 3.6 }, thickness: 0.8, color: C.ink });
      }
      y -= 2 * R.rowPad + R.totLh;
      if (b.note) drawLines(page, ledgerNoteLines(F, w + R_INSET, b.note), x, y, F.r, R.noteSize, R.noteLh, C.muted);
      return;
    }
    case "subheading": {
      text(page, b.text, x, base(top - SUBH.top, SUBH.lh, SUBH.size), F.b, SUBH.size, C.ink);
      return;
    }
    case "sigRow": {
      const y0 = top - SIG_ROW_TOP;
      const h = sigRowH(b.cells, w, F);
      roundRect(page, x, y0, w, h, 7.5, { fill: C.box, stroke: C.line });
      let cx = x;
      for (const [i, c] of b.cells.entries()) {
        const cw = sigCellW(b.cells, w, i);
        const ll = sigLabelLines(F, c, cw);
        ll.forEach((l, k) => text(page, l, cx + K.padX, base(y0 - K.padY - k * K.labelLh, K.labelLh, K.label), F.b, K.label, C.muted, { spacing: 0.5 }));
        let ty = y0 - K.padY - ll.length * K.labelLh;
        const nl = c.name ? lines(F.i, K.sigName, c.name, sigNameW(c, cw)) : [];
        const mid = Math.max(c.image?.height ?? 0, nl.length ? Math.max(1, nl.length) * K.sigNameLh : 0);
        if (mid) {
          ty -= K.sigNameGap;
          let nx = cx + K.padX;
          if (c.image) {
            let img = X.images.get(`${b.id}:${i}`);
            if (!img) { img = await embedImage(X.pdf, c.image.bytes); X.images.set(`${b.id}:${i}`, img); }
            page.drawImage(img, { x: nx, y: ty - (mid + c.image.height) / 2, width: c.image.width, height: c.image.height });
            imgs.push({ block: b.id, page: pageNo });
            nx += c.image.width + SIG_IMG_GAP;
          }
          drawLines(page, nl, nx, ty - (mid - nl.length * K.sigNameLh) / 2, F.i, K.sigName, K.sigNameLh, C.ink);
          ty -= mid + K.sigNameGap;
        }
        if (c.text) drawLines(page, lines(F.r, K.fact, c.text, cw - 2 * K.padX), cx + K.padX, ty, F.r, K.fact, K.factLh, C.ink);
        cx += cw;
        if (i < b.cells.length - 1) page.drawLine({ start: { x: cx, y: y0 }, end: { x: cx, y: y0 - h }, thickness: 0.75, color: C.line });
      }
      return;
    }
    case "group": { await drawGroup(b, page, pageNo, x, top, w, X, imgs, 0, b.children.length - 1); return; }
    case "pageBreak": case "spacer": return;
  }
}

/** A group's children[from..to] one under the other; pictures inside are reported under the group's own id. */
async function drawGroup(b: Extract<PdfBlock, { kind: "group" }>, page: PDFPage, pageNo: number, x: number, top: number, w: number, X: Ctx, imgs: Img[], from: number, to: number) {
  let y = top;
  const own: Img[] = [];
  for (let i = from; i <= to; i++) { const c = b.children[i]!; await draw(c, page, pageNo, x, y, w, X, own); y -= measure(c, w, X.fonts); }
  for (const im of own) imgs.push({ block: b.id, page: im.page });
}

async function embedImage(pdf: PDFDocument, bytes: Uint8Array): Promise<PDFImage> {
  const png = bytes[0] === 0x89 && bytes[1] === 0x50;
  return png ? pdf.embedPng(bytes) : pdf.embedJpg(bytes);
}

/** White vector icon centred on (cx, cy) inside a section badge. */
function drawIcon(page: PDFPage, icon: string, cx: number, cy: number) {
  const K = 1.25;
  const seg = (a: number, b: number, c: number, d: number) => page.drawLine({ start: { x: cx + a * K, y: cy + b * K }, end: { x: cx + c * K, y: cy + d * K }, thickness: 1.3, color: C.white });
  if (icon === "✓") { seg(-2.4, 0, -0.8, -1.8); seg(-0.8, -1.8, 2.4, 2); }
  else if (icon === "↩") { seg(2.4, 2, 2.4, -0.6); seg(2.4, -0.6, -2, -0.6); seg(-2, -0.6, -0.4, 0.8); seg(-2, -0.6, -0.4, -2); }
  else page.drawSvgPath("M 1.3 -3.4 L -1.9 0.5 L -0.1 0.5 L -1.1 3.4 L 2.1 -0.7 L 0.3 -0.7 Z", { x: cx, y: cy, scale: K, color: C.white });
}

/** Draws a section's heading (first part only) and children[from..to]; returns nothing, caller advances. */
async function drawSection(b: Extract<PdfBlock, { kind: "section" }>, page: PDFPage, pageNo: number, x: number, top: number, w: number, X: Ctx, imgs: Img[], from: number, to: number, head: boolean) {
  const F = X.fonts;
  let y = top;
  if (head) {
    const hy = y - HEAD_TOP;
    let tx = x;
    if (b.number) {
      const cy = hy - HEAD_LINE / 2;
      page.drawCircle({ x: x + BADGE / 2, y: cy, size: BADGE / 2, color: C.blue });
      if (ICON_NUMBERS.has(b.number)) drawIcon(page, b.number, x + BADGE / 2, cy);
      else {
        const nw = tw(F.b, 8.4, b.number);
        text(page, b.number, x + BADGE / 2 - nw / 2, cy - 8.4 * 0.35, F.b, 8.4, C.white);
      }
      tx = x + BADGE + 6.3;
    }
    text(page, b.title, tx, base(hy, HEAD_LINE, H2), F.b, H2, C.ink);
    y -= sectionHead(b);
  }
  for (let i = from; i <= to; i++) { const c = b.children[i]!; await draw(c, page, pageNo, x, y, w, X, imgs); y -= measure(c, w, F); }
}

// ---- render ---------------------------------------------------------------------------------------------------------
export async function renderPdf(input: PdfDoc): Promise<{ bytes: Uint8Array; layout: PdfLayoutReport }> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const embed = (b64: string) => pdf.embedFont(Buffer.from(b64, "base64"), { subset: true });
  const fonts: Fonts = { r: await embed(OPEN_SANS_400), b: await embed(OPEN_SANS_700), x: await embed(OPEN_SANS_800), i: await embed(OPEN_SANS_700_ITALIC) };
  const charset = new Set(fonts.r.getCharacterSet());
  const safe = (s: string) => s.split("\n").map((l) => pdfSafeText(l, charset)).join("\n");
  const doc = sanitize(input, safe);
  pdf.setTitle(doc.title);
  pdf.setProducer("Home Insulation Victoria portal");
  let logoImg: PDFImage | null = null;
  const X: Ctx = { pdf, fonts, logo: async () => (logoImg ??= await pdf.embedPng(LOGO_PNG)), images: new Map() };

  const { width: W, height: H, side, top: topM, bottom, firstTop } = PDF_PAGE;
  const pageSpace = H - topM - bottom;
  const blocks = doc.blocks;
  // The signed acceptance's first page (compact) sits closer to the bar than the other documents (18px in the approved sample).
  const barGap = blocks[0]?.compact ? 12.6 : BAR_GAP;
  const firstSpace = H - firstTop - BAR_H - barGap - bottom;
  const heights = blocks.map((b) => measure(b, CONTENT_W, fonts));
  const items = blocks.map((b, i) => {
    const kids = b.kind === "section" || b.kind === "box" || b.kind === "group" ? b.children : undefined;
    let childHeights: number[] | undefined;
    if (b.kind === "section") {
      childHeights = b.children.map((c) => measure(c, CONTENT_W, fonts));
      if (childHeights.length) childHeights[0]! += sectionHead(b);
    } else if (b.kind === "group") childHeights = b.children.map((c) => measure(c, CONTENT_W, fonts));
    else if (kids) childHeights = kids.map((c) => measure(c, CONTENT_W - 2 * BOX_PAD, fonts));
    return { id: b.id, height: heights[i]!, keepTogether: b.keepTogether !== false, ...(childHeights ? { childHeights } : {}), ...(b.keepFirst !== undefined ? { keepFirst: b.keepFirst } : {}), ...(b.kind === "box" ? { partOverhead: BOX_PAD * 2 + GAP } : {}), ...(b.kind === "pageBreak" ? { pageBreak: true } : {}) };
  });
  const placed = paginateDetailed(items, firstSpace, pageSpace);

  const layout: PdfLayoutReport = { pages: 0, blockPage: {}, split: [], topBarPages: [], images: [] };
  const pages: PDFPage[] = [];
  let y = 0;
  const newPage = () => {
    const p = pdf.addPage([W, H]); pages.push(p); layout.pages = pages.length;
    if (pages.length === 1) {
      p.drawRectangle({ x: 0, y: H - firstTop - BAR_H, width: W, height: BAR_H, color: C.blue });
      layout.topBarPages.push(1);
      y = H - firstTop - BAR_H - barGap;
    } else y = H - topM;
    return p;
  };
  newPage();
  const byId = new Map(blocks.map((b, i) => [b.id, i]));
  let prevPage = 1;
  for (const pl of placed) {
    while (pages.length < pl.page) newPage();
    const page = pages[pl.page - 1]!;
    const i = byId.get(pl.id)!; const b = blocks[i]!;
    // A section that opens a page sits flush with the top margin (the web page drops the margin above it there).
    if (pl.page !== prevPage && pl.page > 1 && (b.kind === "section" || b.kind === "group") && (pl.part ?? 0) === 0) y += b.kind === "group" ? SUBH.top : HEAD_TOP;
    prevPage = pl.page;
    if (layout.blockPage[b.id] == null) layout.blockPage[b.id] = pl.page;
    if (pl.part == null) {
      await draw(b, page, pl.page, side, y, CONTENT_W, X, layout.images);
      y -= heights[i]!;
      continue;
    }
    // Split block: the page's share of children comes straight from paginate (one source of truth).
    const kids = items[i]!.childHeights!;
    const g = pl.children!;
    if (pl.part === 0) layout.split.push(b.id);
    if (b.kind === "section") await drawSection(b, page, pl.page, side, y, CONTENT_W, X, layout.images, g[0]!, g[g.length - 1]!, pl.part === 0);
    else if (b.kind === "group") await drawGroup(b, page, pl.page, side, y, CONTENT_W, X, layout.images, g[0]!, g[g.length - 1]!);
    else if (b.kind === "box") {
      const inner = CONTENT_W - 2 * BOX_PAD;
      roundRect(page, side, y, CONTENT_W, BOX_PAD * 2 + g.reduce((sum, ci) => sum + kids[ci]!, 0), 7.5, { fill: C.box });
      let yy = y - BOX_PAD;
      for (const ci of g) { await draw(b.children[ci]!, page, pl.page, side + BOX_PAD, yy, inner, X, layout.images); yy -= kids[ci]!; }
    }
    y -= g.reduce((s, ci) => s + kids[ci]!, 0) + (items[i]!.partOverhead ?? 0);
  }

  // Second pass: footer on every page now that the page count is known.
  const total = pages.length;
  pages.forEach((p, i) => {
    const bl = 16;
    text(p, PDF_FOOTER_LEFT, side, bl, fonts.r, 5.25, C.muted);
    text(p, `Page ${i + 1} of ${total}`, W - side, bl, fonts.r, 5.25, C.muted, { right: true });
  });
  return { bytes: await pdf.save(), layout };
}
