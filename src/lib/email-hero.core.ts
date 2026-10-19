// @ts-nocheck -- low-level pixel/outline arithmetic over typed arrays; inputs are fixed bundled assets. Exports are covered by tests/estimate-email.test.ts.
// Save my spot (Group A) email header baked into a PNG, so Outfit 800 looks the same in every inbox.
// Pure JavaScript (font outlines + our own anti-aliased rasteriser) — no system fonts, no native or WASM code.
import opentype from "opentype.js";
import { readPng, writePng, type RgbaImage } from "./png-lite.core";
import { Buffer } from "node:buffer";
import { AMOUNT_LH, AMOUNT_SIZE, HEADER_ART_W, amountArtWidth } from "./email-art.core";
import { FIGTREE_800_WOFF, LOGO_PNG, OUTFIT_800_WOFF, PARTY_PNG } from "./email-hero-assets";

export const HERO_WIDTH = 600; // shown at 600px; drawn at 2x
const S = 2;
const W = HERO_WIDTH * S;
const NAVY: RGB = [0x22, 0x37, 0x6b];
const GREEN: RGB = [0x00, 0xbf, 0x63];
const BLUSH: RGB = [0xfd, 0xf2, 0xf6];
type RGB = [number, number, number];
type Pt = [number, number];

const b64 = (s: string) => { const b = Buffer.from(s, "base64"); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
let fonts: { outfit: opentype.Font; figtree: opentype.Font } | null = null;
const font = () => (fonts ??= { outfit: opentype.parse(b64(OUTFIT_800_WOFF)), figtree: opentype.parse(b64(FIGTREE_800_WOFF)) });
let imgs: { logo: RgbaImage; party: RgbaImage } | null = null;
const images = () => (imgs ??= { logo: readPng(new Uint8Array(Buffer.from(LOGO_PNG, "base64"))), party: readPng(new Uint8Array(Buffer.from(PARTY_PNG, "base64"))) });

class Canvas {
  data: Uint8Array;
  constructor(public w: number, public h: number) { this.data = new Uint8Array(w * h * 4).fill(255); }
  blend(x: number, y: number, c: RGB, a: number) {
    if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4; const k = Math.min(1, a);
    for (let j = 0; j < 3; j++) this.data[i + j] = Math.round(this.data[i + j] * (1 - k) + c[j] * k);
  }
  /** Non-zero winding fill of closed polygons, 16 sub-scanlines with exact horizontal coverage. */
  fill(polys: Pt[][], c: RGB) {
    const edges: [number, number, number, number, number][] = [];
    let minY = Infinity, maxY = -Infinity;
    for (const p of polys) for (let i = 0; i < p.length; i++) {
      const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length];
      if (y0 === y1) continue;
      edges.push(y0 < y1 ? [x0, y0, x1, y1, 1] : [x1, y1, x0, y0, -1]);
      minY = Math.min(minY, y0, y1); maxY = Math.max(maxY, y0, y1);
    }
    if (!edges.length) return;
    const SUB = 16;
    const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(this.h - 1, Math.ceil(maxY));
    const row = new Float32Array(this.w + 2);
    for (let y = y0; y <= y1; y++) {
      row.fill(0);
      let any = false;
      for (let s = 0; s < SUB; s++) {
        const sy = y + (s + 0.5) / SUB;
        const xs: [number, number][] = [];
        for (const [ax, ay, bx, by, d] of edges) if (sy >= ay && sy < by) xs.push([ax + ((sy - ay) / (by - ay)) * (bx - ax), d]);
        if (xs.length < 2) continue;
        xs.sort((a, b) => a[0] - b[0]);
        let wind = 0;
        for (let i = 0; i < xs.length - 1; i++) {
          wind += xs[i][1];
          if (wind === 0) continue;
          const l = Math.max(0, xs[i][0]), r = Math.min(this.w, xs[i + 1][0]);
          if (r <= l) continue;
          any = true;
          const li = Math.floor(l), ri = Math.floor(r);
          if (li === ri) { row[li] += (r - l) / SUB; continue; }
          row[li] += (li + 1 - l) / SUB;
          for (let x = li + 1; x < ri; x++) row[x] += 1 / SUB;
          if (ri < this.w) row[ri] += (r - ri) / SUB;
        }
      }
      if (any) for (let x = 0; x < this.w; x++) if (row[x] > 0) this.blend(x, y, c, row[x]);
    }
  }
  /** Area-averaged scaled draw of a PNG with alpha. */
  image(img: RgbaImage, dx: number, dy: number, dw: number, dh: number) {
    const sx = img.width / dw, sy = img.height / dh;
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx)), yy0 = Math.floor(y * sy), yy1 = Math.max(yy0 + 1, Math.floor((y + 1) * sy));
      for (let v = yy0; v < yy1 && v < img.height; v++) for (let u = x0; u < x1 && u < img.width; u++) {
        const i = (v * img.width + u) * 4; const al = img.data[i + 3] / 255;
        r += img.data[i] * al; g += img.data[i + 1] * al; b += img.data[i + 2] * al; a += al; n++;
      }
      if (a > 0) this.blend(dx + x, dy + y, [r / a, g / a, b / a], a / n);
    }
  }
  png() { return writePng({ width: this.w, height: this.h, data: new Uint8Array(this.data) }); }
}

