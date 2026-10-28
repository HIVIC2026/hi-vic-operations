import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const server = readFileSync("src/lib/bulk-import.server.ts", "utf8");

test("electrician choice is recorded before the draft quote is priced", () => {
  const confirm = server.slice(server.indexOf("export async function confirmBatch"));
  expect(confirm.indexOf("recordJobElectricianChoice")).toBeGreaterThan(0);
  expect(confirm.indexOf("recordJobElectricianChoice")).toBeLessThan(confirm.indexOf("draftQuoteFromImport("));
});

test("matched files are attached only from this business's own stored imports, once each", () => {
  expect(server).toContain("const prefix = `partners/${batch.business_id}/imports/`");
  expect(server).toContain('verifyStoredUpload("job-files", stored, mime)');
  expect(server).toContain("if (done.has(stored))");
  expect(server).toContain('"bulk_import_files_not_attached"');
});
