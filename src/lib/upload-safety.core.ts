// Pure upload/serving safety rules (security review A, Jo 6 Oct). No I/O.
// Uploads: only the listed types, and the stored bytes must match the claimed type.
// Serving: only PDFs and raster images open inline; everything else downloads as octet-stream. Never HTML or SVG.

export const SAFE_UPLOAD_TYPES: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif",
  mp4: "video/mp4", mov: "video/quicktime",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
/** Extra types accepted only for installer bulk-import source files (read by the importer, always served as downloads). */
export const IMPORT_EXTRA_TYPES: Record<string, string> = { csv: "text/csv", txt: "text/plain", eml: "message/rfc822", zip: "application/zip", xls: "application/vnd.ms-excel" };

const NEVER = /(html|xml|svg|javascript|ecmascript|x-sh|x-php|xhtml)/i;
const ext = (name: string) => (name.split(".").pop() ?? "").toLowerCase();

/** Normalised mime for an allowed upload, or null. The extension decides; a claimed mime must agree with it. */
export function allowedUpload(fileName: string, claimedMime: string | null | undefined, opts: { imports?: boolean } = {}): string | null {
  const table = opts.imports ? { ...SAFE_UPLOAD_TYPES, ...IMPORT_EXTRA_TYPES } : SAFE_UPLOAD_TYPES;
  const m = table[ext(fileName)];
  if (!m) return null;
  const c = (claimedMime ?? "").toLowerCase().split(";")[0]!.trim();
  if (c && NEVER.test(c)) return null;
  if (c && c !== "application/octet-stream" && c !== m && !(m.startsWith("image/hei") && c.startsWith("image/hei")) && !(m === "text/csv" && c === "application/vnd.ms-excel")) return null;
  return m;
}

const at = (b: Uint8Array, off: number, sig: number[]) => sig.every((v, i) => b[off + i] === v);
const ascii = (b: Uint8Array, off: number, n: number) => String.fromCharCode(...b.subarray(off, off + n));

/** Sniffs the first bytes. Returns a mime family or null. */
export function sniffType(b: Uint8Array): string | null {
  if (at(b, 0, [0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  if (at(b, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at(b, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "image/webp";
  if (ascii(b, 4, 4) === "ftyp") {
    const brand = ascii(b, 8, 4);
    if (/^(heic|heix|heim|heis|hevc|hevx|mif1|msf1|avif)$/.test(brand)) return "image/heic";
    if (brand === "qt  ") return "video/quicktime";
    return "video/mp4";
  }
  if (at(b, 0, [0x50, 0x4b, 0x03, 0x04])) return "application/zip";
  return null;
}

/** True when the stored bytes match the allowed mime. Office files are ZIP containers. Text import types must not look like HTML. */
export function signatureMatches(bytes: Uint8Array, mime: string): boolean {
  const s = sniffType(bytes);
  if (mime.startsWith("text/") || mime === "message/rfc822") {
    if (s) return false;
    const head = new TextDecoder().decode(bytes.subarray(0, 512)).toLowerCase();
    return !/<\s*(html|script|svg|!doctype|iframe|body)/.test(head);
  }
  if (mime === "application/vnd.ms-excel") return at(bytes, 0, [0xd0, 0xcf, 0x11, 0xe0]);
  if (!s) return false;
  if (s === "application/zip") return mime === "application/zip" || mime.includes("openxmlformats");
  if (s === "image/heic") return mime.startsWith("image/hei");
  if (s === "video/mp4" || s === "video/quicktime") return mime === "video/mp4" || mime === "video/quicktime";
  return s === mime;
}

const INLINE_OK = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif", "video/mp4", "video/quicktime", "video/webm"]);

/** Response headers for serving a stored file on our own domain. */
export function servedFileHeaders(storedMime: string | null | undefined, fileName: string, wantDownload: boolean): Record<string, string> {
  const m = (storedMime ?? "").toLowerCase().split(";")[0]!.trim();
  const byExt = SAFE_UPLOAD_TYPES[ext(fileName)];
  const type = m && m !== "application/octet-stream" ? m : byExt ?? "application/octet-stream";
  const inline = !wantDownload && INLINE_OK.has(type);
  const safeName = fileName.replace(/["\\\r\n]/g, "").slice(0, 150) || "file";
  return {
    "Content-Type": inline ? type : "application/octet-stream",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
    // Chrome refuses to show a PDF in a sandboxed document, so PDFs get a locked-down policy without "sandbox"; everything else is sandboxed.
    "Content-Security-Policy": inline && type === "application/pdf" ? "default-src 'none'; object-src 'self'; plugin-types application/pdf" : "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };
}
