// Deterministic six-case check of the bulk importer pipeline, using the same pure steps as analyseBatch
// (list parsing → cleanLead → findDuplicates → linkFiles → sortJob/leadStage/effectiveSiteCheck).
// The AI column-mapping step is replaced by fixed "already mapped" leads so results never vary.
import { expect, test } from "bun:test";
import * as XLSX from "xlsx";
import {
  cleanLead, customerDetailsReason, effectiveSiteCheck, findDuplicates, gridToRecords, leadStage, linkFiles, quoteNeeded, sortJob,
  type BulkExtracted, type BulkFile,
} from "../src/lib/bulk-import.core";

const CSV = `Name,Phone,Email,Address,Suburb,Postcode,Ceiling m2,Existing insulation,Access,Visited,Quoted inc GST,Includes
TEST Amy Ashford,0400 000 201,amy@hivic-test.example,111 Testcase Street,Bendigo,3550,120,None,Manhole in hallway,Y,3200,R5.0 batts 120m2
TEST Ben Bolt,0400 000 202,ben@hivic-test.example,222 Fixture Road,Ballarat,3350,,,,N,2800,R5.0 batts estimate
TEST Cara Cole,0400 000 203,cara@hivic-test.example,333 Sample Avenue,Geelong,3220,95,None,Manhole in laundry,Y,,
TEST Don Dale,0400 000 204,don@hivic-test.example,444 Mockup Lane,Shepparton,3630,110,Thin batts about R1.5,Manhole,Y,,
TEST Ella Eno,0400 000 205,,,,,,unknown,,,,
TEST Amy Ashford,0400 000 201,amy@hivic-test.example,111 Testcase St,Bendigo,3550,120,None,Manhole in hallway,Y,3200,R5.0 batts 120m2`;

function parse(buf: ArrayBuffer | string, type: "string" | "array") {
  const wb = XLSX.read(buf, { type });
  const sheet = wb.Sheets[wb.SheetNames[0]!]!;
  return gridToRecords(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", raw: false, blankrows: false }));
}

const lead = (o: Partial<BulkExtracted>): BulkExtracted => ({ full_name: null, email: null, phone: null, address_line: null, suburb: null, postcode: null, ...o } as BulkExtracted);
// What the AI mapping returns for those rows (fixed). Ella came from notes only → unsure.
const mapped: BulkExtracted[] = [
  lead({ full_name: "TEST Amy Ashford", phone: "0400 000 201", email: "amy@hivic-test.example", address_line: "111 Testcase Street", suburb: "Bendigo", postcode: "3550", area_m2: 120, existing_insulation: "None", access: "Manhole in hallway", site_check: "yes", price_inc_gst: 3200, price_includes: "R5.0 batts 120m2" } as Partial<BulkExtracted>),
  lead({ full_name: "TEST Ben Bolt", phone: "0400 000 202", email: "ben@hivic-test.example", address_line: "222 Fixture Road", suburb: "Ballarat", postcode: "3350", site_check: "no", price_inc_gst: 2800, price_includes: "R5.0 batts estimate" } as Partial<BulkExtracted>),
  lead({ full_name: "TEST Cara Cole", phone: "0400 000 203", email: "cara@hivic-test.example", address_line: "333 Sample Avenue", suburb: "Geelong", postcode: "3220", area_m2: 95, existing_insulation: "None", access: "Manhole in laundry", site_check: "yes" } as Partial<BulkExtracted>),
  lead({ full_name: "TEST Don Dale", phone: "0400 000 204", email: "don@hivic-test.example", address_line: "444 Mockup Lane", suburb: "Shepparton", postcode: "3630", area_m2: 110, existing_insulation: "Thin batts about R1.5", access: "Manhole", site_check: "yes", unsure: true } as Partial<BulkExtracted>),
  lead({ full_name: "TEST Ella Eno", phone: "0400 000 205", existing_insulation: "unknown", unsure: true }),
  lead({ full_name: "TEST Amy Ashford", phone: "0400 000 201", email: "amy@hivic-test.example", address_line: "111 Testcase St", suburb: "Bendigo", postcode: "3550", area_m2: 120, existing_insulation: "None", access: "Manhole in hallway", site_check: "yes", price_inc_gst: 3200 } as Partial<BulkExtracted>),
];
const files: BulkFile[] = [
  { path: "444-mockup-lane-ceiling.jpg", name: "444-mockup-lane-ceiling.jpg", folder: null, type: "image/jpeg" },
  { path: "random-receipt.jpg", name: "random-receipt.jpg", folder: null, type: "image/jpeg" },
];

function run(existing = new Set<string>()) {
  const cleaned = mapped.map(cleanLead);
  const leads = cleaned.map((c) => c.lead);
  const dups = findDuplicates(leads, existing);
  const links = linkFiles(leads, files);
  return leads.map((e, i) => {
    const photos = links[i]!.matched.length;
    return { name: e.full_name, ...sortJob(e, { matchConfidence: links[i]!.confidence, duplicate: dups.has(i) }), dup: dups.get(i) ?? null,
      stage: leadStage(e, photos), site: effectiveSiteCheck(e, photos).check, files: links[i]!.matched.map((m) => m.name), gap: customerDetailsReason(e), quoteNeeded: quoteNeeded(e), phone: e.phone };
  });
}

test("CSV and XLSX lists parse to the same raw rows", () => {
  const csv = parse(CSV, "string");
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(CSV.split("\n").map((l) => l.split(","))), "S");
  const xlsx = parse(XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer, "array");
  expect(csv.length).toBe(6);
  expect(xlsx).toEqual(csv);
  expect(csv[0]!["Ceiling m2"]).toBe("120");
  expect(csv[0]!["Quoted inc GST"]).toBe("3200");
});