function flatten(path: opentype.Path): Pt[][] {
  const out: Pt[][] = []; let cur: Pt[] = []; let last: Pt = [0, 0];
  const steps = 10;
  for (const c of path.commands) {
    if (c.type === "M") { if (cur.length > 2) out.push(cur); cur = [[c.x, c.y]]; last = [c.x, c.y]; }
    else if (c.type === "L") { cur.push([c.x, c.y]); last = [c.x, c.y]; }
    else if (c.type === "Q") { for (let i = 1; i <= steps; i++) { const t = i / steps, m = 1 - t; cur.push([m * m * last[0] + 2 * m * t * c.x1 + t * t * c.x, m * m * last[1] + 2 * m * t * c.y1 + t * t * c.y]); } last = [c.x, c.y]; }
    else if (c.type === "C") { for (let i = 1; i <= steps; i++) { const t = i / steps, m = 1 - t; cur.push([m * m * m * last[0] + 3 * m * m * t * c.x1 + 3 * m * t * t * c.x2 + t * t * t * c.x, m * m * m * last[1] + 3 * m * m * t * c.y1 + 3 * m * t * t * c.y2 + t * t * t * c.y]); } last = [c.x, c.y]; }
    else if (c.type === "Z") { if (cur.length > 2) out.push(cur); cur = []; }
  }
  if (cur.length > 2) out.push(cur);
  return out;
}

/** Letter-spaced text (caps lines, pill). Returns width. */
function spaced(cv: Canvas | null, f: opentype.Font, text: string, x: number, base: number, size: number, track: number, c: RGB) {
  let pen = x;
  for (const ch of text) {
    if (cv) cv.fill(flatten(f.getPath(ch, pen, base, size)), c);
    pen += f.getAdvanceWidth(ch, size) + track;
  }
  return pen - x - track;
}

