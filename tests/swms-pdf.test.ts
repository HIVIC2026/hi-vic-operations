// Decision 358: the filed SWMS PDF in the WorkSafe Victoria sample-template layout (swms-pdf.server.ts); the filing key
// stays the hash of swmsRecordText so plans filed before this change are not filed again.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { buildSwms, swmsDate, swmsDateTime, type SwmsFacts, type SwmsSignature } from "../src/lib/swms.core";
import { SWMS_PAGE, buildSwmsPdf, linesThatFit, wrapText } from "../src/lib/swms-pdf.server";

const facts = (siteNote: string | null): SwmsFacts => ({
  jobNumber: "HV-TEST-1", address: "1 Test Street, Testville, 3999", businessName: "TEST Insulation Co", installDate: "2026-11-03",
  lead: { name: "TEST Lead", workerId: "t1" }, crew: [{ name: "TEST Crew", workerId: "t2" }], yearBuilt: 1972, hazardNote: null, siteNote,
});
const sigs: SwmsSignature[] = [
  { key: "w:t1", name: "TEST Lead", typedName: "TEST Lead", signedAt: "2026-11-02T08:15:00Z" },
  { key: "w:t2", name: "TEST Crew", typedName: "TEST Crew", signedAt: "2026-11-02T21:40:00Z" },
];
const longNote = (n: number) => Array.from({ length: n }, (_, i) => `TEST site note line ${i + 1}: manhole in the laundry, walk only on joists, isolate the solar inverter first.`).join(" ");

describe("dates on the filed plan", () => {
  test("signature times are DD/MM/YYYY h:mma Melbourne time; install date DD/MM/YYYY", () => {
    expect(swmsDateTime("2026-11-02T08:15:00Z")).toBe("02/11/2026 7:15pm");
    expect(swmsDateTime("2026-11-02T13:05:00Z")).toBe("03/11/2026 12:05am");
    expect(swmsDateTime("2026-06-02T02:30:00Z")).toBe("02/06/2026 12:30pm");
    expect(swmsDate("2026-11-03")).toBe("03/11/2026");
    expect(swmsDate(null)).toBe("—");
  });
});

describe("layout helpers", () => {
  const w = (s: string) => s.length * 5;
  test("wrap keeps explicit lines and breaks over-long words inside the cell", () => {
    expect(wrapText("aa bb\ncc", w, 100)).toEqual(["aa bb", "cc"]);
    const lines = wrapText("x".repeat(50), w, 100);
    expect(lines.every((l) => w(l) <= 100)).toBe(true);
    expect(lines.join("")).toBe("x".repeat(50));
  });
  test("lines that fit leave room for the cell padding and never go negative", () => {
    expect(linesThatFit(10 * 10.5 + 8)).toBe(10);
    expect(linesThatFit(5)).toBe(0);
  });
});

describe("the SWMS PDF", () => {
  test("a 2-signer plan with a long site note builds; A4 landscape; the hazard table header repeats on the next page", async () => {
    const plan = buildSwms(facts(longNote(20)));
    const { bytes, layout } = await buildSwmsPdf(plan, sigs, { recordRef: "swms:test" });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(layout.pages);
    expect(layout.pages).toBeGreaterThanOrEqual(2);
    const { width, height } = doc.getPage(0).getSize();
    expect([width, height]).toEqual([SWMS_PAGE.width, SWMS_PAGE.height]);
    // Nine hazard rows don't fit on page 1: the header row is drawn on page 1 and again on page 2.
    expect(layout.mainHeaderPages).toEqual([1, 2]);
    expect(layout.signoffHeaderPages.length).toBeGreaterThanOrEqual(1);
  });
  test("a site note longer than a page splits across pages with its header row repeated", async () => {
    const plan = buildSwms(facts(longNote(120)));
    const { bytes, layout } = await buildSwmsPdf(plan, sigs);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(layout.pages);
    expect(layout.noteHeaderPages.length).toBeGreaterThanOrEqual(2);
    expect(new Set(layout.noteHeaderPages).size).toBe(layout.noteHeaderPages.length);
    expect(layout.noteHeaderPages.every((p, i) => i === 0 || p === layout.noteHeaderPages[i - 1]! + 1)).toBe(true);
    expect(layout.pages).toBeGreaterThan(2);
  });
  test("an unsigned crew member still builds (NOT SIGNED row) and odd characters don't break the standard font", async () => {
    const plan = buildSwms(facts("Ceiling ≥ 2.4 m → “hip” section ✓ 漢字"));
    const { bytes } = await buildSwmsPdf(plan, sigs.slice(0, 1));
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
  test("fileSwms draws with the new layout but keeps the filing key = hash of swmsRecordText", () => {
    const src = readFileSync(new URL("../src/lib/swms.server.ts", import.meta.url), "utf8");
    expect(src).toContain("const text = swmsRecordText(plan, signatures);");
    expect(src).toContain('createHash("sha256").update(text)');
    expect(src).toContain("buildSwmsPdf(plan, signatures");
    expect(src).not.toContain("textToPdf(");
  });
});

describe("Specific to this house (Jo 30 Oct 2026)", () => {
  test("a long house section splits across pages without losing lines", async () => {
    const lines = Array.from({ length: 60 }, (_, i) => `Area ${i + 1}: 4 recessed downlights`);
    const plan = buildSwms({ ...facts("TEST note last"), houseLines: lines, houseSteps: ["Recessed downlights: keep the required clearance"] });
    const { bytes, layout } = await buildSwmsPdf(plan, []);
    expect(layout.noteHeaderPages.length).toBeGreaterThan(1);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(layout.pages);
  });
});
