import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { unzipSync } from "fflate";
import { SHORT_PIESA_FIELDS, SHORT_PIISA_FIELDS, MAINS_PROBLEMS, shortAnswersFromEntries } from "../src/lib/official-short.core";
import { expandPiesa, expandPiisa, expansionCoverage } from "../src/lib/official-expand.core";
import { fillOfficialDocxXml } from "../src/lib/official-docx.core";
import { FORMS } from "../src/lib/mitti-forms.core";
import { OFFICIAL_ITEMS, evaluatePiesa, type OfficialAnswers } from "../src/lib/official-forms.core";

const docxXml = (file: string) => new TextDecoder().decode(unzipSync(readFileSync(`docs/official-forms/${file}`))["word/document.xml"]);
const PIESA_XML = docxXml("VEU-pre-installation-electrical-safety-assessment-form_1.docx");
const PIISA_XML = docxXml("VEU-pre-installation-installer-safety-assessment-form-_3.docx");

const entries = (key: "piesa" | "piisa", values: Record<string, string>) =>
  (key === "piesa" ? SHORT_PIESA_FIELDS : SHORT_PIISA_FIELDS)
    .filter((f) => values[f.id!] !== undefined)
    .map((f) => ({ label: f.label, value: values[f.id!] }));

describe("short onsite form", () => {
  test("short fields come first in FORMS, before clearly separated supplemental evidence", () => {
    for (const k of ["piesa", "piisa"] as const) {
      const shorts = k === "piesa" ? SHORT_PIESA_FIELDS : SHORT_PIISA_FIELDS;
      const start = FORMS[k].fields.findIndex((f) => f.supplemental);
      expect(start).toBeGreaterThan(0);
      // PIISA also carries the installer declaration (decl.*) before the signature (Jo, 7 Oct).
      expect(FORMS[k].fields.slice(0, start).map((f) => f.id).filter((id) => !id?.startsWith("decl."))).toEqual(shorts.map((f) => f.id));
      expect(FORMS[k].fields.slice(start).every((f) => f.supplemental)).toBe(true);
    }
  });
  test("the safety questions are clear full sentences, not shorthand", () => {
    const ids = ["mainsSafe", "ceilingSafe", "lifeSupportPresent", "swmsComplete", "piesaReviewed"];
    for (const f of [...SHORT_PIESA_FIELDS, ...SHORT_PIISA_FIELDS]) {
      if (!ids.includes(f.id!)) continue;
      expect(f.label.endsWith("?") || f.label.endsWith(".")).toBe(true);
      expect(f.label.length).toBeGreaterThan(30);
    }
  });
  test("Ready Check / enquiry information is offered as prefill, never re-asked", () => {
    expect(SHORT_PIESA_FIELDS.find((f) => f.id === "lifeSupportRecord")?.prefill).toBe(true);
    expect(SHORT_PIISA_FIELDS.find((f) => f.id === "p2.installDate")?.prefill).toBe(true);
    expect(SHORT_PIISA_FIELDS.find((f) => f.id === "p7.products")?.prefill).toBe(true);
  });
});

describe("short answer parsing", () => {
  test("matches Mitti entries by the exact field label", () => {
    const f = SHORT_PIISA_FIELDS.find((x) => x.id === "p2.lead")!;
    const a = shortAnswersFromEntries("piisa", [{ label: f.label, value: "Jane Doe" }]);
    expect(a["p2.lead"]).toBe("Jane Doe");
  });
  test("duplicate labels are assigned in form order", () => {
    const a = shortAnswersFromEntries("piisa", [
      { label: "Additional installer 1 – full name", value: "Jane Doe" },
      { label: "Additional installer 2 – full name", value: "John Smith" },
    ]);
    expect(a.crewName1).toBe("Jane Doe"); expect(a.crewName2).toBe("John Smith");
  });
});

