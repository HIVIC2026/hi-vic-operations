// Decision 336 (Jo 25 Oct 2026): A) the electrician's / lead installer's ACTUAL Mitti signature images in the official Word
// forms (inline picture parts, relationships, content types; "Signed in Mitti on DD/MM/YYYY"), typed-name fallback + flag;
// B) exact A3 hazard rows (type / what / where / problem / action) mapped row by row into PIESA Part 7.
// Decision 338: "Does an electrician need to be on site at the start of the install?" replaces the on-site tick (old tick still
// read), the tick list is not Required, both empty = one flag; the A5 Install day Q29 prefill follows the new question.
import { describe, expect, test } from "bun:test";
import { unzipSync } from "fflate";
import piesaDocx from "../src/lib/official-docx-piesa.data";
import piisaDocx from "../src/lib/official-docx-piisa.data";
import { fillOfficialDocxParts, imagePixelSize, readOfficialDocx, xmlProblems } from "../src/lib/official-docx.core";
import { B1_OPTIONS, electronicSignature, evaluatePiesa } from "../src/lib/official-forms.core";
import { SAFE_AS_IT_IS, expandPiesa } from "../src/lib/official-expand.core";
import {
  APPLIANCE_PRESENT_LABEL, APPLIANCE_PRESENT_LEGACY_LABEL, APPLIANCE_Q, APPLIANCE_WHAT_WHERE_LEGACY_LABEL, FIXES_ONSITE_OPTION, FIXES_WORK_LABEL,
  NO_REPAIR_WORK_FLAG, ONSITE_START_LABEL, RECTIFICATION_OUTCOMES, SHORT_PIESA_FIELDS, applianceRows, onsiteStartTicked, repairWorkBesidesOnsite,
  shortAnswersFromEntries,
} from "../src/lib/official-short.core";
import { piesaHazardsListed } from "../src/lib/piesa-evidence.core";
import { attendanceRequired } from "../src/lib/install-attendance.core";
import { onsiteStartOnly } from "../src/lib/fixes-times.core";
import { electricianAtStartPrefill, installDayPrefillItems, INSTALL_DAY_Q } from "../src/lib/install-day.core";
import { choiceOption } from "../src/lib/mitti.core";
import { officialPiesaPdfText, pdfImageMarker } from "../src/lib/electrician-piesa-copy.core";
import { buildSignedSnapshot } from "../src/lib/official-forms.core";
import { sampleSignaturePng } from "../scripts/sample-signature-png";

const pkg = (uri: string) => unzipSync(new Uint8Array(Buffer.from(uri.replace(/^data:[^,]*,/, ""), "base64")));
const PIESA = pkg(piesaDocx);
const PIISA = pkg(piisaDocx);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const PNG = sampleSignaturePng("test signature");
const NEEDED = "Is any electrical repair work needed before insulation can be installed?";
const L = (id: string) => SHORT_PIESA_FIELDS.find((f) => f.id === id)!.label;
const ctx = { lifeSupportDeclared: "no" as const, today: "2026-11-03", ownerConfirmation: { name: "Robert Ellis", date: "2026-10-28" } };

/** A minimal JPEG (SOI + SOF0 with 40×20 + EOI) — enough for the size reader and the package wiring. */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x14, 0x00, 0x28, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9]);

