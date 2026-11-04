// New job flow Part 8 Task 11: read-only live form-health check for the Part 8 Mitti paste. Tested against saved published templates.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PART8_TEMPLATES, checkPart8Template, type Part8Template } from "../src/lib/mitti-part8-health.core";
import { INSTALL_DAY_NOV2_Q, INSTALL_DAY_QUESTIONS, INSTALL_DAY_PART_B_PAGE, INSTALL_DAY_PART_B_TEXT } from "../src/lib/install-day.core";
import { A3_REPAIR_NEEDED_LABEL, A3_REPAIR_NEEDED_LEGACY_LABEL, A3_UPGRADES_TODAY_LABEL, A3_UPGRADES_TODAY_LEGACY_LABEL, ADULT_PRESENT_LABEL, ADULT_PRESENT_STOP_A3, CERTIFICATE_NOW_LABEL } from "../src/lib/official-short.core";
import { A1_READY_TO_PRICE_TICK, LEAN_Q } from "../src/lib/ready-check-lean.core";

const fx = (p: string) => JSON.parse(readFileSync(`tests/fixtures/${p}`, "utf8"));
const spec = (k: string) => PART8_TEMPLATES.find((t) => t.key === k) as Part8Template;
const item = (label: string) => ({ item_id: label, label, type: "question" });
/** Same edit Jo's paste makes: add the tick after the contact permission, delete the ECOWOOL R5 choice. */
function pasted(doc: any) {
  const s = JSON.stringify(doc).replace(/\{[^{}]*"label":\s*"ECOWOOL R5"[^{}]*\},?/g, "").replace(/,(\s*[\]}])/g, "$1");
  const out = JSON.parse(s);
  out.template.items.push(item(LEAN_Q.photoIdShown));
  // Main's 4 Nov rebuild: the ready-to-price tick on A1.
  if (JSON.stringify(doc).includes("Installer-Supplied") || JSON.stringify(doc).includes("01ee0428")) out.template.items.push(item(A1_READY_TO_PRICE_TICK));
  return out;
}
/** Main's Part 3 paste on the A3: the upgrades questions (new wording) and the certificate question. */
const part3 = () => [item(A3_REPAIR_NEEDED_LABEL), item(A3_UPGRADES_TODAY_LABEL), item(CERTIFICATE_NOW_LABEL)];

