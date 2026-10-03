import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { unzipSync } from "fflate";
import { SHORT_PIESA_FIELDS, SHORT_PIISA_FIELDS, shortAnswersFromEntries } from "../src/lib/official-short.core";
import { expandPiesa, expandPiisa, expandShortAnswers, expansionCoverage } from "../src/lib/official-expand.core";
import { fillOfficialDocxXml } from "../src/lib/official-docx.core";
import { FORMS } from "../src/lib/mitti-forms.core";
import { OFFICIAL_ITEMS, evaluatePiesa, evaluatePiisa, type OfficialAnswers } from "../src/lib/official-forms.core";

const docxXml = (file: string) => new TextDecoder().decode(unzipSync(readFileSync(`docs/official-forms/${file}`))["word/document.xml"]);
const PIESA_XML = docxXml("VEU-pre-installation-electrical-safety-assessment-form_1.docx");
const PIISA_XML = docxXml("VEU-pre-installation-installer-safety-assessment-form-_3.docx");

const shortEntries = (key: "piesa" | "piisa", values: Record<string, string>) =>
  (key === "piesa" ? SHORT_PIESA_FIELDS : SHORT_PIISA_FIELDS)
    .filter((f) => values[f.id] !== undefined)
    .map((f) => ({ label: f.label, value: values[f.id] }));

describe("short onsite form", () => {
  test("every short field is an official mapping, none supplemental, in FORMS before supplemental evidence", () => {
    for (const k of ["piesa", "piisa"] as const) {
      const shorts = k === "piesa" ? SHORT_PIESA_FIELDS : SHORT_PIISA_FIELDS;
      const start = FORMS[k].fields.findIndex((f) => f.supplemental);
      expect(FORMS[k].fields.slice(0, start).map((f) => f.id)).toEqual(shorts.map((f) => f.id));
      expect(shorts.every((f) => f.official && !f.supplemental)).toBe(true);
    }
  });
  test("labels are clear full sentences (no telegraphic shorthand, no ALL-CAPS fragments)", () => {
    for (const f of [...SHORT_PIESA_FIELDS, ...SHORT_PIISA_FIELDS]) {
      expect(f.label.endsWith("?") || f.label.endsWith(".") || f.hint).toBeTruthy();
      expect(f.label).not.toMatch(/\b(e\.g\.|ie\.|w\/)\b/);
      expect(f.label.length).toBeGreaterThan(15);
    }
  });
  test("Ready Check measurements and photos are offered as prefill on the installer form", () => {
    const ids = SHORT_PIISA_FIELDS.filter((f) => f.prefill).map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["roof_space_photo", "switchboard_photo", "existing_insulation_photo", "roof_type", "ceiling_area_m2"]));
    expect(SHORT_PIESA_FIELDS.find((f) => f.id === "b.life_support")?.prefill).toBe(true);
  });
});

describe("short answer parsing", () => {
  test("matches by label, tolerating light Mitti edits", () => {
    const f = SHORT_PIISA_FIELDS.find((x) => x.id === "ceiling_area_m2")!;
    const a = shortAnswersFromEntries("piisa", [{ label: `${f.label} *`, value: "120" }]);
    expect(a.ceiling_area_m2).toBe("120");
  });
});

