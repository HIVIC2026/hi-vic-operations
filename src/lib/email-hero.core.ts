// Save my spot (Group A) email header baked into a PNG, so Outfit 800 looks the same in every inbox.
// Pure JavaScript (font outlines + our own anti-aliased rasteriser) — no system fonts, no native or WASM code.
import opentype from "opentype.js";
import { PNG } from "pngjs";
import { Buffer } from "node:buffer";
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
let imgs: { logo: PNG; party: PNG } | null = null;
const images = () => (imgs ??= { logo: PNG.sync.read(Buffer.from(LOGO_PNG, "base64")), party: PNG.sync.read(Buffer.from(PARTY_PNG, "base64")) });

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
  image(img: PNG, dx: number, dy: number, dw: number, dh: number) {
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
  png() { const p = new PNG({ width: this.w, height: this.h }); p.data = Buffer.from(this.data); return PNG.sync.write(p); }
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

export function heroHeadline(firstName: string | null, rebate: string) {
  return `Great news${firstName ? `, ${firstName}` : ""}! You could take ${rebate} off your ceiling insulation`;
}

/** Renders the Group A header (logo + pill, caps line with emoji, headline). Returns PNG bytes. */
export function renderEmailHeroPng(firstName: string | null, rebate: string): Uint8Array {
  const { outfit, figtree } = font();
  const name = firstName?.trim().replace(/\s+/g, " ").slice(0, 40) || null;
  // Layout in 1x email pixels, matching the live HTML: 22px top, 142x61 logo, 26px gap, 11px caps, 8px gap, 32/37 headline, 568px text width.
  const PAD = 16, TEXT_W = HERO_WIDTH - PAD * 2;
  const H1 = 32 * S, LH = 37 * S;
  const words: { t: string; c: RGB }[] = [];
  const pre = `Great news${name ? `, ${name}` : ""}! You could take`;
  for (const t of pre.split(" ")) words.push({ t, c: NAVY });
  words.push({ t: rebate, c: GREEN });
  for (const t of "off your ceiling insulation".split(" ")) words.push({ t, c: NAVY });
  const space = outfit.getAdvanceWidth(" ", H1);
  const lines: { t: string; c: RGB }[][] = [[]]; let lw = 0;
  for (const w of words) {
    const ww = outfit.getAdvanceWidth(w.t, H1);
    if (lines[lines.length - 1].length && lw + space + ww > TEXT_W * S) { lines.push([]); lw = 0; }
    lw += (lines[lines.length - 1].length ? space : 0) + ww; lines[lines.length - 1].push(w);
  }
  const top = 22 * S, logoH = 61 * S, capsTop = top + logoH + 26 * S, capsSize = 11 * S;
  const h1Top = capsTop + Math.round(14.3 * S) + 8 * S;
  const height = h1Top + lines.length * LH + 14 * S;
  const cv = new Canvas(W, height);
  const { logo, party } = images();
  cv.image(logo, PAD * S, top, 142 * S, logoH);
  // Pill: 10px Figtree 800, .7px tracking, 7x11 padding, right-aligned, vertically centred on the logo.
  const pSize = 10 * S, pTrack = 0.7 * S, label = "FREE ESTIMATE · NO OBLIGATION";
  const tw = spaced(null, figtree, label, 0, 0, pSize, pTrack, NAVY);
  const pw = tw + 22 * S, ph = Math.round(pSize * 1.2) + 14 * S;
  const px = W - PAD * S - pw, py = top + (logoH - ph) / 2;
  cv.fill([roundRect(px, py, pw, ph, ph / 2)], BLUSH);
  const capH = (figtree.tables.os2?.sCapHeight ?? 700) / figtree.unitsPerEm * pSize;
  spaced(cv, figtree, label, px + 11 * S, py + ph / 2 + capH / 2, pSize, pTrack, NAVY);
  // Caps line with colour emoji.
  const emo = Math.round(13 * S), capsCap = (figtree.tables.os2?.sCapHeight ?? 700) / figtree.unitsPerEm * capsSize;
  const capsBase = capsTop + Math.round(7 * S) + capsCap / 2;
  cv.image(party, PAD * S, Math.round(capsBase - capsCap / 2 - emo / 2), emo, emo);
  spaced(cv, figtree, "YOUR REBATE IS WAITING", PAD * S + emo + 5 * S, capsBase, capsSize, 1.4 * S, GREEN);
  // Headline.
  const asc = outfit.ascender / outfit.unitsPerEm * H1, desc = -outfit.descender / outfit.unitsPerEm * H1;
  lines.forEach((ln, i) => {
    const base = h1Top + i * LH + (LH - (asc + desc)) / 2 + asc;
    let pen = PAD * S;
    for (const w of ln) { cv.fill(flatten(outfit.getPath(w.t, pen, base, H1)), w.c); pen += outfit.getAdvanceWidth(w.t, H1) + space; }
  });
  return cv.png();
}