describe("decision 336 A: signature pictures in the official Word forms", () => {
  test("image sizes are read from PNG / JPEG headers; anything else is refused", () => {
    expect(imagePixelSize(PNG)).toEqual({ w: 360, h: 110, type: "png" });
    expect(imagePixelSize(JPEG)).toEqual({ w: 40, h: 20, type: "jpeg" });
    expect(imagePixelSize(new TextEncoder().encode("not an image"))).toBeNull();
  });

  test("PIESA: B3 (A3) and Section C (A4) pictures — parts present, relationships referenced, content types, XML well-formed", () => {
    const answers = { "b3.name": "Sam Spark", "b3.declaration": true, "c.signature": electronicSignature("Sam Spark", "2026-11-03") };
    const r = fillOfficialDocxParts(PIESA, "piesa", answers, {
      "b3.signature": { images: [{ bytes: PNG, contentType: "image/png", signedOn: "2026-10-28" }] },
      "c.signature": { images: [{ bytes: JPEG, contentType: "image/jpeg", signedOn: "2026-11-03" }] },
    });
    expect(xmlProblems(r.xml)).toEqual([]);
    expect(r.notEmbedded).toEqual([]);
    expect(r.embedded.map((e) => e.slot)).toEqual(["b3.signature", "c.signature"]);
    const rels = dec(r.parts["word/_rels/document.xml.rels"]!);
    const types = dec(r.parts["[Content_Types].xml"]!);
    expect(xmlProblems(rels)).toEqual([]);
    expect(xmlProblems(types)).toEqual([]);
    for (const e of r.embedded) {
      expect(r.parts[e.part]).toBeDefined();
      expect(rels).toContain(`Id="${e.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${e.part.replace("word/", "")}"`);
      expect(r.xml.split(`r:embed="${e.rId}"`).length - 1).toBe(1);
    }
    expect(r.parts["word/media/hiv-signature-1.png"]).toEqual(PNG);
    expect(r.parts["word/media/hiv-signature-2.jpeg"]).toEqual(JPEG);
    expect(types).toContain('<Default Extension="jpeg" ContentType="image/jpeg"/>');
    expect(types.match(/Extension="png"/g)?.length).toBe(1); // already declared by the form — not duplicated
    // docPr ids are unique in the document.
    const ids = [...r.xml.matchAll(/<wp:docPr id="(\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    // The B3 picture sits straight after the B3 declaration with its caption; the Section C box shows the caption as its text.
    const decl = r.xml.indexOf("I declare that all information contained in and attached to this form is correct");
    const b3pic = r.xml.indexOf('r:embed="rIdHivSignature1"');
    const sectionC = r.xml.indexOf("Section C – Completed Pre-Installation Electrical Safety Assessment");
    expect(decl).toBeGreaterThan(0);
    expect(b3pic).toBeGreaterThan(decl);
    expect(b3pic).toBeLessThan(sectionC);
    expect(r.xml.indexOf("Signed in Mitti on 28/10/2026")).toBeGreaterThan(b3pic);
    const shown = readOfficialDocx(r.xml, "piesa", dec(PIESA["word/document.xml"]!));
    expect(shown["c.signature"]).toBe("Signed in Mitti on 03/11/2026");
    expect(r.xml.indexOf('r:embed="rIdHivSignature2"')).toBeGreaterThan(sectionC);
  });

  test("no usable image: nothing embedded, the box keeps the typed name, B3 gets the typed fallback line, parts untouched", () => {
    const answers = { "b3.name": "Sam Spark", "b3.declaration": true, "c.signature": electronicSignature("Sam Spark", "2026-11-03") };
    const r = fillOfficialDocxParts(PIESA, "piesa", answers, {
      "b3.signature": { images: [], fallbackText: "Sam Spark (signed in Mitti on 28/10/2026; electrician signature image not available)" },
      "c.signature": { images: [{ bytes: new TextEncoder().encode("garbage"), contentType: "image/png", signedOn: "2026-11-03" }] },
    });
    expect(r.embedded).toEqual([]);
    expect(r.notEmbedded).toEqual(["b3.signature", "c.signature"]);
    expect(r.parts["word/_rels/document.xml.rels"]).toBe(PIESA["word/_rels/document.xml.rels"]);
    expect(r.xml).not.toContain("<w:drawing><wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\"><wp:extent cx=\"1");
    expect(r.xml).toContain("electrician signature image not available");
    expect(readOfficialDocx(r.xml, "piesa", dec(PIESA["word/document.xml"]!))["c.signature"]).toBe("Sam Spark (signed electronically on 03/11/2026)");
    expect(xmlProblems(r.xml)).toEqual([]);
  });

  test("PIISA: the A5 lead installer picture in the Part 8 box", () => {
    const r = fillOfficialDocxParts(PIISA, "piisa", { "p8.name": "Daniel Moore", "p8.date": "2026-11-12", "p8.signature": electronicSignature("Daniel Moore", "2026-11-12") }, { "p8.signature": { images: [{ bytes: PNG, contentType: "image/png", signedOn: "2026-11-12" }] } });
    expect(xmlProblems(r.xml)).toEqual([]);
    expect(r.embedded.map((e) => e.slot)).toEqual(["p8.signature"]);
    expect(dec(r.parts["word/_rels/document.xml.rels"]!)).toContain('Id="rIdHivSignature1"');
    expect(readOfficialDocx(r.xml, "piisa", dec(PIISA["word/document.xml"]!))["p8.signature"]).toBe("Signed in Mitti on 12/11/2026");
    expect(readOfficialDocx(r.xml, "piisa", dec(PIISA["word/document.xml"]!))["p8.name"]).toBe("Daniel Moore");
  });

  test("the PDF text marks where the pictures go (B3 after the declaration, Section C after its signature)", () => {
    const snap = buildSignedSnapshot({ key: "piesa", answers: { "b3.declaration": true, "c.signature": "Sam Spark (signed electronically on 03/11/2026)" }, signer: { userId: "u", name: "Sam Spark", role: "electrician" }, enteredDate: "2026-11-03", serverTimestamp: "2026-11-03T00:00:00Z", jobFacts: {}, acknowledgementIds: [], signature: "t" });
    const text = officialPiesaPdfText(snap, { "b3.signature": { signedOn: "2026-10-28" }, "c.signature": { signedOn: "2026-11-03" } });
    const lines = text.split("\n");
    const b3 = lines.indexOf(pdfImageMarker("b3.signature"));
    expect(lines[b3 + 1]).toBe("Signed in Mitti on 28/10/2026");
    expect(lines[b3 - 2]).toContain("I declare that all information");
    expect(lines[lines.indexOf(pdfImageMarker("c.signature")) + 1]).toBe("Signed in Mitti on 03/11/2026");
    expect(officialPiesaPdfText(snap)).not.toContain("[[image:");
  });
});

// Two rows: a SAFE exhaust fan then an UNSAFE flue, then an Other hazard — entries in form order as Mitti returns them.
const hazardEntries = [
  { label: APPLIANCE_PRESENT_LABEL, value: "Yes" },
  { label: APPLIANCE_Q.type, value: "Exhaust fan" }, { label: APPLIANCE_Q.what, value: "Bathroom exhaust fan" }, { label: APPLIANCE_Q.where, value: "Above the bathroom" }, { label: APPLIANCE_Q.photo, value: "1 photo" }, { label: APPLIANCE_Q.safe, value: "Yes" },
  { label: APPLIANCE_Q.type, value: "Flue" }, { label: APPLIANCE_Q.what, value: "Gas heater flue" }, { label: APPLIANCE_Q.where, value: "Above the lounge" }, { label: APPLIANCE_Q.photo, value: "1 photo" }, { label: APPLIANCE_Q.safe, value: "No" },
  { label: APPLIANCE_Q.problem, value: "No flue guard" }, { label: APPLIANCE_Q.action, value: "Fit a flue guard" },
  { label: APPLIANCE_Q.type, value: "Other hazard" }, { label: APPLIANCE_Q.what, value: "Rotten joist" }, { label: APPLIANCE_Q.where, value: "Hallway" }, { label: APPLIANCE_Q.photo, value: "1 photo" }, { label: APPLIANCE_Q.safe, value: "No" },
  { label: APPLIANCE_Q.problem, value: "Soft and cracked" }, { label: APPLIANCE_Q.action, value: "Replace the joist" },
];

describe("decision 336 B: exact hazard rows → Part 7", () => {
  test("the A3 wording, in order, as given to Jo", () => {
    expect(APPLIANCE_PRESENT_LABEL).toBe("Are there any appliances, exhaust fans, flues or other hazards in the ceiling space?");
    expect(Object.values(APPLIANCE_Q)).toEqual(["What type is it?", "What is it?", "Where is it?", "Photo of it", "Can insulation be safely installed around it as it is?", "What is the problem?", "What needs to be done to make it safe?"]);
    const f = (id: string) => SHORT_PIESA_FIELDS.find((x) => x.id === id)!;
    expect(f("applianceType")).toMatchObject({ type: "choice", required: true, choices: ["Appliance", "Exhaust fan", "Flue", "Other hazard"] });
    expect(f("applianceProblem")).toMatchObject({ required: true, when: "applianceSafe = No" });
    expect(f("applianceAction")).toMatchObject({ required: true, when: "applianceSafe = No" });
    expect(f("appliancesPresent").aliases).toEqual([APPLIANCE_PRESENT_LEGACY_LABEL]);
    const ids = SHORT_PIESA_FIELDS.map((x) => x.id);
    expect(["applianceType", "applianceWhat", "applianceWhere", "appliancePhoto", "applianceSafe", "applianceProblem", "applianceAction"].map((i) => ids.indexOf(i))).toEqual([...["applianceType", "applianceWhat", "applianceWhere", "appliancePhoto", "applianceSafe", "applianceProblem", "applianceAction"].map((i) => ids.indexOf(i))].sort((a, b) => a - b));
  });

  test("rows are numbered by row: the problem of the 2nd (unsafe) row never lands on the 1st (safe) one", () => {
    const short = shortAnswersFromEntries("piesa", hazardEntries);
    expect(applianceRows(short)).toEqual([
      { type: "Exhaust fan", what: "Bathroom exhaust fan", where: "Above the bathroom", safe: "Yes", photo: true, problem: "", action: "", legacy: false },
      { type: "Flue", what: "Gas heater flue", where: "Above the lounge", safe: "No", photo: true, problem: "No flue guard", action: "Fit a flue guard", legacy: false },
      { type: "Other hazard", what: "Rotten joist", where: "Hallway", safe: "No", photo: true, problem: "Soft and cracked", action: "Replace the joist", legacy: false },
    ]);
    expect(piesaHazardsListed(short as never)).toEqual(["Flue needs work: Gas heater flue (Above the lounge)", "Other hazard needs work: Rotten joist (Hallway)"]);
  });

  test("expandPiesa: flues/appliances questions, the table, the actions line, the other-hazards table", () => {
    const { answers, flagged } = expandPiesa(shortAnswersFromEntries("piesa", hazardEntries), ctx);
    expect(answers["p7.appliances"]).toBe("No");
    expect(answers["p7.flues"]).toBe("Yes");
    expect([answers["p7.appliance#0"], answers["p7.location#0"], answers["p7.hazard#0"]]).toEqual(["Bathroom exhaust fan", "Above the bathroom", SAFE_AS_IT_IS]);
    expect([answers["p7.appliance#1"], answers["p7.location#1"], answers["p7.hazard#1"]]).toEqual(["Gas heater flue", "Above the lounge", "No flue guard"]);
    expect(answers["p7.appliance#2"]).toBeUndefined();
    expect(answers["p7.actions"]).toBe("Gas heater flue: Fit a flue guard");
    expect(answers["p7.otherHazard#0"]).toBe("Rotten joist (Hallway): Soft and cracked");
    expect(answers["p7.otherAction#0"]).toBe("Replace the joist");
    expect(answers["p7.effective"]).toBeUndefined();
    expect(flagged.some((f) => f.includes("effective"))).toBe(true);
    // Once the repair work is recorded complete (A4), "effective" = Yes and Part 7 passes the printed rules.
    const done = expandPiesa({ ...shortAnswersFromEntries("piesa", hazardEntries), rectificationComplete: "Yes" }, ctx).answers;
    expect(done["p7.effective"]).toBe("Yes");
    expect(evaluatePiesa(done).blockers.filter((b) => b.rule.startsWith("P7"))).toEqual([]);
  });

  test("the Part 7 answers land in the right cells of the Word form", () => {
    const { answers } = expandPiesa(shortAnswersFromEntries("piesa", hazardEntries), ctx);
    const r = fillOfficialDocxParts(PIESA, "piesa", answers);
    expect(xmlProblems(r.xml)).toEqual([]);
    const shown = readOfficialDocx(r.xml, "piesa", dec(PIESA["word/document.xml"]!));
    for (const id of ["p7.appliance#0", "p7.location#0", "p7.hazard#0", "p7.appliance#1", "p7.location#1", "p7.hazard#1", "p7.actions", "p7.otherHazard#0", "p7.otherAction#0", "p7.flues", "p7.appliances"]) expect(shown[id], id).toBe(answers[id] as string);
  });

  test("an unsafe row without its problem / action is flagged, never filled with standard wording", () => {
    const short = shortAnswersFromEntries("piesa", hazardEntries.filter((e) => e.value !== "No flue guard"));
    const { answers, flagged } = expandPiesa(short, ctx);
    expect(answers["p7.hazard#1"]).toBeUndefined();
    expect(flagged).toContain('Hazard row 2: "What is the problem?" not answered.');
  });

  test("old forms (decision 295 wording) keep the old standard wording", () => {
    const short = shortAnswersFromEntries("piesa", [
      { label: APPLIANCE_PRESENT_LEGACY_LABEL, value: "Yes" },
      { label: APPLIANCE_WHAT_WHERE_LEGACY_LABEL, value: "Gas flue near the manhole" }, { label: APPLIANCE_Q.photo, value: "1" }, { label: APPLIANCE_Q.safe, value: "No" },
    ]);
    const { answers } = expandPiesa(short, ctx);
    expect(answers["p7.appliances"]).toBe("Yes");
    expect(answers["p7.flues"]).toBe("Yes");
    expect(answers["p7.location#0"]).toBe("Gas flue near the manhole");
    expect(answers["p7.hazard#0"]).toBe("Needs work or clearance before insulation (see Part B2 repair work)");
    expect(answers["p7.actions"]).toBe("Work or clearance required before insulation — listed under Part B2 repair work");
  });
});

describe("decision 338: on site at the start is its own question", () => {
  const sync = (extra: { label: string; value: string }[]) => shortAnswersFromEntries("piesa", [{ label: NEEDED, value: "Yes" }, ...extra]);
  test("the question, placed after Describe the other work and before the price; the tick list is not Required", () => {
    expect(ONSITE_START_LABEL).toBe("Does an electrician need to be on site at the start of the install?");
    const ids = SHORT_PIESA_FIELDS.map((f) => f.id);
    expect(ids.indexOf("onsiteStartNeeded")).toBe(ids.indexOf("fixesOtherDetail") + 1);
    expect(ids.indexOf("fixesPriceIncGst")).toBe(ids.indexOf("onsiteStartNeeded") + 1);
    expect(SHORT_PIESA_FIELDS.find((f) => f.id === "fixesWork")).toMatchObject({ required: false });
    expect(SHORT_PIESA_FIELDS.find((f) => f.id === "fixesWork")!.choices).not.toContain(FIXES_ONSITE_OPTION);
  });
  test("Yes = exactly what the old tick meant (official third outcome, attendance, no fixes visit when nothing else)", () => {
    const short = sync([{ label: ONSITE_START_LABEL, value: "Yes" }]);
    expect(short["rectificationOutcome"]).toBe(RECTIFICATION_OUTCOMES[2]);
    expect(onsiteStartTicked(short)).toBe(true);
    expect(attendanceRequired(short)).toBe(true);
    expect(repairWorkBesidesOnsite(short)).toBe(false);
    expect(onsiteStartOnly(short)).toBe(true);
    const { answers, flagged } = expandPiesa(short, ctx);
    expect(answers["b1"]).toBe(B1_OPTIONS[2]);
    expect(flagged.some((f) => f.includes(NO_REPAIR_WORK_FLAG))).toBe(false);
    const mixed = sync([{ label: FIXES_WORK_LABEL, value: "Install RCD safety switches" }, { label: ONSITE_START_LABEL, value: "Yes" }]);
    expect(repairWorkBesidesOnsite(mixed)).toBe(true);
    expect(onsiteStartOnly(mixed)).toBe(false);
  });
  test("No = no attendance; the old tick on an old form still reads the same way", () => {
    const no = sync([{ label: FIXES_WORK_LABEL, value: "Install RCD safety switches" }, { label: ONSITE_START_LABEL, value: "No" }]);
    expect(no["rectificationOutcome"]).toBe(RECTIFICATION_OUTCOMES[1]);
    expect(onsiteStartTicked(no)).toBe(false);
    const legacy = sync([{ label: FIXES_WORK_LABEL, value: FIXES_ONSITE_OPTION }]);
    expect(legacy["rectificationOutcome"]).toBe(RECTIFICATION_OUTCOMES[2]);
    expect(onsiteStartOnly(legacy)).toBe(true);
  });
  test("repair needed with nothing ticked and no on-site attendance = one office flag", () => {
    const { flagged } = expandPiesa(sync([{ label: ONSITE_START_LABEL, value: "No" }]), ctx);
    expect(flagged).toContain(`Electrical fixes: ${NO_REPAIR_WORK_FLAG}.`);
    expect(NO_REPAIR_WORK_FLAG).toBe("No repair work ticked and no on-site attendance");
  });
  test("A5 Install day Q29 prefill follows the new A3 question (Yes → Yes, No → No), else the old tick / B1", () => {
    const yes = sync([{ label: ONSITE_START_LABEL, value: "Yes" }]);
    expect(electricianAtStartPrefill({ a4Short: yes, b1: null })).toBe(true);
    expect(electricianAtStartPrefill({ a4Short: sync([{ label: ONSITE_START_LABEL, value: "No" }]), b1: B1_OPTIONS[2] })).toBe(false);
    expect(electricianAtStartPrefill({ a4Short: sync([{ label: FIXES_WORK_LABEL, value: FIXES_ONSITE_OPTION }]), b1: null })).toBe(true);
    expect(electricianAtStartPrefill({ a4Short: null, b1: B1_OPTIONS[2] })).toBe(true);
    expect(electricianAtStartPrefill({ a4Short: null, b1: B1_OPTIONS[0] })).toBe(false);
    // …and lands on Q29 of the A5 template as "Yes".
    const ynSet = { id: "rs-yn", responses: [{ id: "o-yes", label: "Yes" }, { id: "o-no", label: "No" }] };
    const template = { template: { items: [{ id: "q29", item_id: "q29", label: INSTALL_DAY_Q.electricianNeeded, question: { response_set_id: "rs-yn" } }], response_sets: [ynSet] } };
    const items = installDayPrefillItems(template, { jobNumber: null, address: null, installDate: null, apName: null, businessName: null, leadName: null, leadCii: null, lifeSupport: null, solarPresent: null, electricianAtStart: electricianAtStartPrefill({ a4Short: yes, b1: null }) }, choiceOption);
    expect(items).toEqual([{ item_id: "q29", type: "question", responses: { selected: [{ id: "o-yes", label: "Yes" }] } }]);
  });
});
