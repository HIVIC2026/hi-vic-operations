// Decision 329 (25 Oct 2026): official form filling fixed — multi-select ticks, the Word filler (No / B1 / B2 / main switch /
// Part 7 table / Section C w:checked / nested runs), typed electronic signatures, the owner's declarations, the text PDF.
// The filled .docx XML is opened and every box / cell asserted by its position in the official form, read with an
// independent parser (not the filler's own layout map).
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { B1_OPTIONS, B2_OPTIONS, OFFICIAL_TEMPLATES, buildSignedSnapshot, electronicSignature, evaluatePiesa, isElectronicSignature, splitSelections, type OfficialAnswers } from "../src/lib/official-forms.core";
import { WORD_FORM_NO_FIELD, fillOfficialDocxXml, officialDocxLayout, readOfficialDocx, xmlProblems } from "../src/lib/official-docx.core";
import { expandPiesa, expandPiisa, expansionCoverage } from "../src/lib/official-expand.core";
import { CEILING_PROBLEMS, MAINS_PROBLEMS, RECTIFICATION_OUTCOMES, SOLAR_PROBLEMS, SHORT_PIESA_FIELDS, shortAnswersFromEntries } from "../src/lib/official-short.core";
import { mergeFixesIntoPiesaSnapshot, type FixesDayRead } from "../src/lib/fixes-day.core";
import { OWNER_FIXES_NOT_CONFIRMED_FLAG } from "../src/lib/piesa-fixes-confirm.core";
import { officialPiesaPdfText } from "../src/lib/electrician-piesa-copy.core";
import { pdfSafeText } from "../src/lib/pdf-text.core";

const original = (k: "piesa" | "piisa") => strFromU8(unzipSync(readFileSync(OFFICIAL_TEMPLATES[k].originalFile))["word/document.xml"]!);
const PIESA = original("piesa");
const PIISA = original("piisa");

/** Independent reader: every legacy form field in document order → { kind, checked, text }. */
function rawFields(xml: string) {
  const out: { kind: "check" | "text"; checked: boolean; text: string }[] = [];
  const re = /<w:fldChar w:fldCharType="begin">([\s\S]*?)<\/w:fldChar>([\s\S]*?)w:fldCharType="end"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const ff = m[1]!;
    if (ff.includes("<w:checkBox>")) {
      const c = /<w:checked w:val="(\d)"\/>/.exec(ff);
      out.push({ kind: "check", checked: c ? c[1] === "1" : /<w:default w:val="1"\/>/.test(ff), text: "" });
    } else if (ff.includes("<w:textInput")) {
      const res = m[2]!.split('w:fldCharType="separate"')[1] ?? "";
      out.push({ kind: "text", checked: false, text: [...res.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join("").replace(/^[ \s]+$/, "") });
    }
  }
  return out;
}
const checkedIdx = (xml: string) => rawFields(xml).flatMap((f, i) => (f.kind === "check" && f.checked ? [i] : []));
function xmllintOk(xml: string): boolean | null {
  try { execFileSync("which", ["xmllint"], { stdio: "ignore" }); } catch { return null; }
  const d = mkdtempSync(join(tmpdir(), "docx329-"));
  try { writeFileSync(join(d, "d.xml"), xml); execFileSync("xmllint", ["--noout", join(d, "d.xml")], { stdio: "ignore" }); return true; } catch { return false; } finally { rmSync(d, { recursive: true, force: true }); }
}

