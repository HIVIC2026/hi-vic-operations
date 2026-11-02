// Task 9: every DEECA legacy form field gets its own name at fill time. The originals name every checkbox "Check1";
// LibreOffice then merged them and 4 PIISA ticks vanished on conversion.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { OFFICIAL_ITEMS, OFFICIAL_TEMPLATES, type OfficialKey } from "../src/lib/official-forms.core";
import { docxFields, officialDocxLayout, uniqueFieldNames } from "../src/lib/official-docx.core";
import { renderOfficialDocx } from "../src/lib/official-docx.server";

const original = (k: OfficialKey) => strFromU8(unzipSync(readFileSync(OFFICIAL_TEMPLATES[k].originalFile))["word/document.xml"]!);
const fieldNames = (xml: string) => [...xml.matchAll(/<w:ffData>[\s\S]*?<w:name w:val="([^"]*)"/g)].map((m) => m[1]!);

/** Sample answers for every answerable item (same shape as a signed form). */
function sample(key: OfficialKey): Record<string, unknown> {
  const a: Record<string, unknown> = {};
  for (const i of OFFICIAL_ITEMS[key]) {
    if (i.kind === "heading" || i.kind === "statement" || i.kind === "attachment") continue;
    if (i.row) { a[i.id] = `${i.label.slice(0, 18)} row1`; continue; }
    switch (i.kind) {
      case "text": a[i.id] = `Sample ${i.label.slice(0, 20)}`; break;
      case "date": a[i.id] = "2026-11-07"; break;
      case "number": a[i.id] = 4; break;
      case "yesno": case "yesno_na": a[i.id] = "Yes"; break;
      case "choice": a[i.id] = i.options?.[0] ?? "x"; break;
      case "ticks": a[i.id] = i.options?.slice(0, 1) ?? []; break;
      case "tick": a[i.id] = true; break;
      case "signature": a[i.id] = "Will Casdorff (signed electronically on 07/11/2026)"; break;
    }
  }
  if (key === "piesa") a.lifeSupport = "No";
  return a;
}

/** Which option box of a Yes/No item is ticked in this document. */
function checkedOptionFor(xml: string, key: OfficialKey, id: string): string | null {
  const slot = officialDocxLayout(xml, key).slots.get(id);
  if (!slot) throw new Error(`no slot for ${id}`);
  const fields = docxFields(xml);
  const on = slot.fields.filter((f) => {
    const ff = xml.slice(fields[f.n]!.cbStart, fields[f.n]!.cbEnd);
    const c = /<w:checked w:val="(\d)"\/>/.exec(ff);
    return c ? c[1] === "1" : /<w:default w:val="1"\/>/.test(ff);
  });
  return on.length ? on.map((f) => f.option).join(",") : null;
}

for (const key of ["piesa", "piisa"] as const) {
  describe(key, () => {
    test("field names unique and in order", () => {
      const xml = original(key);
      const out = uniqueFieldNames(xml);
      const names = fieldNames(out);
      expect(names).toEqual(docxFields(xml).map((f) => `hiv${f.n}`));
      expect(out.match(/w:val="Check1"/g)).toBeNull();
      expect(new Set(names).size).toBe(names.length);
    });
    test("matching bookmarks follow the new names, none duplicated, field count and order unchanged", () => {
      const xml = original(key);
      const out = uniqueFieldNames(xml);
      const bm = [...out.matchAll(/<w:bookmarkStart[^>]*w:name="([^"]+)"/g)].map((m) => m[1]!);
      expect(new Set(bm).size).toBe(bm.length);
      expect(bm.filter((b) => /^(Text|Check)\d+$/.test(b))).toEqual([]);
      expect(docxFields(out).map((f) => f.kind)).toEqual(docxFields(xml).map((f) => f.kind));
      expect(uniqueFieldNames(out)).toBe(out);
    });
    test("a filled form keeps unique names", () => {
      const r = renderOfficialDocx(key, sample(key) as never);
      const xml = strFromU8(unzipSync(r.bytes)["word/document.xml"]!);
      const names = fieldNames(xml);
      expect(new Set(names).size).toBe(names.length);
      expect(r.missed).toEqual([]);
    });
  });
}

test("a filled PIISA keeps every tick set, with unique field names", () => {
  const answers = { ...sample("piisa"), "p5.recessed": "Yes", "p5.icConfirmed": "Yes", "p6.present": "Yes", "p6.suitable": "Yes" };
  const r = renderOfficialDocx("piisa", answers as never);
  const xml = strFromU8(unzipSync(r.bytes)["word/document.xml"]!);
  for (const id of ["p5.recessed", "p5.icConfirmed", "p6.present", "p6.suitable"]) expect(checkedOptionFor(xml, "piisa", id)).toBe("Yes");
  const names = fieldNames(xml);
  expect(new Set(names).size).toBe(names.length);
});

test("a bookmark whose name only ends with the old name is left alone", () => {
  const xml = '<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Check1"/><w:checkBox><w:default w:val="0"/></w:checkBox></w:ffData></w:fldChar></w:r>'
    + '<w:bookmarkStart w:id="1" xw:name="Check1"/><w:bookmarkStart w:id="2" w:name="Check1"/>'
    + '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const out = uniqueFieldNames(xml);
  expect(out).toContain('xw:name="Check1"');
  expect(out).toContain('<w:bookmarkStart w:id="2" w:name="hiv0"/>');
});
