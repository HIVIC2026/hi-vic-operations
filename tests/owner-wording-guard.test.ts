// Global owner wording rules (Jo 2 Nov 2026): retired owner phrases never come back into src, comments included.
import { expect, test } from "bun:test";
import { OWNER_WORDING_TERMS, scan } from "../scripts/scan-retired-terms";

const OWNER_TERMS = ["Thousands of Victorians", "lower power bills", "VEU discount", "old price label", "fixes wording to owners", "mandatory PIESA", "install duration", "Wrong time link", "See where you're up to", "7-day balance"];

test("the scan exports every owner wording term as strict", () => {
  expect(OWNER_WORDING_TERMS.map((t) => t.term).sort()).toEqual([...OWNER_TERMS].sort());
  for (const t of OWNER_WORDING_TERMS) expect(t.strict).toBe(true);
});

// Signed agreement and owner gate texts keep their exact wording until a new version is approved (scan RETAINED list).
const SIGNED = ["src/lib/installer-agreement.text.ts", "src/lib/rec-agreement.text.ts", "src/lib/owner-gates.core.ts"];

test("no retired owner wording left in src", () => {
  const all = scan().filter((h) => OWNER_TERMS.includes(h.term) && h.file.startsWith("src/"));
  expect(all.filter((h) => h.kind !== "internal-identifier")).toEqual([]);
  for (const h of all) expect(SIGNED).toContain(h.file);
});