describe("multi-select answers: matched against the options, never comma-split (point 1)", () => {
  test("two B2 options joined with ', ' (each containing commas) → both, in form order", () => {
    expect(splitSelections(`${B2_OPTIONS[2]}, ${B2_OPTIONS[0]}`, B2_OPTIONS)).toEqual({ selected: [B2_OPTIONS[0], B2_OPTIONS[2]], unknown: [] });
    expect(splitSelections(`${B2_OPTIONS[3]}, ${B2_OPTIONS[4]}, ${B2_OPTIONS[5]}`, B2_OPTIONS).selected).toEqual([B2_OPTIONS[3], B2_OPTIONS[4], B2_OPTIONS[5]]);
  });
  test("arrays, ' | ', new lines, curly quotes and a dropped final full stop all read", () => {
    expect(splitSelections([MAINS_PROBLEMS[5], MAINS_PROBLEMS[6]], MAINS_PROBLEMS).selected).toEqual([MAINS_PROBLEMS[5], MAINS_PROBLEMS[6]]);
    expect(splitSelections(`${SOLAR_PROBLEMS[0]} | ${SOLAR_PROBLEMS[1]}`, SOLAR_PROBLEMS).selected).toEqual([SOLAR_PROBLEMS[0], SOLAR_PROBLEMS[1]]);
    expect(splitSelections(`${CEILING_PROBLEMS[1].replace(/\.$/, "")}\n${CEILING_PROBLEMS[9]}`, CEILING_PROBLEMS).selected).toEqual([CEILING_PROBLEMS[1], CEILING_PROBLEMS[9]]);
    expect(splitSelections(B2_OPTIONS[0].replace(/[‘’]/g, "'"), B2_OPTIONS).selected).toEqual([B2_OPTIONS[0]]);
  });
  test("an unknown piece is returned as unknown, never guessed", () => {
    expect(splitSelections(`${MAINS_PROBLEMS[0]}, Something else entirely, ${MAINS_PROBLEMS[1]}`, MAINS_PROBLEMS)).toEqual({ selected: [MAINS_PROBLEMS[0], MAINS_PROBLEMS[1]], unknown: ["something else entirely"] });
  });
  test("expandPiesa: two mains ticks → both No; solar + ceiling lists; B2 two boxes; unknown flagged", () => {
    const base = { lifeSupportPresent: "No", solarPresent: "Yes", solarSafe: "No", ceilingSafe: "No", downlightsPresent: "No", appliancesPresent: "No", "b3.declaration": "Yes", electricianSignature: "x" };
    const e = expandPiesa({
      ...base, mainsSafe: "No", mainsProblems: `${MAINS_PROBLEMS[5]}, ${MAINS_PROBLEMS[6]}`,
      solarProblems: `${SOLAR_PROBLEMS[1]}, ${SOLAR_PROBLEMS[2]}`, ceilingProblems: `${CEILING_PROBLEMS[1]}, ${CEILING_PROBLEMS[9]}, Rotten joist`,
      rectificationOutcome: RECTIFICATION_OUTCOMES[1], rectificationWork: `${B2_OPTIONS[0]}, ${B2_OPTIONS[2]}`,
    }, { lifeSupportDeclared: null, today: "2026-10-28" });
    expect([e.answers["p2.rcdPresent"], e.answers["p2.rcdTested"], e.answers["p2.mains"]]).toEqual(["No", "No", "Yes"]);
    expect([e.answers["p3.isolator"], e.answers["p3.conduit"], e.answers["p3.instructions"]]).toEqual(["No", "No", "Yes"]);
    expect([e.answers["p4.supported"], e.answers["p5.damaged"], e.answers["p4.conduit"]]).toEqual(["No", "Yes", "Yes"]);
    expect(e.answers["b2"]).toEqual([B2_OPTIONS[0], B2_OPTIONS[2]]);
    expect(e.flagged.some((f) => f.includes('not recognised ("rotten joist")'))).toBe(true);
    expect(evaluatePiesa(e.answers).blockers.map((b) => b.rule)).not.toContain("B1-B2");
  });
});

// ---------- the Word filler (point 2) ----------
const full: OfficialAnswers = {
  jobRef: "HV-1", address: "1 A St & Co, Bentleigh VIC 3204 $& $1", inspectionDate: "2026-10-27", lifeSupport: "No",
  "p2.mains": "No", "p2.switch": "No", "p2.switchAccessible": "Yes", "p2.switchIsolates": "No", "p2.switchSecured": "No", "p2.tested": "Yes", "p2.rcdPresent": "No", "p2.rcdTested": "No",
  "p3.present": "No", "p4.conduit": "Yes", "p4.supported": "Yes", "p4.treatment": "Yes", "p4.tps": "N/A", "p4.terminations": "Yes", "p4.plugBases": "Yes", "p4.foil": "Yes",
  "p5.nonTps": "No", "p5.splitConduit": "No", "p5.damaged": "No", "p6.recessed": "Yes", "p6.count": "4", "p6.prohibited": "Yes",
  "p7.appliances": "Yes", "p7.flues": "No", "p7.appliance#0": "Exhaust fan", "p7.location#0": "Bathroom ceiling", "p7.hazard#0": "None", "p7.appliance#1": "Heat lamp", "p7.location#1": "Ensuite", "p7.hazard#1": "Clearance",
  "p7.actions": "Keep 50 mm clear", "p7.effective": "Yes", "p7.otherHazard#0": "Rotten joist", "p7.otherAction#0": "Replace joist",
  b1: B1_OPTIONS[1], b2: [B2_OPTIONS[0], B2_OPTIONS[2]], "b2.other": "n/a",
  "b3.licence": "A 1", "b3.name": "Sam Spark", "b3.recName": "Spark", "b3.recNo": "REC 1", "b3.phone": "0400", "b3.declaration": true,
  "c.licence": "A 1", "c.name": "Sam Spark", "c.recName": "Spark", "c.recNo": "REC 1", "c.phone": "0400",
  "c.tick1": true, "c.tick2": true, "c.tick3": true, "c.tick4": true, "c.tick5": true, "c.tick6": true, "c.tick7": true,
  "c.signature": electronicSignature("Sam Spark", "2026-11-03"), "c.completionDate": "2026-11-03", "c.coes": "CES 1", "c.certDate": "2026-11-03",
  "o.tick1": true, "o.tick2": true, "o.tick3": true, "o.tick4": true, "o.signature": electronicSignature("Helen Nguyen", "2026-11-04"), "o.name": "Helen Nguyen", "o.date": "2026-11-04",
};

