// Task 12: the filled DEECA PIESA/PIISA PDF. The blank PDFs have no form widgets (Task 11), so officialFormPdf DRAWS onto the
// blank: a tick centred in each checked box, the text in each text field's free area (official-pdf-areas.data.ts), the
// signature pictures. These tests read the result back with pdfjs and compare it with the blank page by page.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { officialFieldValues } from "../src/lib/official-docx.core";
import { officialDocxLayoutFor } from "../src/lib/official-docx.server";
import { officialFormPdf } from "../src/lib/official-form-pdf.server";
import { OFFICIAL_PDF_AREAS } from "../src/lib/official-pdf-areas.data";
import type { OfficialAnswers, OfficialKey } from "../src/lib/official-forms.core";
import { BLANKS, measureAreas, pageObstacles, type Box } from "../scripts/official-form-pdf-areas";
import { fullAnswers } from "../scripts/official-form-samples";
import { sampleSignaturePng } from "../scripts/sample-signature-png";

const KEYS = ["piesa", "piisa"] as const;
const FULL = { piesa: fullAnswers("piesa"), piisa: fullAnswers("piisa") };
const inside = (i: Box, o: Box, tol = 0.6) => i.x0 >= o.x0 - tol && i.y0 >= o.y0 - tol && i.x1 <= o.x1 + tol && i.y1 <= o.y1 + tol;
const meets = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const fieldBox = (key: OfficialKey, n: number): Box => { const f = BLANKS[key].fields[n]!; return { x0: f.x, y0: f.y, x1: f.x + f.w, y1: f.y + f.h }; };
const pageOf = (key: OfficialKey, n: number) => BLANKS[key].fields[n]!.page;
const squash = (s: string) => s.replace(/\s+/g, "");

type Drawn = { str: string; x: number; y: number; size: number; font: string; box: Box };
type PageDraw = { text: Drawn[]; paint: Box[] };

async function pages(bytes: Uint8Array) {
  const doc = await getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const out: { text: Drawn[]; paint: (Box & { lightFill: boolean })[]; obstacles: Awaited<ReturnType<typeof pageObstacles>> }[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    await page.getOperatorList();
    const text: Drawn[] = [];
    for (const i of (await page.getTextContent()).items as any[]) {
      if (!i.str?.trim()) continue;
      const size = Math.hypot(i.transform[2], i.transform[3]);
      let font = "";
      try { font = page.commonObjs.get(i.fontName)?.name ?? ""; } catch { font = ""; }
      text.push({ str: i.str, x: i.transform[4], y: i.transform[5], size, font, box: { x0: i.transform[4], y0: i.transform[5] - 0.25 * size, x1: i.transform[4] + i.width, y1: i.transform[5] + 0.8 * size } });
    }
    const obstacles = await pageObstacles(page);
    out.push({ text, paint: obstacles.paint, obstacles });
  }
  return out;
}
const blankPages = { piesa: pages(Buffer.from(BLANKS.piesa.pdfBase64, "base64")), piisa: pages(Buffer.from(BLANKS.piisa.pdfBase64, "base64")) };
const k = (b: Box) => [b.x0, b.y0, b.x1, b.y1].map((n) => n.toFixed(1)).join(",");
/** What the fill added to each page: text items and painted paths/images that the blank page does not have. */
async function drawn(key: OfficialKey, bytes: Uint8Array): Promise<PageDraw[]> {
  const [blank, filled] = [await blankPages[key], await pages(bytes)];
  return filled.map((pg, i) => {
    const bt = new Map<string, number>(), bp = new Map<string, number>();
    for (const t of blank[i]!.text) bt.set(`${t.str}@${t.x.toFixed(1)},${t.y.toFixed(1)}`, (bt.get(`${t.str}@${t.x.toFixed(1)},${t.y.toFixed(1)}`) ?? 0) + 1);
    for (const p of blank[i]!.paint) bp.set(k(p), (bp.get(k(p)) ?? 0) + 1);
    const take = (m: Map<string, number>, key: string) => { const n = m.get(key) ?? 0; if (n) { m.set(key, n - 1); return true; } return false; };
    return { text: pg.text.filter((t) => !take(bt, `${t.str}@${t.x.toFixed(1)},${t.y.toFixed(1)}`)), paint: pg.paint.filter((p) => !take(bp, k(p))) };
  });
}
const areaOf = (key: OfficialKey, name: string) => OFFICIAL_PDF_AREAS[key][name]!;
const textIn = (d: PageDraw[], page: number, area: Box) => d[page]!.text.filter((t) => inside({ x0: t.x, y0: t.y, x1: t.x, y1: t.y }, area));