describe("Part 8 form-health check", () => {
  test("templates, ids and labels come from the constants the portal reads", () => {
    expect(PART8_TEMPLATES.map((t) => t.key)).toEqual(["A1", "A2", "A3", "A4", "A5"]);
    expect(spec("A4").templateId).toBe("f600e485-5a3a-4a18-a7a5-ccaa82c3916f");
    expect(spec("A4").labels).toEqual([CERTIFICATE_NOW_LABEL]);
    expect(spec("A1").templateId).toBe("01ee0428-be6d-4435-b34d-8b738935f099");
    expect(spec("A2").templateId).toBe("dbaf67a2-c9c5-4120-8c69-0f4a43c5bd39");
    expect(spec("A3").templateId).toBe("eb3bf3b6-17d3-4c59-9244-5892a0ec16f5");
    expect(spec("A5").templateId).toBe("1f325828-3f71-4b1a-988f-083c83414f95");
    expect(spec("A1").labels).toEqual([LEAN_Q.photoIdShown, A1_READY_TO_PRICE_TICK]);
    expect(spec("A2").labels).toEqual([LEAN_Q.photoIdShown]);
    expect(spec("A1").absentChoices).toEqual(["ECOWOOL R5"]);
    expect(spec("A3").labels).toEqual([ADULT_PRESENT_LABEL, A3_REPAIR_NEEDED_LABEL, A3_UPGRADES_TODAY_LABEL, CERTIFICATE_NOW_LABEL]);
    expect(spec("A3").texts).toEqual([ADULT_PRESENT_STOP_A3]);
    expect(spec("A5").labels).toEqual(Object.values(INSTALL_DAY_NOV2_Q));
    expect(spec("A5").texts).toContain(INSTALL_DAY_PART_B_PAGE);
    // Final review I3: the FULL Part B text is compared (normalised), never just its first line.
    expect(spec("A5").texts).toContain(INSTALL_DAY_PART_B_TEXT);
    expect(spec("A5").texts).not.toContain(INSTALL_DAY_PART_B_TEXT.split("\n")[0]);
  });
  test("published A1 and A2 before the paste: tick missing and ECOWOL R5 still offered", () => {
    for (const k of ["A1", "A2"]) {
      const r = checkPart8Template(fx(`mitti-ready-check/${k.toLowerCase()}-published-2026-10-25.json`), spec(k));
      expect(r.ok).toBe(false);
      expect(r.missing).toEqual(k === "A1" ? [LEAN_Q.photoIdShown, A1_READY_TO_PRICE_TICK] : [LEAN_Q.photoIdShown]);
      expect(r.unexpected).toEqual(["ECOWOOL R5"]);
    }
  });
  test("after the paste A1 and A2 pass", () => {
    for (const k of ["A1", "A2"]) {
      const r = checkPart8Template(pasted(fx(`mitti-ready-check/${k.toLowerCase()}-published-2026-10-25.json`)), spec(k));
      expect(r).toMatchObject({ ok: true, missing: [], renamed: [], unexpected: [], textMissing: [] });
    }
  });
  test("a renamed label is reported with what was found, not just missing", () => {
    const doc = pasted(fx("mitti-ready-check/a1-published-2026-10-25.json"));
    doc.template.items = doc.template.items.filter((i: { label: string }) => i.label !== LEAN_Q.photoIdShown);
    doc.template.items.push(item("I showed my photo ID (name and business)"));
    const r = checkPart8Template(doc, spec("A1"));
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual([LEAN_Q.photoIdShown]);
    expect(r.renamed).toEqual([{ expected: LEAN_Q.photoIdShown, found: "I showed my photo ID (name and business)" }]);
  });
  test("the same label in different case counts as renamed (Mitti reads exact text)", () => {
    const doc = pasted(fx("mitti-ready-check/a1-published-2026-10-25.json"));
    doc.template.items = doc.template.items.filter((i: { label: string }) => i.label !== LEAN_Q.photoIdShown);
    doc.template.items.push(item("i showed my photo id (name + business)"));
    expect(checkPart8Template(doc, spec("A1")).renamed.length).toBeGreaterThan(0);
  });
  test("A3 before the paste lacks the adult question; after it, label and stop line pass", () => {
    const before = fx("a3-published-2026-10-25-read-first.json");
    const r0 = checkPart8Template(before, spec("A3"));
    // This 25 Oct fixture predates the upgrades questions too: all three Part 3 labels are missing with the adult one.
    expect(r0.missing).toEqual([ADULT_PRESENT_LABEL, A3_REPAIR_NEEDED_LABEL, A3_UPGRADES_TODAY_LABEL, CERTIFICATE_NOW_LABEL]);
    expect(r0.textMissing).toEqual([ADULT_PRESENT_STOP_A3]);
    const after = JSON.parse(JSON.stringify(before));
    after.template.items.push(item(ADULT_PRESENT_LABEL), { item_id: "stop", type: "text", label: ADULT_PRESENT_STOP_A3 }, ...part3());
    expect(checkPart8Template(after, spec("A3")).ok).toBe(true);
  });
  test("the stop line is found when Mitti keeps it in a text field, not a label", () => {
    const after = JSON.parse(JSON.stringify(fx("a3-published-2026-10-25-read-first.json")));
    after.template.items.push(item(ADULT_PRESENT_LABEL), { item_id: "stop", type: "text", text: `**${ADULT_PRESENT_STOP_A3}**` });
    expect(checkPart8Template(after, spec("A3")).textMissing).toEqual([]);
  });
  test("join ruling 5: the A3 passes with main's Part 3 wording OR the 25 Oct wording of the upgrades questions (the portal reads both); the certificate question has no alias", () => {
    const base = JSON.parse(JSON.stringify(fx("a3-published-2026-10-25-read-first.json")));
    base.template.items = base.template.items.filter((i: { label?: string }) => ![A3_REPAIR_NEEDED_LEGACY_LABEL, A3_UPGRADES_TODAY_LEGACY_LABEL].includes(i.label ?? ""));
    base.template.items.push(item(ADULT_PRESENT_LABEL), { item_id: "stop", type: "text", label: ADULT_PRESENT_STOP_A3 });
    const legacy = JSON.parse(JSON.stringify(base));
    legacy.template.items.push(item(A3_REPAIR_NEEDED_LEGACY_LABEL), item(A3_UPGRADES_TODAY_LEGACY_LABEL), item(CERTIFICATE_NOW_LABEL));
    expect(checkPart8Template(legacy, spec("A3")).ok).toBe(true);
    const part3Only = JSON.parse(JSON.stringify(base));
    part3Only.template.items.push(...part3());
    expect(checkPart8Template(part3Only, spec("A3")).ok).toBe(true);
    const noCert = JSON.parse(JSON.stringify(base));
    noCert.template.items.push(item(A3_REPAIR_NEEDED_LABEL), item(A3_UPGRADES_TODAY_LABEL));
    expect(checkPart8Template(noCert, spec("A3")).missing).toEqual([CERTIFICATE_NOW_LABEL]);
    // A4: the certificate question is the one Part 3 addition.
    expect(checkPart8Template({ template: { items: [item("Electrician signature")] } }, spec("A4")).missing).toEqual([CERTIFICATE_NOW_LABEL]);
    expect(checkPart8Template({ template: { items: [item("Electrician signature"), item(CERTIFICATE_NOW_LABEL)] } }, spec("A4")).ok).toBe(true);
  });
  test("A5: an old form misses every 2 Nov label; a pasted one passes", () => {
    const old = { template: { items: INSTALL_DAY_QUESTIONS.map((q) => item(q.label)) } };
    const r0 = checkPart8Template(old, spec("A5"));
    expect(r0.missing).toEqual(Object.values(INSTALL_DAY_NOV2_Q));
    expect(r0.ok).toBe(false);
    const full = { template: { items: [...old.template.items, ...Object.values(INSTALL_DAY_NOV2_Q).map(item), { type: "section", label: INSTALL_DAY_PART_B_PAGE }, { type: "text", text: INSTALL_DAY_PART_B_TEXT }, { type: "text", text: ADULT_PRESENT_STOP_A3 }] } };
    expect(checkPart8Template(full, spec("A5"))).toMatchObject({ ok: true, missing: [], textMissing: [] });
  });
  test("A5 (final review I3): a Part B text with only its first line, or a changed later line, is reported; whitespace/punctuation differences are not", () => {
    const base = INSTALL_DAY_QUESTIONS.map((q) => item(q.label)).concat(Object.values(INSTALL_DAY_NOV2_Q).map(item), [{ type: "section", label: INSTALL_DAY_PART_B_PAGE } as any, { type: "text", text: ADULT_PRESENT_STOP_A3 } as any]);
    const withText = (text: string) => ({ template: { items: [...base, { type: "text", text }] } });
    const firstLineOnly = checkPart8Template(withText(INSTALL_DAY_PART_B_TEXT.split("\n")[0]!), spec("A5"));
    expect(firstLineOnly.ok).toBe(false);
    expect(firstLineOnly.textMissing).toEqual([INSTALL_DAY_PART_B_TEXT]);
    const lines = INSTALL_DAY_PART_B_TEXT.split("\n");
    const changedLater = checkPart8Template(withText([...lines.slice(0, -1), lines.at(-1)!.replace("complete and accurate", "accurate")].join("\n")), spec("A5"));
    expect(changedLater.textMissing).toEqual([INSTALL_DAY_PART_B_TEXT]);
    const tidied = checkPart8Template(withText(INSTALL_DAY_PART_B_TEXT.replace(/\n/g, "\n\n").replace(/ {1}/g, "  ")), spec("A5"));
    expect(tidied.textMissing).toEqual([]);
    expect(tidied.ok).toBe(true);
  });
  test("an unreadable reply is never reported as 'missing'", () => {
    const r = checkPart8Template({ template: { name: "x" } }, spec("A1"));
    expect(r.ok).toBe(false);
    expect(r.unreadable).toBe(true);
    expect(r.missing).toEqual([]);
  });
});