describe("expansion to official answers", () => {
  test("every official answer item is covered by the expansion or explicitly excluded", () => {
    for (const k of ["piesa", "piisa"] as const) {
      const cov = expansionCoverage(k);
      const all = OFFICIAL_ITEMS[k].filter((i) => i.kind !== "statement" && i.kind !== "heading").map((i) => i.id);
      for (const id of all) expect([...cov.covered, ...cov.excluded]).toContain(id);
    }
    // Decision 329: signatures are now the signer's typed electronic signature (never fabricated); only the PIESA Part 7
    // table detail the A3 form does not ask stays excluded.
    // Decision 336: Part 7 Location / Hazard / actions and the other-hazards table are filled from the A3 hazard rows.
    expect(expansionCoverage("piesa").excluded).toEqual([]);
    expect(expansionCoverage("piisa").excluded).toEqual([]);
  });
  test("an all-safe mains answer sets every official Part 2 item to Yes", () => {
    const { answers } = expandPiesa(shortAnswersFromEntries("piesa", entries("piesa", { mainsSafe: "Yes" })), { lifeSupportDeclared: "no", today: "2026-10-03" });
    for (const id of ["p2.mains", "p2.switchAccessible", "p2.switchIsolates", "p2.switchSecured", "p2.tested", "p2.rcdPresent", "p2.rcdTested"]) expect(answers[id]).toBe("Yes");
  });
  test("a ticked mains problem sets only the matching official item to No", () => {
    const { answers } = expandPiesa(shortAnswersFromEntries("piesa", entries("piesa", { mainsSafe: "No", mainsProblems: MAINS_PROBLEMS[5] })), { lifeSupportDeclared: "no", today: "2026-10-03" });
    expect(answers["p2.rcdPresent"]).toBe("No"); expect(answers["p2.mains"]).toBe("Yes"); expect(answers["p2.switch"]).toBe("Yes");
  });
  test("unknown or blank short answers never become an official No", () => {
    const { answers, flagged } = expandPiesa({}, { lifeSupportDeclared: null, today: "2026-10-03" });
    for (const v of Object.values(answers)) expect(v ?? "").not.toBe("No");
    expect(flagged.length).toBeGreaterThan(0);
  });
  test("decision 294: the electrician answers life support directly; consent only when present; 'No – not received' is a stop", () => {
    const ctx = { lifeSupportDeclared: "no" as const, today: "2026-10-03" };
    const none = expandPiesa(shortAnswersFromEntries("piesa", entries("piesa", { lifeSupportPresent: "No" })), ctx);
    expect(none.answers.lifeSupport).toBe("No");
    expect(none.flagged.some((f) => /life support/i.test(f))).toBe(false);
    const withPlan = expandPiesa(shortAnswersFromEntries("piesa", entries("piesa", { lifeSupportPresent: "Yes", lifeSupportConsent: "Yes – received Medical Plan", lifeSupportAttachment: "media_1" })), ctx);
    expect(withPlan.answers.lifeSupport).toBe("Yes");
    expect(withPlan.answers.lifeSupportConsent).toBe("Yes – received Medical Plan");
    expect(withPlan.flagged.some((f) => /life support/i.test(f))).toBe(false);
    const notReceived = expandPiesa(shortAnswersFromEntries("piesa", entries("piesa", { lifeSupportPresent: "Yes", lifeSupportConsent: "No – not received" })), ctx);
    expect(notReceived.answers.lifeSupport).toBe("Yes");
    expect(notReceived.answers.lifeSupportConsent ?? null).toBeNull();
    expect(notReceived.flagged.some((f) => /NOT received — STOP/.test(f))).toBe(true);
    // Older forms: "Is the life support record shown above still correct?" against the enquiry record is still read.
    const legacyOk = expandPiesa({ lifeSupportConfirm: "Yes" }, ctx);
    expect(legacyOk.answers.lifeSupport).toBe("No");
    const legacyDisputed = expandPiesa({ lifeSupportConfirm: "No" }, ctx);
    expect(legacyDisputed.answers.lifeSupport ?? null).toBeNull();
    expect(legacyDisputed.flagged.some((f) => /office must resolve/i.test(f))).toBe(true);
  });
  test("legal declarations are only set when the signer actually ticked them; signatures never", () => {
    const { answers, flagged } = expandPiesa(shortAnswersFromEntries("piesa", entries("piesa", {})), { lifeSupportDeclared: "no", today: "2026-10-03" });
    expect(answers["b3.declaration"] ?? null).toBeNull();
    expect(flagged.some((f) => /declaration/i.test(f))).toBe(true);
    expect(flagged.some((f) => /signature/i.test(f))).toBe(true);
  });
  test("PIISA crew names and EEC numbers expand into the official table rows", () => {
    const { answers, flagged } = expandPiisa(shortAnswersFromEntries("piisa", entries("piisa", { crewName1: "Jane Doe", crewEec1: "EEC123456", crewName2: "John Smith" })), { lifeSupportDeclared: "no", today: "2026-10-03" });
    expect(answers["p2.addName#0"]).toBe("Jane Doe"); expect(answers["p2.addEec#0"]).toBe("EEC123456");
    expect(answers["p2.addName#1"]).toBe("John Smith");
    expect(flagged.some((f) => /installer 2.*EEC/i.test(f))).toBe(true);
  });
  test("PIISA all-clear safe-system answer sets all three official Part 3 items", () => {
    const { answers } = expandPiisa(shortAnswersFromEntries("piisa", entries("piisa", { swmsComplete: "Yes" })), { lifeSupportDeclared: "no", today: "2026-10-03" });
    expect(answers["p3.swms"]).toBe("Yes"); expect(answers["p3.table1"]).toBe("Yes"); expect(answers["p3.isolated"]).toBe("Yes");
  });
  test("PIISA carries solar and downlight answers over from the signed PIESA", () => {
    const piesaAnswers: OfficialAnswers = { "p3.present": "Yes", "p3.instructions": "Yes", "p3.isolator": "Yes", "p6.recessed": "Yes", "p6.count": "4", b1: "No repair work is needed" };
    const { answers } = expandPiisa(shortAnswersFromEntries("piisa", entries("piisa", { piesaReviewed: "Yes" })), { lifeSupportDeclared: "no", today: "2026-10-03", piesaAnswers });
    expect(answers["p4.present"]).toBe("Yes"); expect(answers["p5.recessed"]).toBe("Yes"); expect(answers["p5.count"]).toBe("4");
    expect(answers["p5.electricianPresent"]).toBe("N/A");
  });
});

