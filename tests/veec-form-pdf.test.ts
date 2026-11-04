import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument } from "pdf-lib";
import { VEEC_FORM_BODY, VEEC_FORM_FIELDS } from "../src/lib/veec-assignment-form.core";
import { veecFormPdf } from "../src/lib/veec-form-pdf.server";
import { SAMPLE_SIGS, SAMPLE_VALUES, SIGNATURE_PNG } from "./helpers/veec-form-sample";

const pdfText = async (b: Uint8Array) => { const d = await getDocument({ data: b.slice() }).promise; const out: string[] = []; for (let i = 1; i <= d.numPages; i++) out.push((await (await d.getPage(i)).getTextContent()).items.map((x: any) => x.str).join(" ")); return out; };
describe("VEEC form PDF (website look)", () => {
  test("stray quote removed in code and pending SQL", () => {
    expect(VEEC_FORM_BODY).not.toContain("assessment:”");
    expect(readFileSync("docs/pending-migrations/0225_veec_assignment_v1_1.sql", "utf8")).not.toContain("assessment:”");
  });
  test("5 pages; Part C, Section 3 Part A, Part B and Section 4 each start a page", async () => {
    const r = await veecFormPdf(SAMPLE_VALUES, SAMPLE_SIGS);
    expect(r.layout.pages).toBe(5);
    const p = r.layout.blockPage;
    expect(new Set([p["s2-partC"], p["s3-partA"], p["s3-partB"], p["s4"]]).size).toBe(4);
    expect(p["s2-partC"]).toBe(2); expect(p["s3-partA"]).toBe(3); expect(p["s3-partB"]).toBe(4); expect(p["s4"]).toBe(5);
    expect(r.layout.split).toEqual([]);
    expect((await PDFDocument.load(r.bytes)).getPageCount()).toBe(5);
  });
  test("unsigned copy has the same five pages", async () => {
    const r = await veecFormPdf(SAMPLE_VALUES, null);
    expect(r.layout.pages).toBe(5);
    expect(r.layout.split).toEqual([]);
  });
  test("address on Part A", async () => {
    expect((await pdfText((await veecFormPdf(SAMPLE_VALUES, null)).bytes)).join(" ")).toContain("1/33 Altree Court, Phillip ACT 2606");
  });
  test("Part B carries the Lead Installer's drawn signature image with the name and date beside it", async () => {
    const r = await veecFormPdf(SAMPLE_VALUES, { ...SAMPLE_SIGS, installer: { name: "John Smith", at: "2026-11-13T05:00:00Z", image: SIGNATURE_PNG } });
    const page = r.layout.blockPage["s3-partB"]!;
    expect(r.layout.images).toContainEqual({ block: "s3-partB", page });
    expect((await pdfText(r.bytes))[page - 1]).toMatch(/John Smith[\s\S]*13 Nov 2026/);
    expect((await veecFormPdf(SAMPLE_VALUES, { ...SAMPLE_SIGS, installer: { name: "John Smith", at: "2026-11-13T05:00:00Z" } })).layout.images).toEqual([]);
  });
  test("signature names are bold italic (all three signers)", async () => {
    const r = await veecFormPdf(SAMPLE_VALUES, SAMPLE_SIGS);
    const d = await getDocument({ data: r.bytes.slice() }).promise;
    for (const [page, name] of [[3, "Chris Lowe"], [4, "John Smith"], [5, "Sarah Brown"]] as const) {
      const pg = await d.getPage(page); const tc = await pg.getTextContent(); await pg.getOperatorList();
      const hits = tc.items.filter((x: any) => x.str === name).map((x: any) => String(pg.commonObjs.get(x.fontName)?.name ?? ""));
      expect(hits.some((n) => /Italic/i.test(n))).toBe(true);
    }
  });
  test("official wording is on the right pages and declarations keep their sections", async () => {
    const t = await pdfText((await veecFormPdf(SAMPLE_VALUES, SAMPLE_SIGS)).bytes);
    expect(t[0]).toContain("Section 1: Consumer rights information");
    expect(t[0]).toContain("Part B: Pre-installation electrical safety assessment details");
    expect(t[1]).toContain("Part C: Installation details");
    expect(t[1]).toContain("Co-payment details (includes product and labour/installation costs)");
    expect(t[2]).toContain("Section 3: Declarations");
    expect(t[2]).toContain("where electrical hazards were identified during the VEU pre-installation electrical safety assessment:");
    expect(t[2]).toMatch(/I Chris Lowe am the authorised representative of/);
    expect(t[3]).toContain("Part B: Declaration by lead installer");
    expect(t[4]).toContain("Section 4: Consumer details and declaration");
    expect(t[4]).toContain("Sarah Brown");
    for (const [i, line] of [[2, "Sat 14 Nov 2026"], [3, "Fri 13 Nov 2026"], [4, "Fri 13 Nov 2026"]] as const) expect(t[i]).toContain(line);
  });
  test("every Section 2 value that is filled appears; unsigned copy shows no signatures", async () => {
    const t = (await pdfText((await veecFormPdf(SAMPLE_VALUES, null)).bytes)).join(" ").replace(/\s+/g, " ");
    for (const d of VEEC_FORM_FIELDS) {
      const v = SAMPLE_VALUES[d.key];
      if (typeof v === "string" && !/^\d{4}-/.test(v) && !["Yes", "No", "Uninsulated"].includes(v) && !v.startsWith("48A") && v !== "Price reduction") expect(t).toContain(v);
    }
    expect(t).toContain("$3,798.00"); expect(t).toContain("$2,188.00"); expect(t).toContain("$1,610.00"); expect(t).toContain("137");
    expect(t).not.toContain("14 Nov 2026");
  });
  test("AP is named as in the approved sample, in Section 1, Section 3 Part A and Section 4; header has no address line", async () => {
    const t = await pdfText((await veecFormPdf(SAMPLE_VALUES, SAMPLE_SIGS)).bytes);
    const flat = (i: number) => t[i]!.replace(/\s+/g, " ");
    expect(flat(0)).toContain("trading as Home Insulation Victoria, the accredited provider");
    expect(flat(2)).toContain("authorised representative of DC Construction Solutions Pty Ltd trading as Home Insulation Victoria and declare");
    expect(flat(4)).toContain("benefit from DC Construction Solutions Pty Ltd trading as Home Insulation Victoria in exchange");
    expect(t.join(" ")).not.toMatch(/ABN 44 671 613 979, VEU Accredited/);
    expect(flat(0).split("Section 1")[0]).not.toContain("Altree Court");
  });
  test("no 'lawyer' anywhere in the owner-facing PDF", async () => {
    const r = await veecFormPdf(SAMPLE_VALUES, SAMPLE_SIGS);
    expect((await pdfText(r.bytes)).join(" ")).not.toMatch(/lawyer/i);
    expect(Buffer.from(r.bytes).toString("latin1")).not.toMatch(/lawyer/i);
  });
  test("flag off keeps the old text copy", () => {
    const src = readFileSync("src/lib/assignment.server.ts", "utf8");
    expect(src).toMatch(/PDF_LOOK_APPROVED\.veecForm/);
    expect(src).toMatch(/PDF_LOOK_APPROVED\.veecForm\s*\?\s*await veecFinalCopyPdf\([^)]*\)\s*:\s*null/);
    expect(src).toContain("veecFormPdf");
  });
});