describe("expansion to official answers", () => {
  test("every official answer item is covered by the short form or explicitly flagged", () => {
    for (const k of ["piesa", "piisa"] as const) {
      const cov = expansionCoverage(k);
      expect(cov.unmapped).toEqual([]);
      expect(cov.flagged.length).toBeGreaterThan(0); // declarations/signatures are never fabricated
    }
  });
  test("an all-clear PIESA answers the official safety items yes", () => {
    const { answers } = expandPiesa(shortAnswersFromEntries("piesa", shortEntries("piesa", {
      "b.life_support": "No", "b.hazards": "No – the roof space and switchboard area are clear of these hazards.",
      "b.switchboard_type": "Modern switchboard with circuit breakers and safety switches (RCDs).",
      "b.appliances": "No – I checked every one listed and none of these problems are present.",
      "b.safe_system": "Yes – the installation is electrically safe and in proper working order.",
    })), { lifeSupportDeclared: "none", today: "2026-10-03" });
    expect(answers["b2.1"]).toBe("No"); expect(answers["c.1"]).toBe("Yes");
    expect(evaluatePiesa(answers).blockers.filter((b) => b.item === "b.life_support")).toEqual([]);
  });
  test("a hazard sentence maps to the matching official hazard items only", () => {
    const { answers } = expandPiesa(shortAnswersFromEntries("piesa", shortEntries("piesa", {
      "b.hazards": "Yes – there is evidence of vermin in the roof space.",
    })), { lifeSupportDeclared: "none", today: "2026-10-03" });
    expect(answers["b1.4"]).toBe("Yes"); expect(answers["b1.1"]).toBe("No"); expect(answers["b1.5"]).toBe("No");
  });
  test("unknown or blank short answers never become an official No", () => {
    const { answers, flagged } = expandPiesa({}, { lifeSupportDeclared: null, today: "2026-10-03" });
    for (const v of Object.values(answers)) expect(v ?? "").not.toBe("No");
    expect(flagged.length).toBeGreaterThan(0);
  });
  test("legal declarations and signatures are never answered by the expansion", () => {
    const { answers, flagged } = expandPiesa(shortAnswersFromEntries("piesa", shortEntries("piesa", { "b.safe_system": "Yes – the installation is electrically safe and in proper working order." })), { lifeSupportDeclared: "none", today: "2026-10-03" });
    const declIds = OFFICIAL_ITEMS.piesa.filter((i) => i.kind === "tick" || i.kind === "signature").map((i) => i.id);
    for (const id of declIds) expect(answers[id] ?? null).toBeNull();
    expect(flagged.some((f) => /declaration|signed/i.test(f))).toBe(true);
  });
  test("PIISA EEC numbers expand to the official table rows", () => {
    const { answers } = expandPiisa(shortAnswersFromEntries("piisa", shortEntries("piisa", { installers: "Jane Doe EEC123456; John Smith EEC654321" })), { today: "2026-10-03" });
    expect(answers["installers.name#0"]).toBe("Jane Doe"); expect(answers["installers.eec#1"]).toBe("EEC654321");
  });
  test("PIISA all-clear maps access items to No and confirmation items to Yes", () => {
    const { answers } = expandPiisa(shortAnswersFromEntries("piisa", shortEntries("piisa", { "piisa.access_ok": "Yes – all of the above are fine." })), { today: "2026-10-03" });
    expect(answers["g.2"]).toBe("No"); expect(answers["g.5"]).toBe("Yes"); expect(answers["g.7"]).toBe("Yes");
  });
});