describe("official Word form filling", () => {
  const fullPiesa = (): OfficialAnswers => ({
    jobRef: "HV-1003", address: "1 Test St, Melbourne VIC 3000", inspectionDate: "2026-10-03",
    lifeSupport: "No", "p2.mains": "Yes", "p2.switch": "Yes", "p2.switchAccessible": "Yes", "p2.switchIsolates": "Yes",
    "p2.switchSecured": "Yes", "p2.tested": "Yes", "p2.rcdPresent": "Yes", "p2.rcdTested": "Yes",
    "p3.present": "No", "p4.conduit": "Yes", "p4.supported": "Yes", "p4.treatment": "Yes", "p4.tps": "Yes",
    "p4.terminations": "Yes", "p4.plugBases": "Yes", "p4.foil": "Yes",
    "p5.nonTps": "No", "p5.splitConduit": "No", "p5.damaged": "No",
    "p6.recessed": "Yes", "p6.count": "4", "p6.prohibited": "No", "p7.appliances": "No", "p7.flues": "No",
    "b3.licence": "A12345", "b3.name": "Sam Spark", "b3.recName": "Sparky Pty Ltd", "b3.recNo": "REC12345", "b3.phone": "0400000000",
    "o.name": "Chris Lowe", "o.date": "2026-10-03",
  });
  test("fills text fields, dates and yes/no checkboxes on the real PIESA original", () => {
    const r = fillOfficialDocxXml(PIESA_XML, "piesa", fullPiesa());
    expect(r.xml).toContain("Sparky Pty Ltd"); expect(r.xml).toContain("REC12345"); expect(r.xml).toContain("03/10/2026");
    expect(r.filled).toContain("jobRef"); expect(r.filled).toContain("lifeSupport");
    expect(r.missed).toEqual([]);
  });
  test("fills the real PIISA original including the additional-installer rows", () => {
    const r = fillOfficialDocxXml(PIISA_XML, "piisa", {
      jobRef: "HV-1003", address: "2 Test Rd, Frankston VIC 3199", startDate: "2026-10-10", completionDate: "2026-10-10",
      "p1.powerInformed": "Yes", lifeSupport: "No",
      "p2.installDate": "2026-10-10", "p2.ap": "Home Insulation Victoria", "p2.company": "Insulate Co", "p2.lead": "Pat Inst", "p2.leadEec": "EEC999",
      "p2.addName#0": "Jane Doe", "p2.addEec#0": "EEC123456",
      "p3.swms": "Yes", "p3.table1": "Yes", "p3.isolated": "Yes",
      "p4.present": "No", "p5.reviewed": "Yes", "p5.electricianPresent": "N/A", "p5.recessed": "Yes", "p5.count": "4",
      "p5.icConfirmed": "Yes", "p5.safeToCover": "Yes", "p5.rcd": "Yes", "p5.tps": "Yes", "p5.basic": "Yes", "p5.noAccess": "Yes",
      "p6.present": "No", "p7.products": "Knauf Earthwool R5.0", "p8.name": "Pat Inst", "p8.date": "2026-10-10",
    });
    expect(r.missed).toEqual([]);
    expect(r.xml).toContain("Insulate Co"); expect(r.xml).toContain("EEC123456");
  });
  test("blank answers leave the official form untouched (nothing guessed)", () => {
    const r = fillOfficialDocxXml(PIESA_XML, "piesa", {});
    expect(r.filled).toEqual([]);
    expect(r.xml).toBe(PIESA_XML);
  });
  test("a full short-form PIESA round trip fills the official document and passes evaluation", () => {
    const { answers } = expandPiesa(shortAnswersFromEntries("piesa", entries("piesa", {
      jobRef: "HV-1003", address: "1 Test St, Melbourne VIC 3000", inspectionDate: "2026-10-03",
      lifeSupportPresent: "No", mainsSafe: "Yes", solarPresent: "No", ceilingSafe: "Yes",
      downlightsPresent: "No", appliancesPresent: "No", rectificationOutcome: "No repair work is needed",
      "b3.declaration": "Yes", ownerConfirm: "Yes",
      "b3.licence": "A12345", "b3.name": "Sam Spark", "b3.recName": "Sparky Pty Ltd", "b3.recNo": "REC12345", "b3.phone": "0400000000",
      "o.name": "Chris Lowe", "o.date": "2026-10-03",
    })), { lifeSupportDeclared: "no", today: "2026-10-03" });
    const r = fillOfficialDocxXml(PIESA_XML, "piesa", answers);
    expect(r.xml).toContain("Sparky Pty Ltd");
    expect(evaluatePiesa(answers).blockers.filter((b) => b.item === "lifeSupport")).toEqual([]);
  });
});