/** Every tick and text the placement rule sets is drawn in its own box/area; nothing else is drawn. */
async function expectPlacement(key: OfficialKey, answers: OfficialAnswers) {
  const v = officialFieldValues(key, officialDocxLayoutFor(key), answers);
  const r = await officialFormPdf(key, answers);
  const d = await drawn(key, r.bytes);
  const ticks = d.map((p) => p.paint.slice());
  for (const [n, on] of v.boxes) {
    const inBox = ticks[pageOf(key, n)]!.filter((p) => inside(p, fieldBox(key, n)));
    expect({ n, ticks: inBox.length }).toEqual({ n, ticks: on ? 1 : 0 });
  }
  const tickCount = d.reduce((s, p) => s + p.paint.length, 0);
  expect(tickCount).toBe([...v.boxes.values()].filter(Boolean).length);
  let textItems = 0;
  for (const [n, t] of v.texts) {
    const items = textIn(d, pageOf(key, n), areaOf(key, `hiv${n}`));
    expect({ n, text: squash(items.map((i) => i.str).join("")) }).toEqual({ n, text: squash(t) });
    textItems += items.length;
  }
  expect(d.reduce((s, p) => s + p.text.length, 0)).toBe(textItems);
  return { v, r, d };
}

test("every box the placement rule sets shows in the PDF, and nothing else is drawn", async () => {
  for (const key of KEYS) {
    const { v, r } = await expectPlacement(key, FULL[key]);
    expect(v.boxes.size).toBeGreaterThan(key === "piesa" ? 60 : 30);
    expect(v.texts.size).toBeGreaterThan(key === "piesa" ? 30 : 15);
    expect(r.missed).toEqual(v.missed);
    expect(r.filled).toEqual(v.filled);
    expect(r.overflow).toEqual([]);
  }
}, 60_000);

test("skipped and unset answers draw nothing", async () => {
  // Section C answered but B1 is "not required": every Section C item is skipped, so none of its boxes or text is drawn.
  const a = { ...FULL.piesa, b1: "Electrical rectification work is not required before insulation is installed or upgraded." };
  const { v, d } = await expectPlacement("piesa", a);
  expect(v.skipped).toEqual(expect.arrayContaining(["c.signature", "c.tick1", "c.licence", "b2"]));
  for (let n = 138; n <= 153; n++) expect(d[pageOf("piesa", n)]!.paint.filter((p) => inside(p, fieldBox("piesa", n)))).toEqual([]);
  for (const key of KEYS) {
    const empty = await drawn(key, (await officialFormPdf(key, {})).bytes);
    expect(empty.every((p) => p.text.length === 0 && p.paint.length === 0)).toBe(true);
  }
}, 60_000);

test("the filled copy keeps DEECA's page count and has no form fields", async () => {
  for (const key of KEYS) {
    const r = await officialFormPdf(key, FULL[key]);
    const d = await PDFDocument.load(r.bytes);
    expect(d.getPageCount()).toBe((await PDFDocument.load(Buffer.from(BLANKS[key].pdfBase64, "base64"))).getPageCount());
    expect(d.getForm().getFields()).toHaveLength(0);
  }
});

test("drawn text is extractable and never sits on DEECA's printed text or rules", async () => {
  for (const key of KEYS) {
    const blank = await blankPages[key];
    const d = await drawn(key, (await officialFormPdf(key, FULL[key])).bytes);
    let n = 0;
    d.forEach((p, i) => {
      const printed = [...blank[i]!.obstacles.text, ...blank[i]!.obstacles.paint.filter((o) => !o.lightFill)];
      for (const t of p.text) {
        n++;
        const hits = printed.filter((o) => meets(t.box, o) && !inside(t.box, o, 0));
        expect({ str: t.str, hits }).toEqual({ str: t.str, hits: [] });
      }
    });
    expect(n).toBeGreaterThan(15);
    // Owner-facing (global constraint): nothing on the filled form says "lawyer".
    const all = (await pages((await officialFormPdf(key, FULL[key])).bytes)).flatMap((p) => p.text.map((t) => t.str)).join(" ");
    expect(all).not.toMatch(/lawyer/i);
  }
}, 60_000);