describe("PIESA Word form: every box/cell by its position in the official form", () => {
  const r = fillOfficialDocxXml(PIESA, "piesa", full);
  const f = rawFields(r.xml);
  test("161 fields, every official item has its own field (only the derived main-switch line has none)", () => {
    expect(f.length).toBe(161);
    const l = officialDocxLayout(PIESA, "piesa");
    expect(l.unplaced).toEqual([]);
    expect(l.notOnForm.sort()).toEqual(["lifeSupportAttachment", "p2.switch"]);
    expect(WORD_FORM_NO_FIELD.piesa).toEqual(["p2.switch"]);
    expect(r.missed).toEqual([]);
    expect(r.notOnForm).toEqual(["p2.switch"]);
  });
  test('"No" boxes are ticked (life support, mains, RCDs, Part 5)', () => {
    expect([f[3]!.checked, f[4]!.checked]).toEqual([false, true]); // life support: No
    expect([f[7]!.checked, f[8]!.checked]).toEqual([false, true]); // mains marked: No
    expect([f[17]!.checked, f[18]!.checked, f[19]!.checked, f[20]!.checked]).toEqual([false, true, false, true]); // RCD present / tested: No
    expect([f[46]!.checked, f[47]!.checked]).toEqual([false, true]); // non-TPS: No
  });
  test("main switch: each sub-item on its own row; the overall line is not written onto a sub-row", () => {
    expect([f[9]!.checked, f[10]!.checked]).toEqual([true, false]); // accessible: Yes
    expect([f[11]!.checked, f[12]!.checked]).toEqual([false, true]); // isolates: No
    expect([f[13]!.checked, f[14]!.checked]).toEqual([false, true]); // secured: No
  });
  test("N/A box (p4.tps)", () => expect([f[37]!.checked, f[38]!.checked, f[39]!.checked]).toEqual([false, false, true]));
  test("B1 (one option) and B2 (two options) boxes are ticked", () => {
    expect([122, 123, 124].map((i) => f[i]!.checked)).toEqual([false, true, false]);
    expect([125, 126, 127, 128, 129, 130].map((i) => f[i]!.checked)).toEqual([true, false, true, false, false, false]);
  });
  test("Section C declaration (w:checked=\"0\" in the original) shows ticked; all seven C ticks + B3 + four owner ticks", () => {
    expect(PIESA).toContain('<w:checked w:val="0"/>');
    expect([137, 143, 144, 145, 146, 147, 148, 149, 154, 155, 156, 157].every((i) => f[i]!.checked)).toBe(true);
    expect(checkedIdx(r.xml).length).toBe(39); // 24 Yes/No + 1 B1 + 2 B2 + 12 declarations
  });
  test("Part 7 table: Appliance / Location / Hazard each in its own cell, row by row; other-hazard table too", () => {
    expect([61, 62, 63, 64, 65, 66].map((i) => f[i]!.text)).toEqual(["Exhaust fan", "Bathroom ceiling", "None", "Heat lamp", "Ensuite", "Clearance"]);
    expect(f[67]!.text).toBe("");
    expect([f[91]!.text, f[94]!.text, f[95]!.text]).toEqual(["Keep 50 mm clear", "Rotten joist", "Replace joist"]);
  });
  test("text fields: dates DD/MM/YYYY, & escaped, $ patterns kept literally, signatures typed", () => {
    expect(f[0]!.text).toBe("HV-1");
    expect(f[1]!.text).toBe("1 A St &amp; Co, Bentleigh VIC 3204 $&amp; $1");
    expect(f[2]!.text).toBe("27/10/2026");
    expect(f[150]!.text).toBe("Sam Spark (signed electronically on 03/11/2026)");
    expect(f[158]!.text).toBe("Helen Nguyen (signed electronically on 04/11/2026)");
    expect([f[159]!.text, f[160]!.text]).toEqual(["Helen Nguyen", "04/11/2026"]);
    expect(f[131]!.text).toBe("n/a"); // b2.other sits under "Other (indicate below):"
  });
  test("valid Word XML: no run inside a run, tags balanced, xmllint clean where installed", () => {
    expect(r.xml).not.toMatch(/<w:r><w:r>/);
    expect(xmlProblems(r.xml)).toEqual([]);
    expect(xmlProblems("<a><w:r><w:r></w:r></w:r></a>")).toContain("<w:r> nested inside <w:r> at 8");
    expect(xmllintOk(r.xml) ?? true).toBe(true);
  });
  test("the read-back equals the answers for every placed item", () => {
    const shown = readOfficialDocx(r.xml, "piesa", PIESA);
    for (const [id, v] of Object.entries(shown)) {
      const want = full[id];
      if (want == null) { expect(v === null || v === false).toBe(true); continue; }
      if (typeof want === "string" && /^\d{4}-\d{2}-\d{2}$/.test(want)) expect(v).toBe(`${want.slice(8)}/${want.slice(5, 7)}/${want.slice(0, 4)}`);
      else expect(v).toEqual(want);
    }
  });
  test("a blank answer leaves the form exactly as it was", () => expect(fillOfficialDocxXml(PIESA, "piesa", {}).xml).toBe(PIESA));
  test("an unknown B2 option is reported missed, never half-ticked", () => {
    const x = fillOfficialDocxXml(PIESA, "piesa", { b2: ["Paint the ceiling"] });
    expect(x.missed).toEqual(["b2"]);
    expect(checkedIdx(x.xml)).toEqual([]);
  });
});

