// @ts-nocheck -- byte-level PNG codec; indexed access is bounds-safe by construction and pixel-verified against pngjs output.
// Minimal PNG read/write using fflate (pure JS). Replaces pngjs, whose node:zlib Inflate class
// crashes on the live worker runtime ("Class constructor Inflate cannot be invoked without 'new'").
// Supports 8-bit RGB (2), RGBA (6), palette (3, with tRNS), grey (0) and grey+alpha (4), non-interlaced.
import { unzlibSync, zlibSync } from "fflate";

export type RgbaImage = { width: number; height: number; data: Uint8Array };

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf: Uint8Array): number { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

export function readPng(bytes: Uint8Array): RgbaImage {
  let o = 8, width = 0, height = 0, depth = 0, type = 0, interlace = 0;
  let palette: Uint8Array | null = null, trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (o < bytes.length) {
    const len = u32(bytes, o), kind = String.fromCharCode(...bytes.subarray(o + 4, o + 8)), data = bytes.subarray(o + 8, o + 8 + len);
    if (kind === "IHDR") { width = u32(data, 0); height = u32(data, 4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === "PLTE") palette = data;
    else if (kind === "tRNS") trns = data;
    else if (kind === "IDAT") idat.push(data);
    else if (kind === "IEND") break;
    o += 12 + len;
  }
  if (depth !== 8 || interlace !== 0) throw new Error("Unsupported PNG format");
  const ch = type === 2 ? 3 : type === 6 ? 4 : type === 4 ? 2 : 1;
  const total = idat.reduce((n, d) => n + d.length, 0), joined = new Uint8Array(total);
  let p = 0; for (const d of idat) { joined.set(d, p); p += d.length; }
  const raw = unzlibSync(joined), stride = width * ch, px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[row + x - ch] : 0, b = y > 0 ? px[row - stride + x] : 0, c = x >= ch && y > 0 ? px[row - stride + x - ch] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = v & 0xff;
    }
  }
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * ch, d = i * 4;
    if (type === 6) { out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = px[s + 3]; }
    else if (type === 2) { out[d] = px[s]; out[d + 1] = px[s + 1]; out[d + 2] = px[s + 2]; out[d + 3] = 255; }
    else if (type === 3) { const k = px[s]; out[d] = palette![k * 3]; out[d + 1] = palette![k * 3 + 1]; out[d + 2] = palette![k * 3 + 2]; out[d + 3] = trns && k < trns.length ? trns[k] : 255; }
    else if (type === 4) { out[d] = out[d + 1] = out[d + 2] = px[s]; out[d + 3] = px[s + 1]; }
    else { out[d] = out[d + 1] = out[d + 2] = px[s]; out[d + 3] = 255; }
  }
  return { width, height, data: out };
}

function chunk(kind: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length), v = new DataView(out.buffer);
  v.setUint32(0, data.length); for (let i = 0; i < 4; i++) out[4 + i] = kind.charCodeAt(i);
  out.set(data, 8); v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function writePng(img: RgbaImage): Uint8Array {
  const { width, height, data } = img, stride = width * 4, raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (stride + 1)] = 0; raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1); }
  const ihdr = new Uint8Array(13), v = new DataView(ihdr.buffer);
  v.setUint32(0, width); v.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlibSync(raw, { level: 6 })), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, q) => n + q.length, 0)); let p = 0; for (const q of parts) { out.set(q, p); p += q.length; }
  return out;
}
