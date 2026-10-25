// Decision 336 samples only: a made-up handwritten-looking signature as a PNG (ink strokes on white), so the sample official
// PIESA / PIISA Word forms show a signature PICTURE the way a real Mitti signature image would sit in the box. Not a real
// signature, never used by the portal. Pure: deterministic bytes from the seed text (node:zlib for the PNG deflate).
import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A deterministic sample signature PNG (RGB, white background, dark-blue ink). */
export function sampleSignaturePng(seed: string, width = 360, height = 110): Uint8Array {
  const px = new Uint8Array(width * height * 3).fill(255);
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rnd = () => ((h = (Math.imul(h, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const dot = (x: number, y: number, r: number) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const X = Math.round(x + dx), Y = Math.round(y + dy);
      if (X < 0 || Y < 0 || X >= width || Y >= height || dx * dx + dy * dy > r * r) continue;
      const o = (Y * width + X) * 3; px[o] = 20; px[o + 1] = 40; px[o + 2] = 120;
    }
  };
  // Two "words" of looping cursive strokes plus an underline flourish.
  const words = [[0.06, 0.42], [0.47, 0.9]] as const;
  for (const [a, b] of words) {
    const loops = 5 + Math.floor(rnd() * 3), amp = height * (0.18 + rnd() * 0.08), phase = rnd() * Math.PI;
    for (let t = 0; t <= 1; t += 0.0008) {
      const x = width * (a + (b - a) * t) + Math.sin(t * loops * 2 * Math.PI) * 9;
      const y = height * 0.48 - Math.cos(t * loops * 2 * Math.PI + phase) * amp * (0.6 + 0.4 * Math.sin(t * Math.PI));
      dot(x, y, 1.6);
    }
  }
  for (let t = 0; t <= 1; t += 0.001) dot(width * (0.08 + 0.8 * t), height * (0.8 - 0.06 * Math.sin(t * Math.PI)), 1.2);
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 3 + 1)] = 0; raw.set(px.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1); }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