describe("PIISA Word form (approved, same filler)", () => {
  const a: OfficialAnswers = {
    lifeSupport: "No", "p1.powerInformed": "Yes", "p5.electricianPresent": "N/A", "p6.present": "Yes", "p6.height": "60", "p6.rValue": "1.5", "p6.treatment": ["Topped Up"],
    "p2.addName#0": "Ruby Tran", "p2.addEec#0": "EEC-2", "p8.declaration": true, "p8.signature": electronicSignature("Daniel Moore", "2026-11-12"),
  };
  const r = fillOfficialDocxXml(PIISA, "piisa", a);
  const f = rawFields(r.xml);
  test("No / N/A / Topped Up / declaration boxes, height vs R-value, crew row, signature", () => {
    expect(officialDocxLayout(PIISA, "piisa").unplaced).toEqual([]);
    expect(r.missed).toEqual([]);
    expect([f[4]!.checked, f[5]!.checked, f[6]!.checked, f[7]!.checked]).toEqual([true, false, false, true]);
    expect([f[35]!.checked, f[36]!.checked, f[37]!.checked]).toEqual([false, false, true]);
    expect([f[57]!.checked, f[58]!.checked, f[64]!.checked]).toEqual([false, true, true]);
    expect([f[55]!.text, f[56]!.text, f[15]!.text, f[16]!.text, f[65]!.text]).toEqual(["60", "1.5", "Ruby Tran", "EEC-2", "Daniel Moore (signed electronically on 12/11/2026)"]);
    expect(xmlProblems(r.xml)).toEqual([]);
  });
  test("expandPiisa writes the typed installer signature; nothing is excluded from the PIISA expansion any more", () => {
    const e = expandPiisa({ installerSignature: "1 photo", "p8.name": "Daniel Moore", "p8.date": "2026-11-12" }, { lifeSupportDeclared: null, today: "2026-11-12" });
    expect(e.answers["p8.signature"]).toBe("Daniel Moore (signed electronically on 12/11/2026)");
    expect(expansionCoverage("piisa").excluded).toEqual([]);
  });
});