test("long text shrinks (6 pt minimum), then wraps inside its cell; it is never cut", async () => {
  const address = "Unit 14, Level 3, The Example Apartments Building, 1234 Very Long Example Boulevard Road, Box Hill South VIC 3128, Australia";
  const r = await officialFormPdf("piesa", { address });
  const items = textIn(await drawn("piesa", r.bytes), 0, areaOf("piesa", "hiv1"));
  expect(squash(items.map((i) => i.str).join(""))).toBe(squash(address));
  expect(items.every((i) => i.size >= 6 && i.size < 9)).toBe(true);
  expect(r.overflow).toEqual([]);
  // Table cell (Part 7 Appliance column): wraps within its own column, never into Location.
  const cell = "Ducted gas heating unit with a long flexible duct running across the whole ceiling space to the bedrooms";
  const r2 = await officialFormPdf("piesa", { "p7.appliances": "Yes", "p7.appliance#0": cell });
  const c = textIn(await drawn("piesa", r2.bytes), 2, areaOf("piesa", "hiv61"));
  expect(squash(c.map((i) => i.str).join(""))).toBe(squash(cell));
  expect(new Set(c.map((i) => i.y.toFixed(1))).size).toBeGreaterThan(1);
  // Too long even at 6 pt and wrapped: still drawn in full, listed in overflow.
  const huge = Array.from({ length: 40 }, (_, i) => `Word${i}`).join(" ");
  const r3 = await officialFormPdf("piesa", { jobRef: "HV-1", address: `${huge} ${huge}` });
  expect(r3.overflow).toEqual(["address"]);
  const all = (await drawn("piesa", r3.bytes))[0]!.text.filter((t) => t.str !== "HV-1");
  expect(squash(all.map((i) => i.str).join(""))).toBe(squash(`${huge} ${huge}`));
}, 60_000);

test("signature pictures sit inside their areas with the Mitti caption; typed signatures are bold italic", async () => {
  const png = sampleSignaturePng("Sam Sparks");
  const r = await officialFormPdf("piesa", FULL.piesa, {
    "b3.signature": { images: [{ bytes: png, contentType: "image/png", signedOn: "2026-11-07" }] },
    "c.signature": { images: [{ bytes: png, contentType: "image/png", signedOn: "2026-11-12" }] },
  });
  const d = await drawn("piesa", r.bytes);
  for (const [slot, area, page, caption] of [["b3.signature", areaOf("piesa", "b3.signature"), 5, "Signed in Mitti on 07/11/2026"], ["c.signature", areaOf("piesa", "hiv150"), 6, "Signed in Mitti on 12/11/2026"]] as const) {
    const pics = d[page]!.paint.filter((p) => p.y1 - p.y0 > 10);
    expect({ slot, pics: pics.filter((p) => inside(p, area)).length }).toEqual({ slot, pics: 1 });
    expect(squash(textIn(d, page, area).map((t) => t.str).join(""))).toBe(squash(caption));
  }
  // With a picture, the typed Section C name is replaced (as in the Word copy); the owner's typed signature stays, bold italic.
  expect(d[6]!.text.some((t) => t.str.includes("signed electronically"))).toBe(false);
  const owner = textIn(d, 7, areaOf("piesa", "hiv158"));
  expect(squash(owner.map((t) => t.str).join(""))).toBe(squash(FULL.piesa["o.signature"] as string));
  expect(owner.every((t) => /BoldItalic/i.test(t.font))).toBe(true);
  // No picture for B3: the typed fallback line goes in the band under the declaration.
  const fb = await officialFormPdf("piesa", FULL.piesa, { "b3.signature": { images: [], fallbackText: "Sam Sparks (signed in Mitti on 07/11/2026; electrician signature image not available)" } });
  const fbText = textIn(await drawn("piesa", fb.bytes), 5, areaOf("piesa", "b3.signature"));
  expect(squash(fbText.map((t) => t.str).join(""))).toBe(squash("Sam Sparks (signed in Mitti on 07/11/2026; electrician signature image not available)"));
}, 60_000);

test("the stored areas are what the generator measures from the blanks", async () => {
  for (const key of KEYS) expect(await measureAreas(key)).toEqual(OFFICIAL_PDF_AREAS[key]);
}, 60_000);

test("both senders are behind PDF_LOOK_APPROVED.officialFormPdf", () => {
  expect(readFileSync("src/lib/official-piesa-pdf.server.ts", "utf8")).toMatch(/PDF_LOOK_APPROVED\.officialFormPdf/);
  expect(readFileSync("src/lib/official-docx.server.ts", "utf8")).toMatch(/PDF_LOOK_APPROVED\.officialFormPdf/);
});
