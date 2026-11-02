import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { STATEMENT_OF_RIGHTS_FILENAME, statementOfRightsPdf } from "../src/lib/statement-of-rights.core";
import { looksLikePdf } from "../src/lib/product-warranty.core";

const FILE = "docs/esc-forms/veu-statement-of-rights.pdf";
const SHA = "6af6ff4dd3c25ff415a1bf4d83db06f9148ed05f98ada7a431629d242d66df6e";

test("the Statement of rights is the ESC's own file, byte for byte", () => {
  const bytes = statementOfRightsPdf()!;
  expect(bytes).not.toBeNull();
  expect(looksLikePdf(bytes)).toBe(true);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(SHA);
  expect(Buffer.from(bytes).equals(readFileSync(FILE))).toBe(true);
  expect(STATEMENT_OF_RIGHTS_FILENAME).toBe("VEU-Statement-of-rights.pdf");
});

test("its text is the VEU consumer statement of rights", async () => {
  const doc = await getDocument({ data: new Uint8Array(statementOfRightsPdf()!) }).promise;
  expect(doc.numPages).toBe(2);
  let text = "";
  for (let i = 1; i <= doc.numPages; i++) text += (await (await doc.getPage(i)).getTextContent()).items.map((x: any) => x.str).join(" ") + "\n";
  expect(text).toContain("Victorian Energy Upgrades");
  expect(text.toLowerCase()).toContain("rights");
});

test("the embed script refuses a non-PDF and embeds null", () => {
  const dir = mkdtempSync(join(tmpdir(), "sor-"));
  const bad = join(dir, "bad.pdf");
  writeFileSync(bad, "<html>not a pdf</html>");
  const out = join(dir, "out.ts");
  const r = Bun.spawnSync(["bun", "scripts/embed-statement-of-rights.ts", bad, out]);
  expect(r.stdout.toString()).toContain("REJECTED");
  expect(readFileSync(out, "utf8")).toContain("STATEMENT_OF_RIGHTS_PDF: string | null = null");
});
