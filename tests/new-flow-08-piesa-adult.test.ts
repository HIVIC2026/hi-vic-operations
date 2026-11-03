import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ADULT_PRESENT_LABEL, ADULT_PRESENT_STOP_A3, SHORT_PIESA_FIELDS } from "../src/lib/official-short.core";
import { piesaEvidenceBlockers, emptyPiesaEvidenceMedia, PIESA_ADULT_BLOCKER } from "../src/lib/piesa-evidence.core";
test("A3 asks the adult question, required, not on the official form", () => {
  const f = SHORT_PIESA_FIELDS.find((x) => x.id === "adultPresent")!;
  expect(f).toMatchObject({ label: ADULT_PRESENT_LABEL, required: true });
  expect(f.source).toMatch(/not part of the official form/);
  const ids = SHORT_PIESA_FIELDS.map((x) => x.id);
  expect(ids.indexOf("adultPresent")).toBe(ids.indexOf("lifeSupportAttachment") + 1);
});
test("No → PIESA held; Yes → no adult blocker; old form (absent) → no adult blocker", () => {
  expect(piesaEvidenceBlockers({ adultPresent: "No" }, emptyPiesaEvidenceMedia())).toContain(PIESA_ADULT_BLOCKER);
  expect(piesaEvidenceBlockers({ adultPresent: "Yes" }, emptyPiesaEvidenceMedia())).not.toContain(PIESA_ADULT_BLOCKER);
  expect(piesaEvidenceBlockers({}, emptyPiesaEvidenceMedia())).not.toContain(PIESA_ADULT_BLOCKER);
});
test("paste file adds it after the life support attachment with its stop line, template ID unchanged", () => {
  const doc = readFileSync("docs/mitti-paste-2026-11-02-A3-adult.md", "utf8");
  expect(doc).toContain(`"${ADULT_PRESENT_LABEL}" — Yes/No — Required`);
  expect(doc).toContain(ADULT_PRESENT_STOP_A3);
  expect(doc).toContain('straight after "Written consent or medical plan (kept as an attachment to this assessment)"');
  expect(doc).toMatch(/Change nothing else[\s\S]*Publish/);
});
test("prompt doc carries item 7a", () => {
  const doc = readFileSync("docs/MITTI_PIESA_CHATGPT_PROMPT.md", "utf8");
  expect(doc).toContain(`7a. \`${ADULT_PRESENT_LABEL}\``);
  expect(doc).toContain(ADULT_PRESENT_STOP_A3);
});