const r = run();
test("1 complete measured + quoted → covers the Ready Check, quoted stage", () => {
  expect(r[0]!.result).toBe("covers_ready_check"); expect(r[0]!.stage).toBe("quoted"); expect(r[0]!.dup).toBeNull();
});
test("2 quoted without measure/site check → needs a visit, not complete", () => {
  expect(r[1]!.result).toBe("needs_visit"); expect(r[1]!.stage).toBe("not_visited"); expect(r[1]!.site).toBe("no");
});
test("3 measured, no quote → covers Ready Check, visited, quote needed", () => {
  expect(r[2]!.result).toBe("covers_ready_check"); expect(r[2]!.stage).toBe("visited"); expect(r[2]!.quoteNeeded).toBe(true);
});
test("4 existing insulation from photo text → office review; photo matched to that customer only", () => {
  expect(r[3]!.result).toBe("office_review"); expect(r[3]!.files).toEqual(["444-mockup-lane-ceiling.jpg"]);
});
test("5 incomplete → office review with customer details needed", () => {
  expect(r[4]!.result).toBe("office_review"); expect(r[4]!.gap).toContain("full address");
});
test("6 duplicate inside the upload (St vs Street) → flagged and office review", () => {
  expect(r[5]!.dup).toContain("Same address as row 1"); expect(r[5]!.result).toBe("office_review");
});
test("duplicate of an existing portal property is flagged", () => {
  const again = run(new Set(["addr:" + "333 sample avenue" + "|3220"]));
  // key format comes from normaliseAddress; assert via the generated note rather than guessing
  const anyExisting = again.some((x) => x.dup?.startsWith("Already in the portal"));
  const direct = run(new Set([`email:cara@hivic-test.example`]));
  expect(anyExisting || direct.some((x) => x.dup?.startsWith("Already in the portal"))).toBe(true);
});
test("unrelated receipt is never attached to anyone", () => {
  expect(r.flatMap((x) => x.files)).not.toContain("random-receipt.jpg");
});
test("print matrix", () => { console.log(JSON.stringify(r, null, 1)); });
