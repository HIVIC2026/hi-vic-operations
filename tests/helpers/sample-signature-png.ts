// A small transparent PNG with a hand-drawn looking squiggle, for signature tests and rendered samples. Pure Node (zlib).
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Uint8Array) => {
  const out = new Uint8Array(12 + data.length); const v = new DataView(out.buffer);
  v.setUint32(0, data.length); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i); out.set(data, 8);
  v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length))); return out;
};

export function signaturePng(width = 240, height = 80): Uint8Array {
  const px = new Uint8Array(width * height * 4); // RGBA, transparent
  const dot = (x: number, y: number) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = Math.round(x + dx), yy = Math.round(y + dy); if (xx >= 0 && xx < width && yy >= 0 && yy < height) { const i = (yy * width + xx) * 4; px[i] = 20; px[i + 1] = 30; px[i + 2] = 90; px[i + 3] = 255; } } };
  for (let t = 0; t < 1; t += 0.0007) {
    const x = 10 + t * (width - 20);
    const y = height / 2 + Math.sin(t * 22) * (height / 4) * (1 - 0.6 * t) + Math.sin(t * 7) * 6;
    dot(x, y);
  }
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; raw.set(px.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1); }
  const ihdr = new Uint8Array(13); const v = new DataView(ihdr.buffer); v.setUint32(0, width); v.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 6;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
