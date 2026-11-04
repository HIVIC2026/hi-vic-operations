// Task 10: follow-up answers print only when their condition applies (life support "No" never prints a consent option).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
import { B1_OPTIONS, B2_OPTIONS, KNOWN_WHENS, OFFICIAL_ITEMS, OFFICIAL_TEMPLATES, officialItemActive, type OfficialKey } from "../src/lib/official-forms.core";
import { fillOfficialDocxXml, officialDocxLayout, officialFieldValues, readOfficialDocx } from "../src/lib/official-docx.core";

const xmlOf = (k: OfficialKey) => strFromU8(unzipSync(readFileSync(OFFICIAL_TEMPLATES[k].originalFile))["word/document.xml"]!);
const layoutOf = (k: OfficialKey) => officialDocxLayout(xmlOf(k), k);
const item = (k: OfficialKey, id: string) => OFFICIAL_ITEMS[k].find((i) => i.id === id)!;
const CONSENT = item("piesa", "lifeSupportConsent").options![0]!;

describe("officialItemActive", () => {
  test("every when-condition is known", () => {
    const whens = new Set([...OFFICIAL_ITEMS.piesa, ...OFFICIAL_ITEMS.piisa].map((i) => i.when).filter(Boolean));
    expect(whens.size).toBeGreaterThan(0);
    for (const w of whens) expect(KNOWN_WHENS).toContain(w!);
  });
  test("an unknown when fails closed", () => {
    expect(officialItemActive("piesa", { ...item("piesa", "lifeSupportConsent"), when: "something new" }, { lifeSupport: "Yes" })).toBe(false);
  });
  test("conditions follow the answers", () => {
    expect(officialItemActive("piesa", item("piesa", "lifeSupportConsent"), { lifeSupport: "No" })).toBe(false);
    expect(officialItemActive("piesa", item("piesa", "lifeSupportConsent"), { lifeSupport: "Yes" })).toBe(true);
    expect(officialItemActive("piesa", item("piesa", "p3.conduit"), { "p3.present": "No" })).toBe(false);
    expect(officialItemActive("piesa", item("piesa", "p3.conduit"), { "p3.present": "Yes" })).toBe(true);
    expect(officialItemActive("piesa", item("piesa", "c.licence"), {})).toBe(false);
    expect(officialItemActive("piesa", item("piesa", "p7.appliance"), { "p7.flues": "Yes" })).toBe(true);
    expect(officialItemActive("piisa", item("piisa", "p6.height"), { "p6.present": "No" })).toBe(false);
    expect(officialItemActive("piisa", item("piisa", "p6.reason"), { "p6.present": "Yes", "p6.treatment": ["Topped Up"] })).toBe(true);
    expect(officialItemActive("piisa", item("piisa", "p6.reason"), { "p6.present": "Yes", "p6.treatment": ["Removed"] })).toBe(false);
  });
});

describe("officialFieldValues", () => {
  test("life support No never prints a consent option", () => {
    const r = officialFieldValues("piesa", layoutOf("piesa"), { lifeSupport: "No", lifeSupportConsent: CONSENT });
    expect(r.skipped).toContain("lifeSupportConsent");
    expect(r.filled).not.toContain("lifeSupportConsent");
    expect(r.filled).toContain("lifeSupport");
  });
  test("life support Yes prints it", () => {
    const r = officialFieldValues("piesa", layoutOf("piesa"), { lifeSupport: "Yes", lifeSupportConsent: CONSENT });
    expect(r.filled).toContain("lifeSupportConsent");
    expect(r.skipped).toEqual([]);
  });
  test("the Word form shows no consent tick when life support is No", () => {
    const xml = xmlOf("piesa");
    const r = fillOfficialDocxXml(xml, "piesa", { lifeSupport: "No", lifeSupportConsent: CONSENT });
    expect(r.skipped).toContain("lifeSupportConsent");
    const shown = readOfficialDocx(r.xml, "piesa", xml);
    expect(shown["lifeSupportConsent"] ?? null).toBeNull();
    expect(shown["lifeSupport"]).toBe("No");
  });
  test("repeating rows are skipped by row id when inactive", () => {
    const r = officialFieldValues("piesa", layoutOf("piesa"), { "p7.appliance#0": "Heater", "p7.location#0": "Hall", "p7.hazard#0": "Flue" });
    expect(r.skipped).toEqual(["p7.appliance#0", "p7.location#0", "p7.hazard#0"]);
  });
  test("PIISA top-up reason is skipped when only Removed", () => {
    const r = officialFieldValues("piisa", layoutOf("piisa"), { "p6.present": "Yes", "p6.treatment": ["Removed"], "p6.reason": "x" });
    expect(r.skipped).toEqual(["p6.reason"]);
  });
  test("b2.other is skipped when B2 itself is inactive (B1 not rectification)", () => {
    const a = { b1: B1_OPTIONS[0], b2: [B2_OPTIONS[5]], "b2.other": "Junction box" };
    const v = officialFieldValues("piesa", layoutOf("piesa"), a);
    expect(v.skipped).toEqual(expect.arrayContaining(["b2", "b2.other"]));
    expect(v.filled).not.toContain("b2.other");
    const xml = xmlOf("piesa");
    const r = fillOfficialDocxXml(xml, "piesa", a);
    expect(r.skipped).toEqual(expect.arrayContaining(["b2", "b2.other"]));
    const shown = readOfficialDocx(r.xml, "piesa", xml);
    expect(shown["b2.other"] ?? null).toBeNull();
    expect(shown["b2"] ?? null).toBeNull();
  });
});
