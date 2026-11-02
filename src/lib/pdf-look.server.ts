// Website-look PDF renderer (Open Sans, blue top bar, business block, footer with "Page N of M"). No database, no network.
// Layout rules are pure (pdf-look.core.ts); this file measures with the embedded fonts, paginates, draws, then writes the footers.
import { PDFDocument, rgb, setCharacterSpacing, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { LOGO_PNG } from "./email-hero-assets";
import { OPEN_SANS_400, OPEN_SANS_700, OPEN_SANS_700_ITALIC, OPEN_SANS_800 } from "./pdf-fonts.data";
import { pdfSafeText } from "./pdf-text.core";
import {
  BUSINESS_ADDRESS, BUSINESS_LINES, PDF_COLOURS, PDF_FOOTER_LEFT, PDF_PAGE, paginateDetailed, wrapText,
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
      return Math.max(LOGO_H, n * BIZ_LH) + 18.2 + 11.4;
    }
    case "title": return 2.8 + lines(F.x, H1, b.text, w).length * H1_LH + (b.sub ? 2.8 + lines(F.r, SUB, b.sub, w).length * SUB_LH : 0) + 11.2;
    case "para": { const s = b.small ? SMALL : BODY; const lh = b.small ? SMALL_LH : BODY_LH; return (b.lead ? runLines(F, s, b.lead, b.text, w) : lines(F.r, s, b.text, w)).length * lh + GAP; }
    case "facts": return factRows(b.rows).reduce((s, r) => s + factRowH(r, w, F), 0) + 4.2;
    case "section": return sectionHead(b) + b.children.reduce((s, c) => s + measure(c, w, F), 0);
    case "bullets": return b.items.reduce((s, t, i) => s + runLines(F, BODY, b.leads?.[i] ?? "", t, w - BULLET_INDENT).length * BODY_LH + BULLET_GAP, 0);
    case "money": return b.rows.reduce((s, r) => s + moneyRowH(r), 0) + 1 + 5.6;
    case "ticks": return b.items.reduce((s, t) => s + Math.max(11, lines(F.r, BODY, t, w - 16).length * BODY_LH) + 2, 0) + GAP;
    case "signature": return 3 + sigH(b, w, F) + (b.sub ? 2 + lines(F.r, SMALL, b.sub, w).length * SMALL_LH : 0) + GAP;
    case "box": return BOX_PAD * 2 + b.children.reduce((s, c) => s + measure(c, w - 2 * BOX_PAD, F), 0) + GAP;
    case "image": return b.height + GAP;
    case "pageBreak": return 0;
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
const moneyRowH = (r: { strong?: boolean; label?: string }) => {
  const n = r.label ? r.label.split("\n").length : 1;
  return r.strong ? 24 : n > 1 ? 9.8 + BODY_LH + (n - 1) * 11.4 + 0.7 : 22.4;
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

// ---- drawing --------------------------------------------------------------------------------------------------------
type Img = { block: string; page: number };
async function draw(b: PdfBlock, page: PDFPage, pageNo: number, x: number, top: number, w: number, X: Ctx, imgs: Img[]): Promise<void> {
  const F = X.fonts;
  switch (b.kind) {
    case "header": {
      const logo = await X.logo();
      page.drawImage(logo, { x, y: top - LOGO_H, width: LOGO_W, height: LOGO_H });
      const biz = b.withAddress ? [...BUSINESS_LINES, BUSINESS_ADDRESS] : [...BUSINESS_LINES];
      biz.forEach((l, i) => text(page, l, x + w, base(top - i * BIZ_LH, BIZ_LH, BIZ), F.r, BIZ, C.muted, { right: true }));
      const rowH = Math.max(LOGO_H, biz.length * BIZ_LH);
      text(page, b.eyebrow, x, base(top - rowH - 18.2, 11.4, EYEBROW), F.b, EYEBROW, C.blue, { spacing: 1.23 });
      return;
    }
    case "title": {
      let y = top - 2.8;
      const t = lines(F.x, H1, b.text, w);
      drawLines(page, t, x, y, F.x, H1, H1_LH, C.ink); y -= t.length * H1_LH;
      if (b.sub) { y -= 2.8; drawLines(page, lines(F.r, SUB, b.sub, w), x, y, F.r, SUB, SUB_LH, C.muted); }
      return;
    }
    case "para": {
      const s = b.small ? SMALL : BODY; const lh = b.small ? SMALL_LH : BODY_LH;
      if (b.lead) drawRuns(page, runLines(F, s, b.lead, b.text, w), x, top, F, s, lh, b.muted || b.small ? C.muted : C.ink);
      else drawLines(page, lines(F.r, s, b.text, w), x, top, F.r, s, lh, b.muted || b.small ? C.muted : C.ink);
      return;
    }
    case "facts": {
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
      let y = top - 1;
      b.rows.forEach((r, i) => {
        const h = moneyRowH(r);
        const size = r.strong ? 9.8 : BODY; const f = r.strong ? F.b : F.r;
        const col = r.green ? C.dgreen : C.ink;
        const bl = base(y - 0.35, h, size);
        const parts = r.label.split("\n");
        if (parts.length > 1 && !r.strong) {
          // Multi-line label: bold first line, muted detail lines under it.
          text(page, parts[0]!, x, base(y - 4.9, BODY_LH, size), F.b, size, C.ink);
          parts.slice(1).forEach((l, li) => text(page, l, x, base(y - 4.9 - BODY_LH - li * 11.4, 11.4, BODY), F.r, BODY, C.muted));
        } else text(page, r.label, x, bl, r.strong ? F.b : F.r, size, r.green ? C.dgreen : C.ink);
        text(page, r.amount, x + w, bl, f, size, col, { right: true });
        y -= h;
        if (!r.strong && i < b.rows.length - 1) page.drawLine({ start: { x, y }, end: { x: x + w, y }, thickness: 0.75, color: C.line });
      });
      return;
    }
    case "ticks": {
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
    case "pageBreak": return;
  }
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
  const firstSpace = H - firstTop - BAR_H - BAR_GAP - bottom;
  const blocks = doc.blocks;
  const heights = blocks.map((b) => measure(b, CONTENT_W, fonts));
  const items = blocks.map((b, i) => {
    const kids = b.kind === "section" || b.kind === "box" ? b.children : undefined;
    let childHeights: number[] | undefined;
    if (b.kind === "section") {
      childHeights = b.children.map((c) => measure(c, CONTENT_W, fonts));
      if (childHeights.length) childHeights[0]! += sectionHead(b);
    } else if (kids) childHeights = kids.map((c) => measure(c, CONTENT_W - 2 * BOX_PAD, fonts));
    return { id: b.id, height: heights[i]!, keepTogether: b.keepTogether !== false, ...(childHeights ? { childHeights } : {}), ...(b.kind === "box" ? { partOverhead: BOX_PAD * 2 + GAP } : {}), ...(b.kind === "pageBreak" ? { pageBreak: true } : {}) };
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
      y = H - firstTop - BAR_H - BAR_GAP;
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
    if (pl.page !== prevPage && pl.page > 1 && b.kind === "section" && (pl.part ?? 0) === 0) y += HEAD_TOP;
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
