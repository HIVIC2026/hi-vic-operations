import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { STATEMENT_OF_RIGHTS_FILENAME, statementOfRightsPdf } from "../src/lib/statement-of-rights.core";
import { looksLikePdf } from "../src/lib/product-warranty.core";

const ORIGINAL = "docs/esc-forms/veu-statement-of-rights.pdf";
const ORIGINAL_SHA = "6af6ff4dd3c25ff415a1bf4d83db06f9148ed05f98ada7a431629d242d66df6e";
const FILE = "docs/esc-forms/veu-statement-of-rights-clean.pdf";
const SHA = "1b131870bdb849641641014483725c1232c39eca8619adb16560520dd28144a1";
const sha = (b: Uint8Array | Buffer) => createHash("sha256").update(b).digest("hex");
const hasPdftotext = Bun.spawnSync(["which", "pdftotext"]).exitCode === 0;
const hasPdftoppm = Bun.spawnSync(["which", "pdftoppm"]).exitCode === 0;
// Words per page (pdftotext -bbox), in reading order.
const words = (file: string, page: number) =>
  [...Bun.spawnSync(["pdftotext", "-bbox", "-f", String(page), "-l", String(page), file, "-"]).stdout.toString().matchAll(/<word [^>]*>([^<]*)<\/word>/g)].map((m) => m[1]);

test("the Statement of rights is the cleaned ESC file, byte for byte", () => {
  expect(sha(readFileSync(ORIGINAL))).toBe(ORIGINAL_SHA); // original kept untouched in the repo
  const bytes = statementOfRightsPdf()!;
  expect(bytes).not.toBeNull();
  expect(looksLikePdf(bytes)).toBe(true);
  expect(sha(bytes)).toBe(SHA);
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
  expect(text).not.toMatch(/\bxx\b/i);
});

test.skipIf(!hasPdftotext)("the clean file differs from the original only by the word xx", () => {
  for (const page of [1, 2]) {
    const orig = words(ORIGINAL, page);
    expect(orig.length).toBeGreaterThan(50);
    if (page === 1) expect(orig).toContain("xx");
    expect(words(FILE, page)).toEqual(orig.filter((w) => w !== "xx"));
  }
  expect(words(FILE, 1).length).toBe(words(ORIGINAL, 1).length - 1);
  expect(words(FILE, 2).length).toBe(words(ORIGINAL, 2).length);
});

test("page 1 renders the same as the original", () => {
  if (!hasPdftoppm) {
    console.warn("SKIPPED: pdftoppm is not installed, so the page 1 render comparison did not run");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "sor-render-"));
  for (const [name, file] of [["o", ORIGINAL], ["c", FILE]]) {
    expect(Bun.spawnSync(["pdftoppm", "-r", "72", "-png", file, join(dir, name)]).exitCode).toBe(0);
  }
  for (const n of ["1", "2"]) {
    expect(readFileSync(join(dir, `c-${n}.png`)).equals(readFileSync(join(dir, `o-${n}.png`)))).toBe(true);
  }
});

test("the clean script refuses (non-zero, writes nothing) when there is no xx to remove", () => {
  const out = join(mkdtempSync(join(tmpdir(), "sor-clean-")), "out.pdf");
  const r = Bun.spawnSync(["python3", "scripts/clean-statement-of-rights.py", FILE, out]);
  expect(r.exitCode).not.toBe(0);
  expect(r.stderr.toString()).toContain("REFUSED");
  expect(existsSync(out)).toBe(false);
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
