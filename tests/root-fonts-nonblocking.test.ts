// Speed (installer screens towards 1 second, task 3): the Google Fonts stylesheet must not block the first paint.
// Source scan of src/routes/__root.tsx: both preconnects are declared, display=swap is kept, and the stylesheet is
// declared with media="print" and switched to "all" once it has loaded (a script placed after <HeadContent />, plus a
// <noscript> fallback), so it can never be a render-blocking stylesheet.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = readFileSync(join(import.meta.dir, "..", "src", "routes", "__root.tsx"), "utf8");
const links = src.slice(src.indexOf("links: ["), src.indexOf("]", src.indexOf("links: [")));
const lines = links.split("\n");
const fontLine = lines.find((l) => l.includes("fonts.googleapis.com/css2")) ?? "";

describe("root head: Google Fonts", () => {
  test("preconnects to fonts.googleapis.com and fonts.gstatic.com (gstatic with crossOrigin)", () => {
    expect(lines.some((l) => /rel: "preconnect"/.test(l) && l.includes('href: "https://fonts.googleapis.com"'))).toBe(true);
    expect(lines.some((l) => /rel: "preconnect"/.test(l) && l.includes('href: "https://fonts.gstatic.com"') && l.includes('crossOrigin: "anonymous"'))).toBe(true);
  });

  test("the font stylesheet keeps the same families and display=swap", () => {
    expect(fontLine).toContain("family=Figtree:wght@400;500;600;700&family=Open+Sans:wght@400;600;700&family=Outfit:wght@500;600;700;800&display=swap");
  });

  test("the font stylesheet is not render-blocking: media=print, then all after load", () => {
    expect(fontLine).toMatch(/media: "print"/);
    expect(src).toMatch(/\.media\s*=\s*["']all["']/);
    expect(src).toMatch(/addEventListener\(["']load["']/);
    expect(src).toMatch(/<noscript/);
  });

  test("no other head stylesheet link points at Google Fonts without media=print", () => {
    const blocking = lines.filter((l) => /rel: "stylesheet"/.test(l) && /fonts\.googleapis\.com/.test(l) && !/media: "print"/.test(l));
    expect(blocking).toEqual([]);
  });
});