// ---------- signatures + owner declarations (points 3 and 4) ----------
const L = (id: string) => SHORT_PIESA_FIELDS.find((f) => f.id === id)!.label;
const A4_REPAIRS = [
  { label: L("jobRef"), value: "HV-2" }, { label: L("address"), value: "7 Banksia Court, Frankston VIC 3199" },
  { label: L("inspectionDate"), value: "2026-10-28" }, { label: L("lifeSupportPresent"), value: "No" }, { label: L("mainsSafe"), value: "Yes" },
  { label: L("solarPresent"), value: "No" }, { label: L("ceilingSafe"), value: "Yes" }, { label: L("downlightsPresent"), value: "Yes" }, { label: L("downlightCount"), value: "4" },
  { label: L("downlightsNonIc"), value: "Yes" }, { label: L("appliancesPresent"), value: "No" }, { label: L("rectificationNeeded"), value: "Yes" },
  { label: L("rectificationWork"), value: B2_OPTIONS[0] }, { label: L("b3.name"), value: "Sam Spark" }, { label: L("b3.licence"), value: "A 1" },
  { label: L("b3.recName"), value: "Spark" }, { label: L("b3.recNo"), value: "REC 1" }, { label: L("b3.phone"), value: "0400" },
  { label: L("b3.declaration"), value: "Yes" }, { label: L("electricianSignature"), value: "1 photo" },
];
const A5: FixesDayRead = {
  jobNumber: "HV-2", electricianName: "Sam Spark", licence: "A 1", recName: "Spark", recNo: "REC 1", phone: "0400", done: "Yes", notDone: null,
  coesNumber: "CES 9", certDate: "2026-11-03", coesFiles: [{ mediaId: "c", capturedAt: null, lat: null, lng: null }],
  workPhotos: [{ mediaId: "w", capturedAt: "2026-11-03T10:00:00+11:00", lat: -38, lng: 145 }],
  signature: { present: true, name: "Samuel Spark", signedAt: "2026-11-03T23:30:00Z", mediaId: "s" },
} as FixesDayRead;
const plan = { kind: "done" as const, coesNumber: "CES 9", certDate: "2026-11-03", coesFiles: A5.coesFiles, workPhotos: A5.workPhotos, signedAt: A5.signature.signedAt, signerName: A5.signature.name };
const afterFixes = shortAnswersFromEntries("piesa", mergeFixesIntoPiesaSnapshot(A4_REPAIRS, A5, plan));

describe("typed electronic signatures (point 3)", () => {
  test("the A4 merge stores the signer and the signature's Melbourne date", () => {
    expect(afterFixes["fixesSignedBy"]).toBe("Samuel Spark");
    expect(afterFixes["fixesSignedOn"]).toBe("2026-11-04"); // 23:30Z = 10:30 next morning in Melbourne
  });
  test("Section C and the owner block carry 'Name (signed electronically on DD/MM/YYYY)'; no REQ:*.signature any more", () => {
    const e = expandPiesa(afterFixes, { lifeSupportDeclared: null, today: "2026-11-03", ownerConfirmation: { name: "Robert Ellis", date: "2026-10-28" }, ownerFixesConfirmation: { name: "Robert Ellis", date: "2026-11-05" } });
    expect(e.answers["c.signature"]).toBe("Samuel Spark (signed electronically on 04/11/2026)");
    expect(e.answers["o.signature"]).toBe("Robert Ellis (signed electronically on 05/11/2026)");
    expect(isElectronicSignature(e.answers["c.signature"])).toBe(true);
    const rules = evaluatePiesa(e.answers).blockers.map((b) => b.rule);
    expect(rules).not.toContain("REQ:c.signature");
    expect(rules).not.toContain("REQ:o.signature");
  });
  test("no A3/A4 signature → no Section C signature (flagged), never invented", () => {
    const { electricianSignature: _drop, ...noSig } = shortAnswersFromEntries("piesa", A4_REPAIRS);
    const e = expandPiesa({ ...noSig, rectificationComplete: "Yes", certDate: "2026-10-28", coesNumber: "CES 1" }, { lifeSupportDeclared: null, today: "2026-10-28" });
    expect(e.answers["c.signature"]).toBeUndefined();
    expect(e.flagged).toContain("Section C: electrician signature missing.");
  });
});