describe("Part 8 paste file", () => {
  const doc = readFileSync("docs/mitti-paste-2026-11-02-part8.md", "utf8");
  // Join: the Part 3 labels (A3/A4, main's docs/MITTI_PART3_EDIT_PROMPT.md) and the 4 Nov rebuild tick are not in this paste.
  const notPart8 = new Set<string>([A1_READY_TO_PRICE_TICK, A3_REPAIR_NEEDED_LABEL, A3_UPGRADES_TODAY_LABEL, CERTIFICATE_NOW_LABEL]);
  test("one prompt per template, every label copied character for character", () => {
    for (const s of PART8_TEMPLATES.filter((t) => t.key !== "A4")) {
      expect(doc).toContain(s.templateId);
      for (const l of s.labels.filter((l) => !notPart8.has(l))) expect(doc).toContain(`"${l}"`);
      for (const t of s.texts) expect(doc).toContain(t);
      for (const c of s.absentChoices) expect(doc).toContain(`"${c}"`);
    }
    expect(doc).toContain(INSTALL_DAY_PART_B_TEXT);
  });
  test("style: numbered, change nothing else, publish; nothing from Task 12", () => {
    expect(doc.match(/Change nothing else/g)!.length).toBeGreaterThanOrEqual(3);
    expect(doc.match(/Publish/g)!.length).toBeGreaterThanOrEqual(3);
    const box = doc.match(/```\n([\s\S]*?)\n```/)![1]!;
    expect(box).not.toMatch(/R value|L × W|m² or|Length \(m\)|360° video/i);
    expect(doc).not.toMatch(/\bHIV\b/);
  });
});