describe("official Word form filling", () => {
  const fullPiesa = (): OfficialAnswers => ({
    "a.business_name": "Sparky Pty Ltd", "a.rec_number": "REC12345", "a.assessor_name": "Sam Spark",
    "a.address": "1 Test St, Melbourne VIC 3000", "a.suburb": "Melbourne", "a.state": "VIC", "a.postcode": "3000",
    "a.customer": "Chris Lowe", "a.date": "2026-10-03", "b.life_support": "No",
    "b1.1": "No", "b1.2": "No", "b1.3": "No", "b1.4": "No", "b1.5": "No", "b1.6": "No", "b1.7": "No",
    "b2.1": "No", "b2.2": "No", "b2.3": "No", "b2.4": "No", "b2.5": "No", "b2.6": "No", "b2.7": "No", "b2.8": "No",
    "b3.1": "Yes", "b3.2": "Yes", "b3.3": "Yes", "b3.4": "Yes", "b3.5": "Yes",
    "c.1": "Yes", "c.2": "Yes", "c.3": "Yes", "c.4": "Yes", "c.5": "Yes", "c.6": "Yes", "c.7": "Yes", "c.8": "Yes",
    "c.9": "Yes", "c.10": "Yes", "c.11": "Yes", "c.12": "Yes", "c.13": "Yes", "c.14": "Yes", "c.15": "Yes", "c.16": "Yes",
    "c.17": "Yes", "c.18": "Yes", "c.19": "Yes", "c.20": "Yes", "c.21": "Yes", "c.22": "Yes", "c.23": "Yes", "c.24": "Yes", "c.25": "Yes",
    "d.job_card": "Yes", "e.rectification": "No", "o.name": "Sam Spark",
  });
  test("fills text fields, dates and yes/no checkboxes on the real PIESA original", () => {
    const r = fillOfficialDocxXml(PIESA_XML, "piesa", fullPiesa());
    expect(r.xml).toContain("Sparky Pty Ltd"); expect(r.xml).toContain("REC12345"); expect(r.xml).toContain("03/10/2026");
    expect(r.filled).toContain("a.business_name"); expect(r.filled).toContain("b.life_support");
    expect(r.missed).toEqual([]);
    expect(r.xml).not.toContain("Totally invented");
  });
  test("fills the real PIISA original including installer table rows", () => {
    const r = fillOfficialDocxXml(PIISA_XML, "piisa", {
      "p.business_name": "Insulate Co", "p.abn": "51824753556", "p.contact_name": "Pat Inst",
      "p.address": "2 Test Rd, Frankston VIC 3199", "p.suburb": "Frankston", "p.postcode": "3199",
      "installers.name#0": "Jane Doe", "installers.eec#0": "EEC123456",
      "b.1": "Yes", "b.2": "Yes", "b.3": "Yes", "c.1": "No", "c.2": "No", "c.3": "No", "c.4": "No",
      "d.1": "Yes", "d.2": "Yes", "d.3": "Yes", "d.4": "Yes", "d.5": "Yes",
      "e.1": "Yes", "e.2": "Yes", "e.3": "Yes", "f.1": "Yes", "f.2": "Yes", "f.3": "Yes",
      "g.1": "No", "g.2": "No", "g.3": "No", "g.4": "No", "g.5": "Yes", "g.6": "Yes", "g.7": "Yes",
      "h.insulation": "Yes", "h.combustible": "No", "o.name": "Pat Inst",
    });
    expect(r.missed).toEqual([]);
    expect(r.xml).toContain("Insulate Co"); expect(r.xml).toContain("EEC123456");
  });
  test("blank answers leave the official form blank (nothing guessed)", () => {
    const r = fillOfficialDocxXml(PIESA_XML, "piesa", {});
    expect(r.filled).toEqual([]);
    expect(r.xml).toBe(PIESA_XML);
  });
  test("a full short-form PIESA round trip fills and passes evaluation", () => {
    const { answers } = expandPiesa(shortAnswersFromEntries("piesa", shortEntries("piesa", {
      "a.business_name": "Sparky Pty Ltd", "a.rec_number": "REC12345", "a.assessor_name": "Sam Spark", "a.date": "2026-10-03",
      "b.life_support": "No", "b.hazards": "No – the roof space and switchboard area are clear of these hazards.",
      "b.switchboard_type": "Modern switchboard with circuit breakers and safety switches (RCDs).",
      "b.appliances": "No – I checked every one listed and none of these problems are present.",
      "b.safe_system": "Yes – the installation is electrically safe and in proper working order.",
    })), { lifeSupportDeclared: "none", today: "2026-10-03" });
    const r = fillOfficialDocxXml(PIESA_XML, "piesa", answers);
    expect(r.xml).toContain("Sparky Pty Ltd");
    expect(evaluatePiesa(answers).blockers.filter((b) => b.item === "b.life_support")).toEqual([]);
  });
});

describe("evaluation still gates on expanded answers", () => {
  test("PIISA all-clear short form evaluates without unrelated new blockers", () => {
    const { answers } = expandPiisa(shortAnswersFromEntries("piisa", shortEntries("piisa", {
      "b.purpose": "Yes – the planned work matches the activity description.",
      "b.combustion_appliances": "Yes – either there are none, or every one is open-flued.",
      "c.products": "Yes – every product is on the VEU product register.",
      "c.halogens": "No – there are no mains-voltage halogen lamps.",
      "d.clearances": "Yes – I checked and the required clearances can all be met.",
      "e.barriers": "Yes – compliant barriers or covers will be fitted to every heat-producing item.",
      "e.exhaust": "Yes – every exhaust fan and flue will be left completely clear, with a barrier where needed.",
      "f.insulation": "Yes – the ceiling insulation meets the program's R-value and installation requirements.",
      "piisa.access_ok": "Yes – all of the above are fine.",
      "piisa.combustible": "No – the roof space is clear of these materials.",
    })), { today: "2026-10-03" });
    const blockers = evaluatePiisa(answers).blockers.map((b) => b.item);
    expect(blockers).not.toContain("b.1"); expect(blockers).not.toContain("c.4"); expect(blockers).not.toContain("g.5");
  });
});
