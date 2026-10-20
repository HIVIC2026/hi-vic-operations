import { expect, test } from "bun:test";
import { fileResults, linkFiles, type BulkExtracted, type BulkFile, type FileMatch } from "../src/lib/bulk-import.core";

const f = (name: string, extra: Partial<BulkFile> = {}): BulkFile => ({ path: name, name, ...extra } as BulkFile);
const amy = { full_name: "TEST Amy Ashford", address_line: "111 Testcase Street", suburb: "Bendigo", postcode: "3550" } as BulkExtracted;

test("1 one customer: matching file links, unrelated file stays unlinked and warned", () => {
  const files = [f("111-testcase-street-quote.pdf"), f("random-receipt.jpg")];
  const [r] = linkFiles([amy], files);
  expect(r!.matched.map((m) => m.name)).toEqual(["111-testcase-street-quote.pdf"]);
  expect(r!.matched.some((m) => m.how === "only_lead")).toBe(false);
  const out = fileResults(files.map((x) => ({ name: x.name, status: "ok", message: "Read" })), [amy], [r!.matched]);
  expect(out[0]!.status).toBe("ok");
  expect(out[1]!.status).toBe("warn");
  expect(out[1]!.message).toContain("not linked to any customer — check before continuing");
});

test("2 one customer, no matching evidence: nothing guessed", () => {
  const [r] = linkFiles([amy], [f("IMG_0001.jpg"), f("scan.pdf")]);
  expect(r!.matched).toEqual([]);
  expect(r!.confidence).toBe("none");
});

test("3 two customers: unmatched files still not guessed; address match unchanged", () => {
  const ben = { full_name: "TEST Ben Bolt", address_line: "222 Fixture Road", suburb: "Ballarat", postcode: "3350" } as BulkExtracted;
  const r = linkFiles([amy, ben], [f("IMG_0001.jpg"), f("222-fixture-road.jpg")]);
  expect(r[0]!.matched).toEqual([]);
  expect(r[1]!.matched.map((m) => m.name)).toEqual(["222-fixture-road.jpg"]);
});

test("4 source_files provenance links the exact file with high confidence", () => {
  const [r] = linkFiles([{ ...amy, source_files: ["job-sheet.pdf"] }], [f("job-sheet.pdf"), f("other.pdf")]);
  expect(r!.matched.map((m) => `${m.how}:${m.name}`)).toEqual(["photo_text:job-sheet.pdf"]);
  expect(r!.confidence).toBe("high");
});

test("5 explicit installer-added association is treated as linked", () => {
  const added: FileMatch[] = [{ path: "IMG_0001.jpg", name: "IMG_0001.jpg", how: "added" }];
  const out = fileResults([{ name: "IMG_0001.jpg", status: "ok", message: "Read" }], [amy], [added]);
  expect(out[0]!.status).toBe("ok");
  expect(out[0]!.message).toContain("matched by you");
});