function roundRect(x: number, y: number, w: number, h: number, r: number): Pt[] {
  const p: Pt[] = []; const seg = 16;
  const arc = (cx: number, cy: number, a0: number) => { for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * (Math.PI / 2); p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
  arc(x + w - r, y + r, -Math.PI / 2); arc(x + w - r, y + h - r, 0); arc(x + r, y + h - r, Math.PI / 2); arc(x + r, y + r, Math.PI);
  return p;
}

export type HeroSeg = { t: string; green?: boolean };
export type HeroSpec = { caps: string; capsColor: string; capsSize: number; emoji: boolean; segs: HeroSeg[]; size: number; lineHeight: number };
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const plainHeadline = (segs: HeroSeg[]) => segs.map((x) => x.t).join("");

/** Email header art, drawn phone-first (v7): natural width 354px = 390px phone column, so it never shrinks on a phone.
 * Logo + one-line pill, caps line (optional colour emoji), headline with green amount. Returns PNG bytes at 3x. */
export function renderHeaderArt(spec: HeroSpec): Uint8Array {
  const { outfit, figtree } = font();
  const S3 = 3, W3 = HEADER_ART_W * S3;
  const H1 = spec.size * S3, LH = spec.lineHeight * S3;
  const words: { t: string; c: RGB }[] = [];
  for (const seg of spec.segs) for (const t of seg.t.split(" ")) if (t) words.push({ t, c: seg.green ? GREEN : NAVY });
  const space = outfit.getAdvanceWidth(" ", H1);
  const lines: { t: string; c: RGB }[][] = [[]]; let lw = 0;
  for (const w of words) {
    const ww = outfit.getAdvanceWidth(w.t, H1);
    if (lines[lines.length - 1].length && lw + space + ww > W3) { lines.push([]); lw = 0; }
    lw += (lines[lines.length - 1].length ? space : 0) + ww; lines[lines.length - 1].push(w);
  }
  const logoW = 124 * S3, logoH = Math.round((124 * 61) / 142) * S3;
  const top = 22 * S3, capsTop = top + logoH + 24 * S3, capsSize = spec.capsSize * S3;
  const capsLH = Math.round(spec.capsSize * 1.3 * S3);
  const h1Top = capsTop + capsLH + 8 * S3;
  const height = h1Top + lines.length * LH + 14 * S3;
  const cv = new Canvas(W3, height);
  const { logo, party } = images();
  cv.image(logo, 0, top, logoW, logoH);
  // Pill: largest Figtree 800 size (max 11px) that fits on one line beside the logo.
  const label = "FREE ESTIMATE · NO OBLIGATION", room = W3 - logoW - 10 * S3;
  let pSize = 11 * S3, pTrack = 0.6 * S3, padX = 10 * S3;
  while (spaced(null, figtree, label, 0, 0, pSize, pTrack, NAVY) + padX * 2 > room && pSize > 9 * S3) { pSize -= 0.25 * S3; pTrack = Math.max(0.3 * S3, pTrack - 0.05 * S3); padX = Math.max(8 * S3, padX - 0.5 * S3); }
  const tw = spaced(null, figtree, label, 0, 0, pSize, pTrack, NAVY);
  const pw = tw + padX * 2, ph = Math.round(pSize * 1.2) + 13 * S3;
  const px = W3 - pw, py = top + (logoH - ph) / 2;
  cv.fill([roundRect(px, py, pw, ph, ph / 2)], BLUSH);
  const capRatio = (figtree.tables.os2?.sCapHeight ?? 700) / figtree.unitsPerEm;
  spaced(cv, figtree, label, px + padX, py + ph / 2 + (capRatio * pSize) / 2, pSize, pTrack, NAVY);
  const capsCap = capRatio * capsSize, capsBase = capsTop + capsLH / 2 + capsCap / 2;
  let cx = 0;
  if (spec.emoji) { const emo = Math.round(14 * S3); cv.image(party, cx, Math.round(capsBase - capsCap / 2 - emo / 2), emo, emo); cx += emo + 5 * S3; }
  spaced(cv, figtree, spec.caps.toUpperCase(), cx, capsBase, capsSize, 1.4 * S3, hex(spec.capsColor));
  const asc = outfit.ascender / outfit.unitsPerEm * H1, desc = -outfit.descender / outfit.unitsPerEm * H1;
  lines.forEach((ln, i) => {
    const base = h1Top + i * LH + (LH - (asc + desc)) / 2 + asc;
    let pen = 0;
    for (const w of ln) { cv.fill(flatten(outfit.getPath(w.t, pen, base, H1)), w.c); pen += outfit.getAdvanceWidth(w.t, H1) + space; }
  });
  return cv.png();
}

/** Card heading art: "h2" = Outfit 800 23/28 navy; "caps" = Figtree 800 11px, 1.4px tracking. 3x, on the card colour. */
export function measureHeading(text: string, style: "h2" | "caps") {
  const { outfit, figtree } = font();
  if (style === "h2") return { w: Math.ceil(outfit.getAdvanceWidth(text, 23)) + 2, h: 28 };
  return { w: Math.ceil(spaced(null, figtree, text.toUpperCase(), 0, 0, 11, 1.4, NAVY)) + 2, h: 15 };
}
export function renderHeadingArt(text: string, style: "h2" | "caps", bg: string): Uint8Array {
  const { outfit, figtree } = font();
  const S3 = 3, m = measureHeading(text, style);
  const cv = new Canvas(m.w * S3, m.h * S3); const b = hex(bg);
  for (let i = 0; i < cv.data.length; i += 4) { cv.data[i] = b[0]; cv.data[i + 1] = b[1]; cv.data[i + 2] = b[2]; }
  if (style === "h2") {
    const size = 23 * S3, asc = outfit.ascender / outfit.unitsPerEm * size, desc = -outfit.descender / outfit.unitsPerEm * size;
    cv.fill(flatten(outfit.getPath(text, S3, (cv.h - (asc + desc)) / 2 + asc, size)), NAVY);
  } else {
    const size = 11 * S3, cap = ((figtree.tables.os2?.sCapHeight ?? 700) / figtree.unitsPerEm) * size;
    spaced(cv, figtree, text.toUpperCase(), S3, cv.h / 2 + cap / 2, size, 1.4 * S3, NAVY);
  }
  return cv.png();
}

/** "You pay about" amount in Outfit 800 navy, 34/38px, on the estimate card's mist background. Width = text width. */
export function renderAmountArt(text: string, bg = "#F3F6FF"): Uint8Array {
  const { outfit } = font();
  const w = amountArtWidth(text) * S, h = AMOUNT_LH * S, size = AMOUNT_SIZE * S;
  const cv = new Canvas(w, h); const b = hex(bg);
  for (let i = 0; i < cv.data.length; i += 4) { cv.data[i] = b[0]; cv.data[i + 1] = b[1]; cv.data[i + 2] = b[2]; }
  const asc = outfit.ascender / outfit.unitsPerEm * size, desc = -outfit.descender / outfit.unitsPerEm * size;
  cv.fill(flatten(outfit.getPath(text, S, (h - (asc + desc)) / 2 + asc, size)), NAVY);
  return cv.png();
}

/** Back-compat: Group A header. */
export function renderEmailHeroPng(firstName: string | null, rebate: string): Uint8Array {
  return renderHeaderArt(campaignHeroSpec("likely", firstName, rebate));
}

/** Header art copy for each campaign email; the HTML renderers use the same specs for alt text. */
export function campaignHeroSpec(kind: "likely" | "onsite" | "spot", firstName: string | null, rebate: string): HeroSpec {
  const name = firstName?.trim().replace(/\s+/g, " ").slice(0, 40) || null;
  if (kind === "likely") return { caps: "Your rebate is waiting", capsColor: "#00BF63", capsSize: 11, emoji: true, size: 32, lineHeight: 37, segs: [{ t: `Great news${name ? `, ${name}` : ""}! You could take ` }, { t: rebate, green: true }, { t: " off your ceiling insulation" }] };
  if (kind === "onsite") {
    const segs = [{ t: `${name ? `${name}, take` : "Take"} ` }, { t: rebate, green: true }, { t: " off your ceiling insulation" }];
    return { caps: "Jump the queue", capsColor: "#067A45", capsSize: 11, emoji: false, size: 32, lineHeight: 37, segs };
  }
  return { caps: "You're on the list", capsColor: "#067A45", capsSize: 11, emoji: false, size: 32, lineHeight: 37, segs: [{ t: `Spot saved${name ? `, ${name}` : ""}. Your ` }, { t: rebate, green: true }, { t: " rebate is waiting." }] };
}