describe("owner declarations: only what is true when the owner confirms (point 4, decision 330)", () => {
  const initial = { name: "Robert Ellis", date: "2026-10-28" };
  test("no repairs needed → all four ticked, o.date = the day the owner confirmed", () => {
    const short = shortAnswersFromEntries("piesa", A4_REPAIRS.map((e) => (e.label === L("rectificationNeeded") ? { ...e, value: "No" } : e)).filter((e) => e.label !== L("rectificationWork")));
    const e = expandPiesa(short, { lifeSupportDeclared: null, today: "2026-10-28", ownerConfirmation: initial });
    expect([1, 2, 3, 4].map((i) => e.answers[`o.tick${i}`])).toEqual([true, true, true, true]);
    expect([e.answers["o.name"], e.answers["o.date"]]).toEqual(["Robert Ellis", "2026-10-28"]);
    expect(e.flagged.some((f) => f.startsWith(OWNER_FIXES_NOT_CONFIRMED_FLAG))).toBe(false);
  });
  test("fixes on a later visit, owner confirmed only before them → declaration 3 blank + flagged, others ticked", () => {
    const e = expandPiesa(afterFixes, { lifeSupportDeclared: null, today: "2026-11-03", ownerConfirmation: initial });
    expect([1, 2, 3, 4].map((i) => e.answers[`o.tick${i}`] ?? null)).toEqual([true, true, null, true]);
    expect(e.flagged).toContain(`${OWNER_FIXES_NOT_CONFIRMED_FLAG}.`);
    expect(e.answers["o.date"]).toBe("2026-10-28");
    // the copies are not held: only o.tick3 is reported, nothing else
    expect(evaluatePiesa(e.answers).blockers.map((b) => b.rule)).toEqual(["REQ:o.tick3"]);
  });
  test("…and once the owner confirms the fixes (decision 330): declaration 3 ticked, o.name/o.date from that confirmation", () => {
    const e = expandPiesa(afterFixes, { lifeSupportDeclared: null, today: "2026-11-03", ownerConfirmation: initial, ownerFixesConfirmation: { name: "Robert J Ellis", date: "2026-11-05" } });
    expect([1, 2, 3, 4].map((i) => e.answers[`o.tick${i}`])).toEqual([true, true, true, true]);
    expect([e.answers["o.name"], e.answers["o.date"]]).toEqual(["Robert J Ellis", "2026-11-05"]);
    expect(evaluatePiesa(e.answers).blockers).toEqual([]);
  });
  test("same-visit fixes: owner confirmed on/after the certification date → declaration 3 ticked", () => {
    const short = { ...shortAnswersFromEntries("piesa", A4_REPAIRS), rectificationComplete: "Yes", coesNumber: "CES 1", certDate: "2026-10-28" };
    const e = expandPiesa(short, { lifeSupportDeclared: null, today: "2026-10-28", ownerConfirmation: { name: "Robert Ellis", date: "2026-10-28" } });
    expect(e.answers["o.tick3"]).toBe(true);
  });
  test("no owner confirmation at all → whole owner block blank and flagged", () => {
    const e = expandPiesa(afterFixes, { lifeSupportDeclared: null, today: "2026-11-03" });
    expect(["o.tick1", "o.tick2", "o.tick3", "o.tick4", "o.name", "o.date", "o.signature"].map((k) => e.answers[k] ?? null)).toEqual([null, null, null, null, null, null, null]);
  });
});

describe("text PDF (point 5)", () => {
  test("characters the font can draw are kept; the rest map to the closest plain text", () => {
    const winAnsi = new Set([..."’“”–—•²"].map((c) => c.codePointAt(0)!));
    expect(pdfSafeText("don’t “Yes” – ✓ 2²", winAnsi)).toBe("don’t “Yes” – [x] 2²");
    expect(pdfSafeText("don’t “Yes” – ✓ ≥")).toBe(`don't "Yes" - [x] >=`);
  });
  test("no doubled colons, empty table rows skipped, answered rows numbered", () => {
    const snap = buildSignedSnapshot({ key: "piesa", answers: full, signer: { userId: "u", name: "Sam", role: "electrician" }, enteredDate: "2026-11-03", serverTimestamp: "2026-11-03T00:00:00Z", jobFacts: {}, acknowledgementIds: [], signature: "s" });
    const text = officialPiesaPdfText(snap);
    expect(text).not.toMatch(/::/);
    expect(text).toContain("Licence no: A 1");
    expect(text).toContain("Appliance (row 2): Heat lamp");
    expect(text).not.toContain("(row 3)");
    expect(text.split("\n").filter((l) => /^Other electrical or other hazards/.test(l))).toEqual(["Other electrical or other hazards identified in the ceiling space (e.g. rotten joist) (row 1): Rotten joist"]);
  });
});
