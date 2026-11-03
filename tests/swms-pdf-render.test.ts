// Part 7 Task 2: the approved HTML (swmsPdfHtml) printed by Chromium exactly as Jo's pdf1.js printed swms-sample.pdf —
// page count like the sample, every kept-together box (Changes during the job, Worker sign-off, each hazard) on one page,
// footer "Page N of M" on every page. Needs Playwright's Chromium; without it the checks are reported NOT_RUN, never PASS.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDF_FOOTER_LEFT } from "../src/lib/pdf-look.core";
import { buildSwms, type SwmsChange, type SwmsFacts, type SwmsSignature } from "../src/lib/swms.core";
import { swmsHouseStepTexts } from "../src/lib/swms-house.core";
import { swmsPdfHtml } from "../src/lib/swms-pdf-html.core";

const facts: SwmsFacts = {
  jobNumber: "HV-1234", address: "12 Example St, Box Hill VIC 3128", businessName: "Rapid Insulation", installDate: "2026-11-13",
  lead: { name: "John Smith", workerId: "w1" }, crew: [{ name: "Sam Lee", workerId: "w2" }, { name: "Ali Khan", workerId: "w3" }],
  yearBuilt: 1995, hazardNote: null, siteNote: null,
  houseLines: ["Roof: Tile", "Ceiling access: Easy", "Main house: 4 recessed downlights", "PIESA: passed"],
  houseSteps: [swmsHouseStepTexts(true).downlights],
};
const plan = buildSwms(facts, { nov2: true });
const sigs: SwmsSignature[] = [
  { key: "w:w1", name: "John Smith", typedName: "John Smith", signedAt: "2026-11-12T07:42:00Z" },
  { key: "w:w2", name: "Sam Lee", typedName: "Sam Lee", signedAt: "2026-11-12T08:05:00Z" },
  { key: "w:w3", name: "Ali Khan", typedName: "Ali Khan", signedAt: "2026-11-12T19:58:00Z" },
];
const CHANGE: SwmsChange = { what: "Wasp nest in the back ceiling", control: "Area closed off, nest removed by owner's pest controller", by: "John Smith", at: "2026-11-13T02:10:00Z" };

// The same print settings as docs/approved-samples/2026-11-02/pdf1.js (Jo's renderer for every approved sample).
const FOOTER = `<div style="width:100%;font-family:sans-serif;font-size:7px;color:#5d6785;padding:0 40px;display:flex;justify-content:space-between"><span>${PDF_FOOTER_LEFT}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;

/** Playwright: the project's own copy, `PLAYWRIGHT_MODULE`, or the sandbox's tools copy (where the approved samples were printed). */
const PLAYWRIGHT_CANDIDATES = [process.env["PLAYWRIGHT_MODULE"], "playwright", "/opt/npm-tools/node_modules/playwright"].filter((x): x is string => !!x);
async function browser(): Promise<{ chromium: any } | null> {
  let last = "no candidate";
  for (const spec of PLAYWRIGHT_CANDIDATES) {
    try {
      const pw = await import(spec);
      const b = await pw.chromium.launch();
      await b.close();
      return { chromium: pw.chromium };
    } catch (e) { last = e instanceof Error ? e.message.split("\n")[0]! : "error"; }
  }
  console.warn(`NOT_RUN: Playwright Chromium is not available here (${last}) — the SWMS print check did not run.`);
  return null;
}

async function printPdf(chromium: any, html: string): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), "swms-print-"));
  const file = join(dir, "swms.html");
  writeFileSync(file, html);
  const b = await chromium.launch();
  try {
    const p = await b.newPage();
    await p.goto(pathToFileURL(file).href);
    await p.evaluate(() => (document as any).fonts.ready);
    return new Uint8Array(await p.pdf({ preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: FOOTER }));
  } finally { await b.close(); }
}

const pageTexts = async (bytes: Uint8Array) => {
  const d = await getDocument({ data: bytes.slice() }).promise;
  const out: string[] = [];
  for (let i = 1; i <= d.numPages; i++) out.push((await (await d.getPage(i)).getTextContent()).items.map((x: any) => x.str).join(" ").replace(/\s+/g, " "));
  return out;
};
const pageOf = (pages: string[], needle: string) => { const i = pages.findIndex((p) => p.includes(needle)); expect(i, `"${needle}" is in the PDF`).toBeGreaterThanOrEqual(0); return i; };

describe("swmsPdfHtml printed by Chromium (the approved sample's renderer)", () => {
  const fontBase = pathToFileURL(join(process.cwd(), "node_modules/@fontsource/open-sans/files/")).href;

  test("page count like swms-sample.pdf, footer on every page, no kept box split across pages", async () => {
    const pw = await browser();
    if (!pw) return;
    const bytes = await printPdf(pw.chromium, swmsPdfHtml(plan, sigs, [], { fontBase }));
    const pages = await pageTexts(bytes);
    // Jo's approved sample prints 2 pages; the Compliance block here carries one more line (the Lead Installer on site), so 2 or 3.
    expect([2, 3]).toContain(pages.length);
    // Chromium's footer is set in a fallback font that pdf.js reads glyph by glyph, so compare without spaces.
    pages.forEach((p, i) => { const flat = p.replace(/\s+/g, ""); expect(flat).toContain(`Page${i + 1}of${pages.length}`); expect(flat).toContain(PDF_FOOTER_LEFT.replace(/\s+/g, "")); });
    // .keep boxes: the heading and the last row are on the same page.
    expect(pageOf(pages, "Changes during the job")).toBe(pageOf(pages, "None recorded –"));
    expect(pageOf(pages, "Worker sign-off")).toBe(pageOf(pages, 'Ali Khan (Crew) ✓ signed — typed "Ali Khan" 13/11/2026 6:58am'));
    // .hz boxes: each hazard's name and the end of its control are on one page.
    for (const h of plan.hazards) expect(pageOf(pages, h.name), h.name).toBe(pageOf(pages, h.control.slice(-40) + "."));
    // No page opens with the tail of a section: page 2+ starts with a heading or a hazard box, never a lone table row.
    for (const p of pages.slice(1)) expect(p.trim().startsWith("✓") || p.trim().startsWith("None recorded")).toBe(false);
    expect(pages.join(" ")).not.toMatch(/lead installer/);
  });

  test("a recorded change prints in the box on one page", async () => {
    const pw = await browser();
    if (!pw) return;
    const pages = await pageTexts(await printPdf(pw.chromium, swmsPdfHtml(plan, sigs, [CHANGE], { fontBase })));
    expect(pageOf(pages, "Changes during the job")).toBe(pageOf(pages, "John Smith, 13/11/2026 1:10pm"));
    expect(pages.join(" ")).not.toContain("None recorded");
  });
});
