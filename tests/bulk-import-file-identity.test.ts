// Real bulk-import.core source paths: files are matched by their full relative identity; same-name files in different
// folders stay separate; anything two customers could claim is attached to neither and flagged for review.
import { expect, test } from "bun:test";
import { canonicalFilePath, fileResults, linkFiles, safeMemberPath, sourceFileMatches, uniqueManifestPath, type BulkExtracted, type BulkFile } from "../src/lib/bulk-import.core";

const lead = (address_line: string, source_files: string[] = []): BulkExtracted => ({ full_name: "TEST", email: null, phone: null, address_line, suburb: "Testville", postcode: "3000", source_files } as BulkExtracted);
const file = (path: string): BulkFile => ({ path, name: path.split("/").pop()!, folder: path.includes("/") ? path.split("/").slice(0, -1).join("/") : null });

test("reviewer reproduction: a source path never matches a same-name file in another customer's folder", () => {
  const files = [file("111 Testcase Street/quote.pdf"), file("222 Different Road/quote.pdf")];
  const [a] = linkFiles([lead("No Match Lane", ["111 Testcase Street/quote.pdf"])], files);
  expect(a!.matched.map((m) => m.path)).toEqual(["111 Testcase Street/quote.pdf"]);
  expect(a!.ambiguous).toEqual([]);
});

test("a bare name with two uploaded files of that name links nothing (ambiguous), with one it links", () => {
  const two = ["A/quote.pdf", "B/quote.pdf"];
  expect(sourceFileMatches("quote.pdf", "A/quote.pdf", two)).toBe(false);
  expect(sourceFileMatches("quote.pdf", "A/quote.pdf", ["A/quote.pdf", "A/photo.jpg"])).toBe(true);
  expect(sourceFileMatches("./A\\quote.pdf", "a/QUOTE.pdf", two)).toBe(true);
  expect(canonicalFilePath("/x//Y/z.PDF")).toBe("x/y/z.pdf");
});

test("conflicting folder vs body evidence: the file is attached to NEITHER customer and listed for review", () => {
  // The folder says 222 Different Road; the PDF text was read as the 111 Testcase Street customer.
  const files = [file("222 Different Road/quote.pdf"), file("111 Testcase Street/roof.jpg")];
  const [a, b] = linkFiles([lead("111 Testcase Street", ["222 Different Road/quote.pdf"]), lead("222 Different Road")], files);
  expect(a!.matched.map((m) => m.path)).toEqual(["111 Testcase Street/roof.jpg"]);
  expect(a!.ambiguous).toEqual(["222 Different Road/quote.pdf"]);
  expect(b!.matched).toEqual([]);
  expect(b!.ambiguous).toEqual(["222 Different Road/quote.pdf"]);
  expect(a!.confidence).toBe("low");
  expect(b!.confidence).toBe("none");
});

test("duplicate basenames in two customer folders each go to their own customer only", () => {
  const files = [file("111 Testcase Street/photo1.jpg"), file("222 Different Road/photo1.jpg")];
  const [a, b] = linkFiles([lead("111 Testcase Street"), lead("222 Different Road")], files);
  expect(a!.matched.map((m) => m.path)).toEqual(["111 Testcase Street/photo1.jpg"]);
  expect(b!.matched.map((m) => m.path)).toEqual(["222 Different Road/photo1.jpg"]);
});

test("file results use full paths, so a same-name file in another folder is not credited", () => {
  const leads = [lead("111 Testcase Street", ["111 Testcase Street/quote.pdf"])];
  const res = fileResults([{ name: "111 Testcase Street/quote.pdf", status: "ok", message: "read PDF" }, { name: "222 Different Road/quote.pdf", status: "ok", message: "read PDF" }], leads, [[]]);
  expect(res[0]!.status).toBe("ok");
  expect(res[1]!.status).toBe("warn");
  expect(res[1]!.message).toContain("not linked to any customer");
});

test("ZIP/folder member paths: traversal, absolute and hidden entries refused; full folder path kept", () => {
  expect(safeMemberPath("../etc/passwd")).toBeNull();
  expect(safeMemberPath("/abs/a.jpg")).toBeNull();
  expect(safeMemberPath("C:/x.jpg")).toBeNull();
  expect(safeMemberPath("a/../b.jpg")).toBeNull();
  expect(safeMemberPath("__MACOSX/a.jpg")).toBeNull();
  expect(safeMemberPath("job\\111 Testcase Street\\roof.jpg")).toBe("job/111 Testcase Street/roof.jpg");
});

test("two uploads with the same relative path keep separate identities", () => {
  const taken = new Set<string>();
  expect(uniqueManifestPath("A/quote.pdf", taken)).toBe("A/quote.pdf");
  expect(uniqueManifestPath("A/quote.pdf", taken)).toBe("A/quote (2).pdf");
  expect(uniqueManifestPath("B/quote.pdf", taken)).toBe("B/quote.pdf");
});
