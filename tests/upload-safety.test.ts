import { describe, expect, test } from "bun:test";
import { allowedUpload, servedFileHeaders, signatureMatches, sniffType } from "../src/lib/upload-safety.core";
const b = (...n: number[]) => new Uint8Array([...n, ...new Array(32).fill(0)]);
const s = (t: string) => new TextEncoder().encode(t);
describe("upload safety (review A)", () => {
  test("only listed types", () => {
    expect(allowedUpload("a.pdf", "application/pdf")).toBe("application/pdf");
    expect(allowedUpload("a.HEIC", "image/heif")).toBe("image/heic");
    for (const n of ["a.html", "a.svg", "a.htm", "a.js", "a.exe", "a.csv", "a.zip"]) expect(allowedUpload(n, null)).toBeNull();
    expect(allowedUpload("a.png", "text/html")).toBeNull();
    expect(allowedUpload("a.png", "image/svg+xml")).toBeNull();
    expect(allowedUpload("rows.csv", "text/csv", { imports: true })).toBe("text/csv");
    expect(allowedUpload("x.svg", null, { imports: true })).toBeNull();
  });
  test("signatures", () => {
    expect(sniffType(s("%PDF-1.7"))).toBe("application/pdf");
    expect(signatureMatches(b(0xff, 0xd8, 0xff, 0xe0), "image/jpeg")).toBe(true);
    expect(signatureMatches(s("<svg xmlns=...>"), "image/png")).toBe(false);
    expect(signatureMatches(s("<!doctype html><script>"), "application/pdf")).toBe(false);
    expect(signatureMatches(b(0x50, 0x4b, 0x03, 0x04), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(true);
    expect(signatureMatches(s("\0\0\0\x18ftypqt  "), "video/quicktime")).toBe(true);
    expect(signatureMatches(s("name,phone\nJo,1"), "text/csv")).toBe(true);
    expect(signatureMatches(s("<html><body>hi"), "text/plain")).toBe(false);
  });
  test("serving", () => {
    const pdf = servedFileHeaders("application/pdf", "c.pdf", false);
    expect(pdf["Content-Type"]).toBe("application/pdf"); expect(pdf["Content-Disposition"]).toStartWith("inline");
    for (const [m, n] of [["text/html", "x.html"], ["image/svg+xml", "x.svg"], ["text/plain", "x.txt"], ["application/zip", "x.zip"]]) {
      const h = servedFileHeaders(m, n, false);
      expect(h["Content-Type"]).toBe("application/octet-stream"); expect(h["Content-Disposition"]).toStartWith("attachment"); expect(h["Content-Security-Policy"]).toStartWith("sandbox");
    }
    expect(servedFileHeaders("image/png", "p.png", false)["Content-Security-Policy"]).toStartWith("sandbox");
    expect(servedFileHeaders("video/quicktime", "v.mov", false)["Content-Disposition"]).toStartWith("inline");
    expect(servedFileHeaders("image/png", "p.png", true)["Content-Disposition"]).toStartWith("attachment");
  });
});
