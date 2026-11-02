// Website-look PDF renderer (Open Sans, blue top bar, business block, footer with "Page N of M"). No database, no network.
// Layout rules are pure (pdf-look.core.ts); this file measures with the embedded fonts, paginates, draws, then writes the footers.
import { PDFDocument, rgb, setCharacterSpacing, degrees, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { LOGO_PNG } from "./email-hero-assets";
import { OPEN_SANS_400, OPEN_SANS_700, OPEN_SANS_800 } from "./pdf-fonts.data";
import { pdfSafeText } from "./pdf-text.core";
import {
  BUSINESS_ADDRESS, BUSINESS_LINES, PDF_COLOURS, PDF_FOOTER_LEFT, PDF_PAGE, packChildren, paginate, wrapText,
  type PdfBlock, type PdfDoc, type PdfLayoutReport,
} from "./pdf-look.core";

const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = {
  blue: hex(PDF_COLOURS.blue), ink: hex(PDF_COLOURS.ink), green: hex(PDF_COLOURS.green), box: hex(PDF_COLOURS.box),
  muted: hex(PDF_COLOURS.muted), line: hex("#e3e8f2"), dgreen: hex("#07a554"), white: rgb(1, 1, 1),
};
const BODY = 7.7, BODY_LH = 10.25, SMALL = 7.1, SMALL_LH = 9.4, LABEL = 6.75, GAP = 5;
const BAR_H = 6, BAR_GAP = 13.5, LOGO_H = 34.5, LOGO_W = 34.5 * (400 / 171);
const CONTENT_W = PDF_PAGE.width - 2 * PDF_PAGE.side;
const PAGE_BOTTOM = PDF_PAGE.bottom;

type Fonts = { r: PDFFont; b: PDFFont; x: PDFFont };
type Ctx = { pdf: PDFDocument; fonts: Fonts; logo: () => Promise<PDFImage>; images: Map<string, PDFImage> };

/** Every string in the document goes through the Open Sans character set (ids, kinds and image bytes are left alone). */
function sanitize<T>(v: T, safe: (s: string) => string, key = ""): T {
  if (typeof v === "string") return (key === "id" || key === "kind" ? v : safe(v)) as T;
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
  page.drawText(s, { x: px, y: baseline, font: f, size, color, ...(o.skew ? { xSkew: degrees(0), ySkew: degrees(12) } : {}) });
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
      return Math.max(LOGO_H, n * 11.25) + 9 + 10.6 + 4;
    }
    case "title": return 3 + lines(F.x, 14.25, b.text, w).length * 16.4 + (b.sub ? 1.5 + lines(F.r, 7.9, b.sub, w).length * 10.5 : 0) + 9;
    case "para": { const s = b.small ? SMALL : BODY; const lh = b.small ? SMALL_LH : BODY_LH; return lines(F.r, s, b.text, w).length * lh + GAP; }
    case "facts": return factRows(b.rows).reduce((s, r) => s + factRowH(r, w, F), 0) + GAP + 3;
    case "section": return sectionHead(b) + b.children.reduce((s, c) => s + measure(c, w, F), 0);
    case "bullets": return b.items.reduce((s, t) => s + lines(F.r, BODY, t, w - 12).length * BODY_LH + 1, 0) + GAP;
    case "money": return b.rows.reduce((s, r) => s + moneyRowH(r), 0) + GAP;
    case "ticks": return b.items.reduce((s, t) => s + Math.max(11, lines(F.r, BODY, t, w - 16).length * BODY_LH) + 2, 0) + GAP;
    case "signature": return 3 + sigH(b, w, F) + (b.sub ? 2 + lines(F.r, SMALL, b.sub, w).length * SMALL_LH : 0) + GAP;
    case "box": return BOX_PAD * 2 + b.children.reduce((s, c) => s + measure(c, w - 2 * BOX_PAD, F), 0) + GAP;
    case "image": return b.height + GAP;
    case "pageBreak": return 0;
  }
}
const BOX_PAD = 7.5;
const sectionHead = (b: { number?: string }) => 7.5 + 13 + 3 + 1.1 + 4 + (b.number ? 0 : 0);
const moneyRowH = (r: { strong?: boolean }) => (r.strong ? 19 : 14);
const factRows = (rows: [string, string][]) => { const out: [string, string][][] = []; for (let i = 0; i < rows.length; i += 2) out.push(rows.slice(i, i + 2)); return out; };
const FACT_PAD_X = 7.5, FACT_PAD_Y = 3.75;
function factCellH(c: [string, string], w: number, F: Fonts) { return FACT_PAD_Y * 2 + 8.5 + lines(F.r, BODY, c[1], w - 2 * FACT_PAD_X).length * BODY_LH; }
function factRowH(r: [string, string][], w: number, F: Fonts) { const cw = r.length === 2 ? w / 2 : w; return Math.max(...r.map((c) => factCellH(c, cw, F))); }
function sigH(b: { name: string; label: string; at: string }, w: number, F: Fonts) {
  const nameW = w * 0.62 - 15;
  return 5 + 8.5 + Math.max(lines(F.b, 11.25, b.name, nameW).length * 14, 14) + 5;
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
      biz.forEach((l, i) => text(page, l, x + w, base(top - i * 11.25, 11.25, 7.5), F.r, 7.5, C.muted, { right: true }));
      const rowH = Math.max(LOGO_H, biz.length * 11.25);
      text(page, b.eyebrow, x, base(top - rowH - 9, 10.6, 7.9), F.b, 7.9, C.blue, { spacing: 1.1 });
      return;
    }
    case "title": {
      let y = top - 3;
      const t = lines(F.x, 14.25, b.text, w);
      drawLines(page, t, x, y, F.x, 14.25, 16.4, C.ink); y -= t.length * 16.4;
      if (b.sub) { y -= 1.5; drawLines(page, lines(F.r, 7.9, b.sub, w), x, y, F.r, 7.9, 10.5, C.muted); }
      return;
    }
    case "para": {
      const s = b.small ? SMALL : BODY; const lh = b.small ? SMALL_LH : BODY_LH;
      drawLines(page, lines(F.r, s, b.text, w), x, top, F.r, s, lh, b.muted || b.small ? C.muted : C.ink);
      return;
    }
    case "facts": {
      const rows = factRows(b.rows);
      const hs = rows.map((r) => factRowH(r, w, F));
      const total = hs.reduce((s, h) => s + h, 0);
      roundRect(page, x, top, w, total, 7.5, { fill: C.box, stroke: C.line });
      let y = top;
      rows.forEach((r, ri) => {
        r.forEach((c, ci) => {
          const cw = r.length === 2 ? w / 2 : w; const cx = x + ci * cw;
          text(page, c[0].toUpperCase(), cx + FACT_PAD_X, base(y - FACT_PAD_Y, 8.5, LABEL), F.b, LABEL, C.muted, { spacing: 0.5 });
          drawLines(page, lines(F.r, BODY, c[1], cw - 2 * FACT_PAD_X), cx + FACT_PAD_X, y - FACT_PAD_Y - 8.5, F.r, BODY, BODY_LH, C.ink);
          if (ci === 0 && r.length === 2) page.drawLine({ start: { x: cx + cw, y }, end: { x: cx + cw, y: y - hs[ri]! }, thickness: 0.75, color: C.line });
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
      for (const t of b.items) {
        const ls = lines(F.r, BODY, t, w - 12);
        page.drawCircle({ x: x + 4, y: base(y, BODY_LH, BODY) + BODY * 0.33, size: 1.2, color: C.ink });
        drawLines(page, ls, x + 12, y, F.r, BODY, BODY_LH, C.ink);
        y -= ls.length * BODY_LH + 1;
      }
      return;
    }
    case "money": {
      let y = top;
      b.rows.forEach((r, i) => {
        const h = moneyRowH(r);
        const size = r.strong ? 9.75 : 8.6; const f = r.strong ? F.x : F.r;
        const col = r.green ? C.dgreen : r.strong ? C.ink : C.ink;
        const bl = base(y, h, size);
        text(page, r.label, x, bl, r.strong ? F.b : F.r, size, r.green ? C.dgreen : C.ink);
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
      drawLines(page, lines(F.b, 11.25, b.name, w1 - 15), x + 7.5, y0 - 5 - 8.5, F.b, 11.25, 14, C.ink);
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

/** Draws a section's heading (first part only) and children[from..to]; returns nothing, caller advances. */
async function drawSection(b: Extract<PdfBlock, { kind: "section" }>, page: PDFPage, pageNo: number, x: number, top: number, w: number, X: Ctx, imgs: Img[], from: number, to: number, head: boolean) {
  const F = X.fonts;
  let y = top;
  if (head) {
    const hy = y - 7.5;
    let tx = x;
    if (b.number) {
      page.drawCircle({ x: x + 6, y: hy - 6.5, size: 6, color: C.blue });
      const nw = tw(F.b, 7, b.number);
      text(page, b.number, x + 6 - nw / 2, hy - 6.5 - 2.4, F.b, 7, C.white);
      tx = x + 17;
    }
    text(page, b.title, tx, base(hy, 13, 9.75), F.b, 9.75, C.ink);
    page.drawLine({ start: { x, y: hy - 16 }, end: { x: x + w, y: hy - 16 }, thickness: 1.1, color: C.ink });
    y -= sectionHead(b);
  }
  for (let i = from; i <= to; i++) { const c = b.children[i]!; await draw(c, page, pageNo, x, y, w, X, imgs); y -= measure(c, w, F); }
}

// ---- render ---------------------------------------------------------------------------------------------------------
export async function renderPdf(input: PdfDoc): Promise<{ bytes: Uint8Array; layout: PdfLayoutReport }> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const embed = (b64: string) => pdf.embedFont(Buffer.from(b64, "base64"), { subset: true });
  const fonts: Fonts = { r: await embed(OPEN_SANS_400), b: await embed(OPEN_SANS_700), x: await embed(OPEN_SANS_800) };
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
    return { id: b.id, height: heights[i]!, keepTogether: b.keepTogether !== false, ...(childHeights ? { childHeights } : {}), ...(b.kind === "pageBreak" ? { pageBreak: true } : {}) };
  });
  const placed = paginate(items, firstSpace, pageSpace);

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
  const splitGroups = new Map<string, number[][]>();
  const byId = new Map(blocks.map((b, i) => [b.id, i]));
  for (const pl of placed) {
    while (pages.length < pl.page) newPage();
    const page = pages[pl.page - 1]!;
    const i = byId.get(pl.id)!; const b = blocks[i]!;
    if (layout.blockPage[b.id] == null) layout.blockPage[b.id] = pl.page;
    if (pl.part == null) {
      await draw(b, page, pl.page, side, y, CONTENT_W, X, layout.images);
      y -= heights[i]!;
      continue;
    }
    // Split block: this page's share of children (groups are worked out once, at part 0, from the space left there).
    const kids = items[i]!.childHeights!;
    if (pl.part === 0) { splitGroups.set(b.id, packChildren(kids, y - bottom, pageSpace)); layout.split.push(b.id); }
    const g = splitGroups.get(b.id)![pl.part]!;
    if (b.kind === "section") await drawSection(b, page, pl.page, side, y, CONTENT_W, X, layout.images, g[0]!, g[g.length - 1]!, pl.part === 0);
    else if (b.kind === "box") {
      const inner = CONTENT_W - 2 * BOX_PAD;
      roundRect(page, side, y, CONTENT_W, BOX_PAD * 2 + g.reduce((sum, ci) => sum + kids[ci]!, 0), 7.5, { fill: C.box });
      let yy = y - BOX_PAD;
      for (const ci of g) { await draw(b.children[ci]!, page, pl.page, side + BOX_PAD, yy, inner, X, layout.images); yy -= kids[ci]!; }
    }
    y -= g.reduce((s, ci) => s + kids[ci]!, 0);
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
