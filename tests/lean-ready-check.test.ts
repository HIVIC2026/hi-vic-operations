// Decision 222 (Jo 24 Oct 2026): the LEAN Ready Check templates — reader changes (§6.4 of the live audit), the rewritten
// build sheet, and the ChatGPT build prompt that must carry every reader wording verbatim. Pure, run with `bun test`.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildPrefill, contactAnswersFromEntries, flatten, isRValueBand, parseAudit } from "../src/lib/mitti.core";
import { premisesTypeFromEntries, readyCheckStopReasons, STOP_NO_SAFE_ACCESS, STOP_R2 } from "../src/lib/ready-check-answers.core";
import { readyCheckCompletionChecks, readyCheckFactsFromEntries } from "../src/lib/ready-check-complete.core";
import { areasFromReadyCheckEntries } from "../src/lib/area-diagram.core";
import { rcAreasFromRecord, readyCheckPart6Answers, weightedDepthMm } from "../src/lib/piisa-a3.core";
import { evaluatePiisa } from "../src/lib/official-forms.core";
import { readAreas } from "../src/lib/ready-check-areas.core";
import { ELECTRICIAN_FIELDS, FORMS, PRICING_FIELDS, flattenDefinition, leanQuestionCount, mittiAiPrompt, validateTemplate, type FormField } from "../src/lib/mitti-forms.core";
import {
  ACCESS_OPTIONS, AREA_GROUP_BUTTON, ELECTRICIAN_OPTIONS, EXISTING_ACTION_OPTIONS, EXISTING_TYPE_OPTIONS, FAIL_REASON_OPTIONS, INCLUDED_OPTIONS, LEAN_ALIASES, LEAN_HELP, LEAN_Q,
  LEAN_REMOVE, LEAN_REMOVE_COPIES, MEASURED_HOW_OPTIONS, OUTCOME_OPTIONS, PREMISES_TYPE_OPTIONS, PRODUCT_OPTIONS, PROPERTY_TYPE_OPTIONS, R_ABOVE_LEGACY, R_VALUE_OPTIONS, ROOF_OPTIONS,
  A1_QUOTE_PAGE, A1_QUOTE_QUESTIONS, EXISTING_DEPTH_Q, isR2OrAbove, premisesTypeCode, premisesTypeOption,
} from "../src/lib/ready-check-lean.core";
import { APPROVED_PRODUCTS } from "../src/lib/insulation-product.core";

const e = (label: string, value: string | null) => ({ label, value });
const sel = (...labels: string[]) => ({ selected: labels.map((label) => ({ label })) });
let n = 0;
const it_ = (label: string, v: string | string[] | null, parent: string | null = null) =>
  ({ item_id: `i${n++}`, label, parent_id: parent, responses: v == null ? {} : Array.isArray(v) ? sel(...v) : { text: v } });
const media = (label: string, parent: string | null, count = 1) => ({ item_id: `m${n++}`, label, parent_id: parent, media: Array.from({ length: count }, (_, i) => ({ media_id: `p${i}` })) });

/** A LEAN A1 audit: two areas from the repeating group (own parent each), Length × Width, name, hazard note + photo. */
function leanAudit(over: { rValue?: string; access?: string; who?: string | null; hazardEvidence?: boolean; hazardNote?: boolean } = {}) {
  n = 0;
  const areaA = { item_id: "areaA", label: "", type: "dynamicfield" }, areaB = { item_id: "areaB", label: "", type: "dynamicfield" };
  return {
    audit_id: "audit_lean", template_id: "template_lean",
    header_items: [it_(LEAN_Q.jobNumber, "HV-3200"), it_(LEAN_Q.siteAddress, "1 Test St, Testville VIC 3000")],
    items: [
      it_(LEAN_Q.ownerPhone, "0400000000"), it_(LEAN_Q.ownerEmail, "jolowexo@hotmail.com"), it_(LEAN_Q.contactPermission, ["Yes"]),
      it_(LEAN_Q.lifeSupport, ["No"]), it_(LEAN_Q.builtLast5, ["No"]),
      ...(over.who === null ? [] : [it_(LEAN_Q.premisesType, [over.who ?? "Private rental – tenant lives here"])]),
      it_(LEAN_Q.roofType, ["Tiles"]), it_(LEAN_Q.access, [over.access ?? "Standard"]), media(LEAN_Q.accessPhoto, null),
      areaA,
      it_(LEAN_Q.areaName, "Main house", "areaA"), it_(LEAN_Q.lengthM, "12", "areaA"), it_(LEAN_Q.widthM, "8.5", "areaA"), it_(LEAN_Q.measuredHow, ["Laser measure"], "areaA"),
      it_(LEAN_Q.existing, ["Yes"], "areaA"), it_(LEAN_Q.existingType, ["Batts"], "areaA"), it_(LEAN_Q.rValue, [over.rValue ?? "Below R2.0"], "areaA"), media(LEAN_Q.depthPhoto, "areaA"),
      it_(LEAN_Q.existingAction, ["Remove"], "areaA"), it_(LEAN_Q.removeM2, "40", "areaA"), media(LEAN_Q.beforeVideo, "areaA"),
      it_(LEAN_Q.downlights, ["Yes"], "areaA"), it_(LEAN_Q.downlightsCount, "6", "areaA"), it_(LEAN_Q.issues, ["Yes"], "areaA"),
      ...(over.hazardNote === false ? [] : [it_(LEAN_Q.issueNote, "Exposed wiring near the manhole", "areaA")]),
      ...(over.hazardEvidence === false ? [] : [media(LEAN_Q.issuePhoto, "areaA")]),
      areaB,
      it_(LEAN_Q.areaName, "Garage", "areaB"), it_(LEAN_Q.lengthM, "6", "areaB"), it_(LEAN_Q.widthM, "4", "areaB"), it_(LEAN_Q.measuredHow, ["Tape measure"], "areaB"),
      it_(LEAN_Q.existing, ["No"], "areaB"), media(LEAN_Q.beforeVideo, "areaB"), it_(LEAN_Q.downlights, ["No"], "areaB"), it_(LEAN_Q.issues, ["No"], "areaB"),
      it_(LEAN_Q.product, ["Bradford Gold R6"]), it_(LEAN_Q.outcome, ["Yes - Ready Check passed"]),
      it_(LEAN_Q.included, ["Ceiling insulation - supply & install", "Removal of existing insulation"]), it_(LEAN_Q.totalPrice, "3200"), it_(LEAN_Q.electrician, ["Home Insulation Victoria electrician"]),
    ],
  };
}

describe("§6.4 reader: R-value option 'R2.0 or above' (R2.0 exactly = ineligible) alongside the old 'Above R2.0'", () => {
  const R = LEAN_Q.rValue;
  test("both wordings are the R2-or-above stop; Below R2.0 is not", () => {
    for (const v of ["R2.0 or above", "R2 or above", R_ABOVE_LEGACY, "above R2"]) {
      expect(isR2OrAbove(v)).toBe(true);
      expect(isRValueBand(v)).toBe(true);
      expect(readyCheckStopReasons([e(R, "Below R2.0"), e(R, v)])).toEqual([STOP_R2]);
    }
    expect(isR2OrAbove("Below R2.0")).toBe(false);
    expect(readyCheckStopReasons([e(R, "Below R2.0"), e(R, "Below R2.0")])).toEqual([]);
  });
  test("parseAudit: neither band raises a number error; the lean option holds the quote through the completion checks", () => {
    const p = parseAudit(leanAudit({ rValue: "R2.0 or above" }));
    expect(p.issues.some((i) => /not a valid number/.test(i))).toBe(false);
    expect(p.areas[0]!.rValueBand).toBe("at_or_above_r2");
    const facts = readyCheckFactsFromEntries(p.snapshot, { formComplete: true, electricianDecided: true, priceKnown: true });
    expect(facts.belowR2).toBe(false);
    expect(readyCheckCompletionChecks(facts).reasons).toContain(STOP_R2);
    expect(parseAudit(leanAudit()).areas[0]!.rValueBand).toBe("below_r2");
    expect(readyCheckFactsFromEntries(parseAudit(leanAudit()).snapshot, { formComplete: true, electricianDecided: true, priceKnown: true }).belowR2).toBe(true);
  });
});

describe("§6.4 reader: 'No safe access' = difficult + the new stop", () => {
  test("recognised (no 'not recognised' issue), recorded as difficult, and a hard stop with the exact office wording", () => {
    const p = parseAudit(leanAudit({ access: "No safe access" }));
    expect(p.patch.access_difficulty).toBe("difficult");
    expect(p.issues.some((i) => /not recognised/.test(i))).toBe(false);
    expect(p.issues.some((i) => /No safe access/.test(i))).toBe(true);
    expect(STOP_NO_SAFE_ACCESS).toBe("No safe access to the ceiling");
    expect(readyCheckStopReasons(p.snapshot)).toContain(STOP_NO_SAFE_ACCESS);
    expect(readyCheckStopReasons(p.snapshot, { ownerAnsweredOnWebsite: true })).toContain(STOP_NO_SAFE_ACCESS); // A2 too
    const r = readyCheckCompletionChecks(readyCheckFactsFromEntries(p.snapshot, { formComplete: true, electricianDecided: true, priceKnown: true }));
    expect(r.ready).toBe(false);
    expect(r.reasons).toContain(STOP_NO_SAFE_ACCESS);
  });
  test("Easy / Standard / Difficult unchanged", () => {
    expect(parseAudit(leanAudit({ access: "Difficult" })).patch.access_difficulty).toBe("difficult");
    expect(parseAudit(leanAudit({ access: "Standard" })).patch.access_difficulty).toBe("moderate");
    expect(parseAudit(leanAudit({ access: "Easy" })).patch.access_difficulty).toBe("easy");
    expect(readyCheckStopReasons(parseAudit(leanAudit({ access: "Difficult" })).snapshot)).toEqual([]);
  });
});

describe("§6.4 reader: area name + Length × Width per area, m² as the old-form fallback", () => {
  test("two repeating-group areas: names kept, m² = L × W, total summed (the garage is left out of it), downlights and removal per area", () => {
    const p = parseAudit(leanAudit());
    expect(p.patch.measured_area_m2).toBe(102);
    expect(p.patch.removal_required).toBe(true);
    expect(p.patch.removal_m2).toBe(40);
    expect(p.patch.downlights_qty).toBe(6);
    expect(p.areas.map((a) => [a.label, a.lengthM, a.widthM, a.areaM2, a.existing, a.removal, a.removalM2, a.downlights])).toEqual([
      ["Main house", 12, 8.5, 102, "present", "yes", 40, 6], ["Garage", 6, 4, 24, "none", null, null, null],
    ]);
  });
  test("the per-area record is areas.v1-shaped (readAreas) and carries install-day zone names (rcAreasFromRecord)", () => {
    const p = parseAudit(leanAudit());
    const areas = readAreas({ areas: p.areas });
    expect(areas.map((a) => [a.key, a.label, a.areaM2, a.existing, a.removal, a.removalM2])).toEqual([["mitti-1", "Main house", 102, "present", "yes", 40], ["mitti-2", "Garage", 24, "none", null, null]]);
    const zones = rcAreasFromRecord({ insulation_present: true, existing_r_value: null, zones: p.areas }, null);
    expect(zones.map((z) => [z.name, z.present, z.removal, z.downlights])).toEqual([["Main house", true, true, 6], ["Garage", false, null, null]]);
  });
  test("the diagram input reads the same name and dimensions", () => {
    const a = areasFromReadyCheckEntries(parseAudit(leanAudit()).snapshot);
    expect(a.map((x) => [x.name, x.lengthM, x.widthM, x.areaM2, x.productOption, x.rValue])).toEqual([["Main house", 12, 8.5, 102, "Bradford Gold R6", "R6.0"], ["Garage", 6, 4, 24, "Bradford Gold R6", "R6.0"]]);
  });
  test("old 22–24 Oct form: single m² entry with the A1 help-text label still reads; one unnamed area defaults to Main ceiling", () => {
    n = 0;
    const p = parseAudit({ audit_id: "a", items: [
      { item_id: "A", label: "── Ceiling Area 1 ──" },
      it_("Which part of the home does this ceiling area cover?\ne.g. Main house – bedrooms and hallway", "Rear extension", "A"),
      it_("Enter the measured ceiling area (m²)", "95.5", "A"), it_(LEAN_Q.existing, ["No"], "A"),
    ] });
    expect(p.patch.measured_area_m2).toBe(95.5);
    expect(p.areas).toHaveLength(1);
    expect(p.areas[0]).toMatchObject({ label: "Rear extension", name: "Rear extension", areaM2: 95.5, lengthM: null, widthM: null, existing: "none" });
    const unnamed = parseAudit({ audit_id: "b", items: [{ item_id: "A", label: "── Ceiling Area 1 ──" }, { item_id: "m", parent_id: "A", label: "Enter the measured ceiling area (m²)", responses: { number: 48 } }] });
    expect(unnamed.areas[0]).toMatchObject({ label: "Main ceiling", name: null, areaM2: 48 });
  });
  test("Length given but Width missing: no invented m², office issue", () => {
    n = 0;
    const p = parseAudit({ audit_id: "c", items: [{ item_id: "A", label: "", type: "dynamicfield" }, it_(LEAN_Q.areaName, "Main house", "A"), it_(LEAN_Q.lengthM, "12", "A")] });
    expect(p.patch.measured_area_m2).toBeUndefined();
    expect(p.issues.some((i) => /measured area was missing/.test(i))).toBe(true);
  });
});

describe("§6.4 reader: 'Who lives at the property?' → premises type (no new table; event details)", () => {
  test("the four lean options map to Appendix C codes; other wording is never guessed", () => {
    expect(PREMISES_TYPE_OPTIONS.map(premisesTypeCode)).toEqual(["owner_occupied", "private_rental", "public_housing", "community_housing"]);
    expect(premisesTypeCode("Something else")).toBeNull();
    expect(premisesTypeCode(null)).toBeNull();
  });
  test("read from the form snapshot; absent on old forms → nulls", () => {
    expect(premisesTypeFromEntries(parseAudit(leanAudit()).snapshot)).toEqual({ answer: "Private rental – tenant lives here", code: "private_rental" });
    expect(premisesTypeFromEntries(parseAudit(leanAudit({ who: null })).snapshot)).toEqual({ answer: null, code: null });
  });
  test("the portal occupancy record prefills it as a tap option (owner_occupied / rental); unknown stays blank", () => {
    expect(premisesTypeOption("owner occupied")).toBe("Owner lives here");
    expect(premisesTypeOption("owner_occupied")).toBe("Owner lives here");
    expect(premisesTypeOption("rental")).toBe("Private rental – tenant lives here");
    expect(premisesTypeOption(null)).toBeNull();
    const rs = (id: string, labels: readonly string[]) => ({ id, responses: labels.map((l, i) => ({ id: `${id}-${i}`, label: l })) });
    const tpl = { template: { items: [
      { id: "pj", label: LEAN_Q.jobNumber, textsingle: {} }, { id: "ad", label: LEAN_Q.siteAddress, textsingle: {} }, { id: "on", label: LEAN_Q.ownerName, textsingle: {} },
      { id: "who", label: LEAN_Q.premisesType, question: { response_set_id: "rsW" } },
    ], response_sets: [rs("rsW", PREMISES_TYPE_OPTIONS)] } };
    const base = { jobNumber: "HV-1", address: "1 Test St", ownerName: "TEST", assessorName: "x" };
    const p = buildPrefill(tpl, { ...base, occupancy: "rental" });
    expect(p.items.find((i: { item_id: string }) => i.item_id === "who")?.responses.selected[0].label).toBe("Private rental – tenant lives here");
    expect(buildPrefill(tpl, { ...base, occupancy: null }).items.map((i: { item_id: string }) => i.item_id).sort()).toEqual(["ad", "on", "pj"]);
    expect(buildPrefill(tpl, { ...base, occupancy: "rental" }).missing).toEqual([]);
  });
});

describe("§6.4 reader: hazard = note ('What is the issue, and where is it in this area?') + photo ('Describe the issue and add a photo')", () => {
  test("flag + note + photo → flagged for office review, evidence present, note kept as the hazard description", () => {
    const p = parseAudit(leanAudit());
    expect(p.areas[0]).toMatchObject({ hazardFlag: true, hazardEvidence: true, hazardNote: "Exposed wiring near the manhole" });
    expect(p.areas[1]).toMatchObject({ hazardFlag: false, hazardNote: null });
    expect(p.issues.some((i) => /Installer flagged hazards/.test(i))).toBe(true);
    expect(p.issues.some((i) => /no photo/.test(i))).toBe(false);
    expect(p.patch.hazards).toContain("Main house: Exposed wiring near the manhole");
  });
  test("flag with nothing added → extra office issue naming the area", () => {
    const p = parseAudit(leanAudit({ hazardEvidence: false, hazardNote: false }));
    expect(p.areas[0]).toMatchObject({ hazardEvidence: false, hazardNote: null });
    expect(p.issues).toContain("Area 1 (Main house): issues flagged but no photo was added – office review required.");
  });
  test("note without a photo is NOT evidence: the note is kept and quoted in the office issue", () => {
    const p = parseAudit(leanAudit({ hazardEvidence: false }));
    expect(p.areas[0]).toMatchObject({ hazardEvidence: false, hazardNote: "Exposed wiring near the manhole" });
    expect(p.issues).toContain("Area 1 (Main house): issues flagged but no photo was added (installer note: Exposed wiring near the manhole) – office review required.");
  });
  test("photo without a note (22 Oct form) is evidence", () => {
    const p = parseAudit(leanAudit({ hazardNote: false }));
    expect(p.areas[0]).toMatchObject({ hazardEvidence: true, hazardNote: null });
  });
  test("24 Oct live text 'Please explain' is read as the note (not evidence); the 7 Oct spec photo still counts as evidence", () => {
    n = 0;
    const area = (last: object) => parseAudit({ audit_id: "h", items: [{ item_id: "A", label: "", type: "dynamicfield" }, it_(LEAN_Q.measuredM2, "50", "A"), it_(LEAN_Q.issues, ["Yes"], "A"), last] }).areas[0]!;
    expect(area(it_("Please explain", "Rats in the roof", "A"))).toMatchObject({ hazardEvidence: false, hazardNote: "Rats in the roof" });
    expect(area(media("Describe them and add a photo", "A"))).toMatchObject({ hazardEvidence: true, hazardNote: null });
  });
});

describe("§6.4 reader: product question always shown; contact answers unchanged", () => {
  test("the product is read whether or not the outcome is passed", () => {
    const failed = leanAudit();
    failed.items = failed.items.map((i) => (i.label === LEAN_Q.outcome ? { ...i, responses: sel("No - Ready Check failed") } : i));
    expect(contactAnswersFromEntries(parseAudit(failed).snapshot).productOption).toBe("Bradford Gold R6");
    expect(parseAudit(failed).issues.some((i) => /Ready Check as failed/.test(i))).toBe(true);
    expect(contactAnswersFromEntries(parseAudit(leanAudit()).snapshot)).toMatchObject({ phone: "0400000000", contactPermission: true, electricianChoice: "hivic", productOption: "Bradford Gold R6" });
  });
});

// ---------- build sheet / validator ----------
const typeOf = (f: FormField) => f.type === "choice" || f.type === "yesno" ? "question" : f.type === "multichoice" ? "list" : f.type === "tick" ? "checkbox" : f.type === "phone" || f.type === "text" ? "textsingle" : f.type;
/** The lean template as Mitti would flatten it: shared questions once, the repeating group once (no copies), no legacy items. */
const leanItems = (key: "ready_check" | "ready_check_priced") => FORMS[key].fields.filter((f) => !f.portalOnly).map((f) => ({ label: f.label, type: typeOf(f) }));
const load = (f: string) => JSON.parse(readFileSync(`tests/fixtures/mitti-ready-check/${f}`, "utf8"));

describe("build sheet = the lean forms exactly (validateTemplate)", () => {
  test("A1 (ready_check_priced) and A2 (ready_check) lean templates pass with no issues; counts match the prompt", () => {
    expect(validateTemplate("ready_check_priced", leanItems("ready_check_priced"))).toEqual({ ok: true, issues: [] });
    expect(validateTemplate("ready_check", leanItems("ready_check"))).toEqual({ ok: true, issues: [] });
    // Decision 278: A1 lost its quote page (7 questions); decision 290 (corrected): both lost the access charge/fee pair
    // — A1 34 questions; A2 keeps the no-pricing tick — 35. Decision 359 adds the four Part 6 questions per area → 38 / 39.
    expect(leanQuestionCount("ready_check_priced", { beforeDecision: 359 })).toBe(34);
    expect(leanQuestionCount("ready_check", { beforeDecision: 359 })).toBe(35);
    expect(leanQuestionCount("ready_check_priced")).toBe(38);
    expect(leanQuestionCount("ready_check")).toBe(39);
    // A template built before decision 359 (no Part 6 questions) still validates.
    const before359 = (key: "ready_check" | "ready_check_priced") => FORMS[key].fields.filter((f) => !f.portalOnly && f.addedByDecision !== 359).map((f) => ({ label: f.label, type: typeOf(f) }));
    expect(validateTemplate("ready_check_priced", before359("ready_check_priced"))).toEqual({ ok: true, issues: [] });
    expect(validateTemplate("ready_check", before359("ready_check"))).toEqual({ ok: true, issues: [] });
    for (const key of ["ready_check", "ready_check_priced"] as const) {
      const labels = FORMS[key].fields.map((f) => f.label);
      expect(labels).not.toContain(LEAN_REMOVE.accessCharge);
      expect(labels).not.toContain(LEAN_REMOVE.accessFee);
      expect(labels).toContain(LEAN_Q.access); // the rating stays: it IS the flag
    }
  });
  test("one repeating area group: every per-area field is perArea, no 'how many', no copies needed; m² is legacy-only", () => {
    const f = FORMS.ready_check.fields;
    const perArea = f.filter((x) => x.perArea).map((x) => x.label);
    expect(perArea).toEqual([LEAN_Q.areaName, LEAN_Q.lengthM, LEAN_Q.widthM, LEAN_Q.measuredM2, LEAN_Q.measuredHow, LEAN_Q.measuredHowOther, LEAN_Q.existing, LEAN_Q.existingType, LEAN_Q.rValue, LEAN_Q.depthPhoto, LEAN_Q.existingAction, LEAN_Q.removeM2, LEAN_Q.existingSuitable, LEAN_Q.existingConductive, LEAN_Q.existingConductivePhoto, LEAN_Q.existingKeepReason, LEAN_Q.beforeVideo, LEAN_Q.downlights, LEAN_Q.downlightsCount, LEAN_Q.issues, LEAN_Q.issueNote, LEAN_Q.issuePhoto]);
    expect(f.some((x) => /how many (separate )?ceiling areas/i.test(x.label))).toBe(false);
    const m2 = f.find((x) => x.label === LEAN_Q.measuredM2)!;
    expect([m2.required, m2.portalOnly]).toEqual([false, true]);
    for (const l of [LEAN_Q.lengthM, LEAN_Q.widthM]) expect(f.find((x) => x.label === l)!.notRequiredIf).toEqual([LEAN_Q.measuredM2]);
    // Three copies of the group (as a repeater reports them) are not "Duplicate".
    const items = leanItems("ready_check");
    const area = items.filter((i) => perArea.includes(i.label));
    expect(validateTemplate("ready_check", [...items, ...area, ...area]).ok).toBe(true);
  });
  test("dropped: Assessor, details-correct pair, extras trio, sketch, depth (mm), describe/explain boxes, Other property text", () => {
    const labels = [...FORMS.ready_check.fields, ...FORMS.ready_check_priced.fields].flatMap((f) => [f.label, ...(f.aliases ?? [])]);
    for (const gone of ["Assessor", "Are these details correct?", "Are the property details provided above correct?", "What needs correcting?", "Are any extras needed beyond the standard install and removal?", "Describe each extra and why it is needed", "Photos of each extra", "Upgrade area diagram or floor plan", LEAN_REMOVE.sketchA1, LEAN_REMOVE.sketchA2, LEAN_REMOVE.depthMm, LEAN_REMOVE.describeType, LEAN_REMOVE.howMany, LEAN_REMOVE.clickOnMe, LEAN_REMOVE.propertyTypeOther, LEAN_REMOVE.describeRoof, LEAN_REMOVE.explainDifficult, LEAN_REMOVE.explainNoSafe, "Anything else the office should know?", "Depth (mm)", "No photo? I confirm the existing insulation is below R2.0 and the home is eligible for the rebate"]) {
      expect(labels, gone).not.toContain(gone);
    }
    // "Please explain" survives only as an accepted alias of the hazard note (never of the photo), never as its own question.
    expect(FORMS.ready_check.fields.find((f) => f.label === LEAN_Q.issueNote)!.aliases).toContain("Please explain");
    expect(FORMS.ready_check.fields.find((f) => f.label === LEAN_Q.issuePhoto)!.aliases ?? []).not.toContain("Please explain");
    for (const l of [LEAN_Q.issueNote, LEAN_Q.issuePhoto]) expect(FORMS.ready_check.fields.find((f) => f.label === l)).toMatchObject({ required: true, perArea: true, when: `${LEAN_Q.issues} = Yes` });
    expect(PRICING_FIELDS[0]!.choices).toEqual([...INCLUDED_OPTIONS]);
    expect(PRICING_FIELDS[0]!.choices).not.toContain("Difficult access");
  });
  test("options on the build sheet are the lean option lists (7 products, R2.0 or above, No safe access, premises types)", () => {
    const by = (l: string) => FORMS.ready_check_priced.fields.find((f) => f.label === l)!;
    expect(by(LEAN_Q.product).choices).toEqual(APPROVED_PRODUCTS.map((p) => p.option));
    expect(by(LEAN_Q.product).choices).toHaveLength(7);
    expect(by(LEAN_Q.rValue).choices).toEqual(["Below R2.0", "R2.0 or above"]);
    expect(by(LEAN_Q.access).choices).toEqual(["Easy", "Standard", "Difficult", "No safe access"]);
    expect(by(LEAN_Q.premisesType).choices).toEqual([...PREMISES_TYPE_OPTIONS]);
    expect(by(LEAN_Q.failReasons).choices).toEqual([...FAIL_REASON_OPTIONS]);
    // Decision 278: the electrician/price questions are old-A1 readers only — never on the A1 build sheet.
    expect(FORMS.ready_check_priced.fields.find((f) => f.label === LEAN_Q.electrician)).toBeUndefined();
    expect(ELECTRICIAN_FIELDS[0]!.choices).toEqual([...ELECTRICIAN_OPTIONS]);
    expect(ELECTRICIAN_FIELDS.map((f) => f.label)).toEqual([LEAN_Q.electrician, LEAN_Q.electricianName, LEAN_Q.electricianLicence, LEAN_Q.electricianPrice]);
    for (const q of A1_QUOTE_QUESTIONS) expect(FORMS.ready_check_priced.fields.map((f) => f.label)).not.toContain(q);
  });
  test("the mittiAiPrompt build sheet asks for one repeating group and no retired sections", () => {
    for (const key of ["ready_check", "ready_check_priced"] as const) {
      const p = mittiAiPrompt(key);
      expect(p).toContain(`"${AREA_GROUP_BUTTON}"`);
      expect(p).toContain("Do NOT ask how many areas");
      expect(p).not.toContain(LEAN_Q.measuredM2); // legacy m² never asked for on a new build
      expect(p).not.toContain("How many separate ceiling areas");
    }
  });
});

describe("the CURRENT live forms (22–24 Oct fixtures) and in-progress audits still validate and parse", () => {
  const A1 = load("a1-published-r35.json"), A2 = load("a2-published-r13.json"), A1_OLD = load("a1-old-r34.json"), A2_OLD = load("a2-old-r12.json");
  test("22 Oct A1: every old wording is recognised; only questions the lean form ADDS are reported missing", () => {
    expect(validateTemplate("ready_check_priced", flattenDefinition(A1)).issues).toEqual([
      `Missing: ${LEAN_Q.builtLast5}`, `Missing: ${LEAN_Q.premisesType}`, `Missing: ${LEAN_Q.issueNote}`, `Missing: ${LEAN_Q.product}`,
    ]);
  });
  test("22 Oct A2 (fixture carries only the first-branch items): no 'Wrong type' or 'Duplicate', only genuinely absent questions", () => {
    const issues = validateTemplate("ready_check", flattenDefinition(A2)).issues;
    expect(issues.every((i) => i.startsWith("Missing: "))).toBe(true);
    expect(issues).toContain(`Missing: ${LEAN_Q.premisesType}`);
    expect(issues).not.toContain(`Missing: ${LEAN_Q.siteAddress}`);
    expect(issues).not.toContain(`Missing: ${LEAN_Q.builtLast5}`); // asked as text on A2 — accepted
    expect(issues).not.toContain(`Missing: ${LEAN_Q.noPricingTick}`); // 23 Oct wording accepted as an alias
  });
  test("older template versions: no false Wrong type / Duplicate either", () => {
    for (const [t, k] of [[A1_OLD, "ready_check_priced"], [A2_OLD, "ready_check"]] as const) expect(validateTemplate(k, flattenDefinition(t)).issues.every((i) => i.startsWith("Missing: "))).toBe(true);
  });
  test("the 24 Oct live A1 wording (per the live audit) passes except for the questions the lean form adds", () => {
    // Flattened as Mitti reports a 22-copy fixed-branch form: the area block repeated, help text after a line break.
    const area = [
      ["Which part of the home does this ceiling area cover?\ne.g. Main house – bedrooms and hallway", "textsingle"], ["How was this ceiling area measured?", "question"], ["Tell us how you measured it ", "textsingle"],
      ["Upload your area sketch or floor plan.\nRough is fine. Mark this ceiling area and show the measurements used.", "media"], ["Enter the measured ceiling area (m²)", "textsingle"],
      ["Is there existing insulation in this ceiling area?", "question"], ["What type of existing insulation is installed? Select all that apply", "list"], ["Please describe the existing insulation type ", "textsingle"],
      ["What is the measured insulation depth (mm)?", "textsingle"], ["What is the determined R value of the existing ceiling insulation?", "question"], ["Upload a photo clearly showing the measured insulation depth", "media"],
      ["What is required for the existing insulation?", "question"], ["How much existing insulation needs to be removed? (m²)", "textsingle"], ["Upload an overview photo of this ceiling area", "media"],
      ["Are there recessed downlights in this ceiling area?", "question"], ["How many recessed downlights?", "textsingle"],
      ["Are there any issues that could affect the insulation installation? Example: exposed wiring, vermin, restricted access or other hazards", "question"], ["Please explain", "textsingle"],
    ];
    const live = [
      ["Portal Job Number", "textsingle"], ["Site address", "address"], ["Homeowner name", "textsingle"], ["Homeowner phone", "textsingle"], ["Homeowner email", "textsingle"],
      ["Homeowner agrees to be contacted by Home Insulation Victoria", "question"], ["Property type", "question"], ["What is the property type?", "textsingle"], ["Life support equipment at property?", "question"],
      ["Was the ceiling or roof built or replaced in the last 5 years?", "question"], ["What type of roof does the home have? ", "question"], ["Describe the roof type", "textsingle"],
      ["How would you rate the ceiling access?", "question"], ["Please explain why the access is difficult", "textsingle"], ["Is there a difficult access charge?", "question"], ["Difficult access fee ($ inc GST)", "textsingle"],
      ["Please explain why there is no safe access", "textsingle"], ["Upload a clear photo of the ceiling access point", "media"],
      ["How many ceiling areas need to be measured separately? \nCount areas separately where they have different roof/ceiling sections.", "list"], ["CLICK ON ME to add a ceiling area", "dynamicfield"],
      ...Array.from({ length: 22 }, () => area).flat(),
      ["What’s included in your quote?", "list"], ["What else is included?", "textsingle"], ["Total quoted price (inc GST)", "textsingle"],
      ["Who is doing the electrical safety check?", "list"], ["Electrician name", "textsingle"], ["Electrician licence number", "textsingle"], ["Electrician price (inc GST)", "textsingle"],
      ["Based on your onsite assessment, does this property meet the Ready Check requirements to proceed?", "question"], ["Why did the property fail the ready check? Select all that apply", "list"],
      ["What insulation product will you be using on this job?", "question"],
      ["I confirm the information, measurements, photos and quote provided in this Ready Check are accurate to the best of my knowledge.", "signature"],
    ].map(([label, type]) => ({ label: label!, type: type! }));
    // "Please explain" is accepted as the hazard NOTE; the hazard photo is genuinely absent from the 24 Oct form.
    expect(validateTemplate("ready_check_priced", live).issues).toEqual([`Missing: ${LEAN_Q.premisesType}`, `Missing: ${LEAN_Q.issuePhoto}`]);
    // Form health tells the office exactly which lean question a live form lacks (the audit's problem 3).
    expect(validateTemplate("ready_check_priced", live.filter((i) => i.label !== "What insulation product will you be using on this job?")).issues).toEqual([`Missing: ${LEAN_Q.premisesType}`, `Missing: ${LEAN_Q.issuePhoto}`, `Missing: ${LEAN_Q.product}`]);
  });
  test("prefill still lands on both 22 Oct templates and both older versions", () => {
    const ctx = { jobNumber: "HV-TEST-1", address: "1 Test St", ownerName: "Test Owner", ownerEmail: "jolowexo@hotmail.com", ownerPhone: "0400000000", assessorName: "Test Installer", lifeSupport: "None recorded by office", propertyType: "House", builtLast5Years: "No", occupancy: "owner occupied" };
    for (const t of [A1, A2, A1_OLD, A2_OLD]) { const p = buildPrefill(t, ctx); expect(p.missing).toEqual([]); expect(p.ambiguous).toEqual([]); }
    expect(flatten(A1).some((x) => x.label.split("\n")[0]!.trim() === LEAN_Q.areaName)).toBe(true); // A1 carries help text after a line break
  });
  test("an in-progress 22 Oct audit (Above R2.0, m² entry, 'Describe the issue and add a photo') parses as before", () => {
    n = 0;
    const p = parseAudit({ audit_id: "old", items: [
      { item_id: "A", label: "── Ceiling Area 1 ──" }, it_("Enter the measured ceiling area (m²)", "120", "A"), it_(LEAN_Q.existing, ["Yes"], "A"), it_(LEAN_Q.rValue, ["Above R2.0"], "A"),
      it_(LEAN_Q.issues, ["Yes"], "A"), media("Describe the issue and add a photo", "A"), it_("How would you rate the ceiling access?", ["Difficult"]),
    ] });
    expect(p.patch.measured_area_m2).toBe(120);
    expect(p.patch.access_difficulty).toBe("difficult");
    expect(readyCheckStopReasons(p.snapshot)).toEqual([STOP_R2]);
    expect(p.areas[0]).toMatchObject({ label: "Main ceiling", hazardFlag: true, hazardEvidence: true, rValueBand: "at_or_above_r2" });
  });
});

// ---------- the ChatGPT build prompt must carry every reader wording verbatim (pattern: install-evidence-prompt.test.ts) ----------
describe("docs/MITTI_READY_CHECK_PRICE_PROMPT.md (decision 278): delete the A1 quote page, nothing else", () => {
  const prompt = readFileSync("docs/MITTI_READY_CHECK_PRICE_PROMPT.md", "utf8");
  const body = prompt.slice(prompt.indexOf("\n---\n"));
  test("names A1 first, the page and its seven questions verbatim, deletes the access charge/fee pair on both (decision 290), and adds nothing", () => {
    expect(body).toContain("Edit the Mitti template `A1 – Ready Check | Installer-Supplied Customer`");
    expect(body).toContain(`DELETE the whole page/section \`${A1_QUOTE_PAGE}\``);
    for (const q of A1_QUOTE_QUESTIONS) expect(body, q).toContain(`- \`${q}\``);
    // Decision 290 (corrected): the fee pair goes from BOTH templates; nothing replaces it; no help text about a fee remains.
    expect(body).toContain(`DELETE the questions \`${LEAN_REMOVE.accessCharge}\` and \`${LEAN_REMOVE.accessFee}\``);
    expect(body).toContain("on BOTH templates");
    expect(body).not.toMatch(/REPLACE the A1 help text|Difficult access\?|Why\?/);
    expect(body).toContain("Do NOT add anything in its place");
    // This prompt ran before decision 359's Part 6 questions were added (docs/MITTI_READY_CHECK_PART6_PROMPT.md).
    expect(body).toContain(`${leanQuestionCount("ready_check_priced", { beforeDecision: 359 })} questions`);
    expect(body).toContain(`${leanQuestionCount("ready_check", { beforeDecision: 359 })} questions`);
  });
});

describe("docs/MITTI_READY_CHECK_ONE_PROMPT.md (the prompt Jo runs) agrees with the contracts", () => {
  const prompt = readFileSync("docs/MITTI_READY_CHECK_ONE_PROMPT.md", "utf8");
  const body = prompt.slice(prompt.indexOf("\n---\n"));
  test("item 6 deletes the access charge/fee pair on both templates and adds nothing (decision 290, corrected)", () => {
    expect(body).toContain(`6. In BOTH templates, DELETE the question \`${LEAN_REMOVE.accessCharge}\` and the question \`${LEAN_REMOVE.accessFee}\``);
    expect(body).not.toMatch(/Difficult access\?|Why\?|REPLACE the A1 help text|Included in the price your business owner enters/);
    for (const q of A1_QUOTE_QUESTIONS) expect(body, q).toContain(`- \`${q}\``);
    expect(body).toContain(`DELETE the whole page/section \`${A1_QUOTE_PAGE}\``);
    expect(body).toContain(`\`${LEAN_Q.access}\``);
  });
});

describe("docs/MITTI_READY_CHECK_CHATGPT_PROMPT.md carries every constant verbatim", () => {
  const prompt = readFileSync("docs/MITTI_READY_CHECK_CHATGPT_PROMPT.md", "utf8");
  const body = prompt.slice(prompt.indexOf("\n---\n"));
  test("every question label the portal reads, as a backticked line, in form order", () => {
    let last = -1;
    const order: (keyof typeof LEAN_Q)[] = ["jobNumber", "siteAddress", "ownerName", "ownerPhone", "ownerEmail", "propertyType", "contactPermission", "lifeSupport", "builtLast5", "premisesType", "roofType", "access", "accessPhoto",
      "areaName", "lengthM", "widthM", "measuredHow", "measuredHowOther", "existing", "existingType", "rValue", "depthPhoto", "existingAction", "removeM2", "existingSuitable", "existingConductive", "existingConductivePhoto", "existingKeepReason", "beforeVideo", "downlights", "downlightsCount", "issues", "issueNote", "issuePhoto",
      "product", "outcome", "failReasons", "noPricingTick", "signatureA1", "signatureA2"];
    expect(new Set(order).size).toBe(Object.keys(LEAN_Q).length - 1 - A1_QUOTE_QUESTIONS.length); // every LEAN_Q key but the legacy m² entry and the deleted A1 quote page (decision 278)
    for (const k of order) {
      const at = body.indexOf(`\`${LEAN_Q[k]}\` —`);
      expect(at, LEAN_Q[k]).toBeGreaterThan(-1);
      expect(at, `${LEAN_Q[k]} out of order`).toBeGreaterThan(last);
      last = at;
    }
    // The legacy m² entry is named only in the REMOVE list.
    expect(body.indexOf(`\`${LEAN_Q.measuredM2}\``)).toBeGreaterThan(-1);
    expect(body).not.toContain(`\`${LEAN_Q.measuredM2}\` —`);
    // Decision 278: the A1 quote page is named as deleted and none of its questions is asked for.
    expect(body).toContain(`\`${A1_QUOTE_PAGE}\` is DELETED`);
    for (const q of A1_QUOTE_QUESTIONS) { expect(body, q).toContain(`\`${q}\``); expect(body).not.toContain(`\`${q}\` —`); }
  });
  test("every option list, help text and the template names", () => {
    for (const o of [...PROPERTY_TYPE_OPTIONS, ...PREMISES_TYPE_OPTIONS, ...ROOF_OPTIONS, ...ACCESS_OPTIONS, ...MEASURED_HOW_OPTIONS, ...EXISTING_TYPE_OPTIONS, ...R_VALUE_OPTIONS, ...EXISTING_ACTION_OPTIONS, ...PRODUCT_OPTIONS, ...OUTCOME_OPTIONS, ...FAIL_REASON_OPTIONS]) expect(body, o).toContain(`\`${o}\``);
    // Decision 278: the quote-page option lists live on the portal card now, not on either template.
    expect(body).not.toContain(`Tick all: \`${INCLUDED_OPTIONS[0]}\``);
    expect(body).not.toContain(`Pick one: \`${ELECTRICIAN_OPTIONS[0]}\``);
    expect(body).toContain(PRODUCT_OPTIONS.map((o) => `\`${o}\``).join(" / "));
    for (const h of Object.values(LEAN_HELP)) expect(body, h).toContain(`\`${h}\``);
    expect(body).toContain("**Template 1 name:** `A1 – Ready Check | Installer-Supplied Customer`");
    expect(body).toContain("**Template 2 name:** `A2 – Ready Check | HIVIC Sourced Customer`");
    expect(body).toContain(`\`${AREA_GROUP_BUTTON}\``);
  });
  test("the REMOVE list (§6.5): all 22 / 21 sketch copies, the fixed area copies 2–22, every dead question", () => {
    for (const r of [LEAN_REMOVE.sketchA1, LEAN_REMOVE.sketchA2, LEAN_REMOVE.depthMm, LEAN_REMOVE.describeType, LEAN_REMOVE.pleaseExplain, LEAN_REMOVE.howMany, LEAN_REMOVE.clickOnMe, LEAN_REMOVE.propertyTypeOther, LEAN_REMOVE.describeRoof, LEAN_REMOVE.explainDifficult, LEAN_REMOVE.explainNoSafe, LEAN_REMOVE.includedDifficultAccess, LEAN_REMOVE.accessCharge, LEAN_REMOVE.accessFee]) expect(body, r).toContain(`\`${r}\``);
    expect(body).toContain(`\`${LEAN_REMOVE.areaHeading(1)}\``);
    expect(body).toContain(`\`${LEAN_REMOVE.areaHeading(6)}\``);
    expect(body).toContain(`${LEAN_REMOVE_COPIES.a1} old A1 area blocks and ${LEAN_REMOVE_COPIES.a2} old A2 area blocks`);
    expect(body).toContain("every fixed area copy 2–22");
    expect(body).toContain("**REMOVE, and do not carry over");
  });
  test("mandatory mark-as-complete on, photo location on, Required as the build sheet says, and the question counts", () => {
    expect(body).toContain("turn ON **mandatory mark-as-complete**");
    expect(body).toContain("Turn ON location/GPS for every Photo question");
    expect(body).toContain(`A1 has ${leanQuestionCount("ready_check_priced")} questions and A2 has ${leanQuestionCount("ready_check")}`);
    // Every optional build-sheet question is "Not required" in the prompt; everything else is Required.
    for (const f of FORMS.ready_check_priced.fields.filter((x) => !x.portalOnly)) {
      const line = body.split("\n").find((l) => l.includes(`\`${f.label}\` —`))!;
      expect(line, f.label).toBeDefined();
      expect(line.includes("Not required"), f.label).toBe(!f.required);
    }
    expect(body).toContain("always shown (NOT only when the Ready Check passed)");
    expect(body).toContain("A2 only");
    expect(body).toContain("A1 only");
  });
  test("old wording the readers still accept is never asked for as a question", () => {
    for (const old of [R_ABOVE_LEGACY, ...(LEAN_ALIASES.issuePhoto ?? []), ...(LEAN_ALIASES.issueNote ?? []), ...(LEAN_ALIASES.areaName ?? []), ...(LEAN_ALIASES.access ?? [])]) expect(body).not.toContain(`\`${old}\` —`);
  });
});

// ---------- decision 359: official PIISA Part 6 facts asked per area at the Ready Check ----------
describe("decision 359: Part 6 facts per ceiling area (parse → zones → readyCheckPart6Answers)", () => {
  /** Area A topped up (with or without the four new answers); area B has no existing insulation. */
  function part6Audit(answers: boolean) {
    n = 0;
    const areaA = { item_id: "areaA", label: "", type: "dynamicfield" }, areaB = { item_id: "areaB", label: "", type: "dynamicfield" };
    return {
      audit_id: "audit_p6", template_id: "template_lean",
      header_items: [it_(LEAN_Q.jobNumber, "HV-3201")],
      items: [
        areaA,
        it_(LEAN_Q.areaName, "Main house", "areaA"), it_(LEAN_Q.lengthM, "10", "areaA"), it_(LEAN_Q.widthM, "8", "areaA"), it_(LEAN_Q.measuredHow, ["Laser measure"], "areaA"),
        it_(LEAN_Q.existing, ["Yes"], "areaA"), it_(LEAN_Q.existingType, ["Batts"], "areaA"), it_(LEAN_Q.rValue, ["Below R2.0"], "areaA"), it_(LEAN_Q.existingAction, ["Top up"], "areaA"),
        ...(answers ? [it_(LEAN_Q.existingSuitable, ["Yes"], "areaA"), it_(LEAN_Q.existingConductive, ["No"], "areaA"), media(LEAN_Q.existingConductivePhoto, "areaA"), it_(LEAN_Q.existingKeepReason, "Batts are dry and even", "areaA")] : []),
        areaB,
        it_(LEAN_Q.areaName, "Garage", "areaB"), it_(LEAN_Q.lengthM, "5", "areaB"), it_(LEAN_Q.widthM, "4", "areaB"), it_(LEAN_Q.measuredHow, ["Tape measure"], "areaB"), it_(LEAN_Q.existing, ["No"], "areaB"),
      ],
    };
  }
  test("the four answers ride on the area record and fill Part 6 (depth aside: this audit has no depth answer)", () => {
    const p = parseAudit(part6Audit(true));
    expect(p.areas[0]).toMatchObject({ suitable: true, conductive: false, keepReason: "Batts are dry and even" });
    expect(p.areas[0]!.conductiveEvidence).toMatch(/^mitti:audit_p6:item:m\d+$/);
    expect(p.areas[1]).toMatchObject({ suitable: null, conductive: null, conductiveEvidence: null, keepReason: null });
    const zones = rcAreasFromRecord({ insulation_present: true, existing_r_value: null, zones: JSON.parse(JSON.stringify(p.areas)) }, null);
    const r = readyCheckPart6Answers(zones);
    expect(r.answers).toMatchObject({ "p6.present": "Yes", "p6.treatment": ["Topped Up"], "p6.suitable": "Yes", "p6.reason": "Batts are dry and even" });
    expect(r.conductive).toBe(false);
    expect(r.conductiveEvidence).toBe(p.areas[0]!.conductiveEvidence!);
    expect(r.missing).toEqual(["Ready Check: existing insulation depth (mm) not recorded"]);
  });
  test("an old form without the questions stays readable and the top-up facts are flagged missing", () => {
    const p = parseAudit(part6Audit(false));
    expect(p.areas[0]).toMatchObject({ present: true, removal: "no", suitable: null, conductive: null, conductiveEvidence: null, keepReason: null });
    const r = readyCheckPart6Answers(rcAreasFromRecord({ insulation_present: true, existing_r_value: null, zones: p.areas }, null));
    expect(r.missing.some((m) => /reason the existing insulation is being kept/.test(m))).toBe(true);
    expect(r.missing.some((m) => /suitable to lay over/.test(m))).toBe(true);
    expect(r.missing.some((m) => /foil, metallic or conductive/.test(m))).toBe(true);
  });
  test("docs/MITTI_PASTE_NOW.md block 4 carries the exact labels, both templates, the conditions and the counts", () => {
    const doc = readFileSync("docs/MITTI_PASTE_NOW.md", "utf8");
    const block = doc.slice(doc.indexOf("## 4."));
    expect(block).toContain(`"${LEAN_Q.existingSuitable}" — Yes/No — Required — only show when "${LEAN_Q.existingAction}" = Top up`);
    expect(block).toContain(`"${LEAN_Q.existingConductive}" — Yes/No — Required — only show when "${LEAN_Q.existing}" = Yes`);
    expect(block).toContain(`"${LEAN_Q.existingConductivePhoto}" — Photo, location on — Required — only show when "${LEAN_Q.existing}" = Yes`);
    expect(block).toContain(`"${LEAN_Q.existingKeepReason}" — Text — Required — only show when "${LEAN_Q.existingAction}" = Top up`);
    expect(block).toContain(`straight after the question "${LEAN_Q.removeM2}" and before "${LEAN_Q.beforeVideo}"`);
    expect(block).toContain(`"A1 – Ready Check | Installer-Supplied Customer" and "A2 – Ready Check | HIVIC Sourced Customer"`);
    expect(block).toContain(`A1 has ${leanQuestionCount("ready_check_priced")} questions and A2 has ${leanQuestionCount("ready_check")}`);
    for (const f of FORMS.ready_check.fields.filter((x) => x.addedByDecision === 359)) expect(block, f.label).toContain(`"${f.label}"`);
  });
});

// ---------- decision 375: the live depth question fills the official PIISA Part 6 height ----------
describe("decision 375: existing insulation depth (live question) → p6.height, m²-weighted when areas differ", () => {
  type A = { name: string; action: "Top up" | "Remove"; depth?: string; length?: string };
  function depthAudit(areas: A[]) {
    n = 0;
    const items: unknown[] = [];
    for (const [i, a] of areas.entries()) {
      const id = `area${i}`;
      items.push({ item_id: id, label: "", type: "dynamicfield" },
        it_(LEAN_Q.areaName, a.name, id), it_(LEAN_Q.lengthM, a.length ?? "10", id), it_(LEAN_Q.widthM, "8", id), it_(LEAN_Q.measuredHow, ["Laser measure"], id),
        it_(LEAN_Q.existing, ["Yes"], id), it_(LEAN_Q.existingType, ["Batts"], id), it_(LEAN_Q.rValue, ["Below R2.0"], id),
        ...(a.depth != null ? [it_(EXISTING_DEPTH_Q, a.depth, id)] : []),
        it_(LEAN_Q.existingAction, [a.action], id),
        ...(a.action === "Remove" ? [it_(LEAN_Q.removeM2, "80", id)] : [
          it_(LEAN_Q.existingSuitable, ["Yes"], id), it_(LEAN_Q.existingConductive, ["No"], id), media(LEAN_Q.existingConductivePhoto, id), it_(LEAN_Q.existingKeepReason, "Batts are dry and even", id),
        ]));
    }
    return { audit_id: "audit_d375", template_id: "template_live", header_items: [it_(LEAN_Q.jobNumber, "HV-3375")], items };
  }
  const part6 = (areas: A[]) => readyCheckPart6Answers(rcAreasFromRecord({ insulation_present: true, existing_r_value: null, zones: JSON.parse(JSON.stringify(parseAudit(depthAudit(areas)).areas)) }, null));
  const piisaP6Blockers = (r: ReturnType<typeof readyCheckPart6Answers>) =>
    evaluatePiisa({ ...r.answers, "supp.conductive": r.conductive ? "Yes" : "No" }, { conductiveExistingInsulation: r.conductive, conductivityEvidence: r.conductiveEvidence }).blockers.filter((b) => /p6\.|P6|CONDUCTIVITY/.test(b.rule));

  test("Jo keeps the live question: no new depth question on the build sheet, counts unchanged", () => {
    expect(EXISTING_DEPTH_Q).toBe("What is the measured insulation depth (mm)?");
    expect(FORMS.ready_check.fields.some((f) => /average depth/i.test(f.label))).toBe(false);
    const doc = readFileSync("docs/MITTI_PASTE_NOW.md", "utf8");
    const block = doc.slice(doc.indexOf("## 4."));
    expect(block).toContain(`"${EXISTING_DEPTH_Q}"\nis kept unchanged`);
    expect(block).not.toMatch(/Delete the question|Average depth/);
  });
  test("top-up with a depth → official PIISA Part 6 complete", () => {
    const r = part6([{ name: "Main house", action: "Top up", depth: "85mm" }]);
    expect(r.missing).toEqual([]);
    expect(r.answers).toMatchObject({ "p6.present": "Yes", "p6.height": "85", "p6.treatment": ["Topped Up"], "p6.suitable": "Yes", "p6.reason": "Batts are dry and even" });
    expect(piisaP6Blockers(r)).toEqual([]);
  });
  test("full removal with a depth → Part 6 complete (no hold)", () => {
    const r = part6([{ name: "Main house", action: "Remove", depth: "60" }]);
    expect(r).toMatchObject({ fullRemoval: true, missing: [] });
    expect(r.answers).toEqual({ "p6.present": "Yes", "p6.height": "60", "p6.treatment": ["Removed"], "p6.suitable": "No" });
    expect(piisaP6Blockers(r)).toEqual([]);
  });
  test("differing depths → ONE average weighted by m², nearest mm; no office step", () => {
    // 80 m² at 50 mm and 40 m² at 120 mm → (4000 + 4800) / 120 = 73.33 → 73.
    const r = part6([{ name: "Main", action: "Top up", depth: "50", length: "10" }, { name: "Rear", action: "Remove", depth: "120", length: "5" }]);
    expect(r.answers["p6.height"]).toBe("73");
    expect(r.missing).toEqual([]);
    expect(weightedDepthMm([{ depthMm: 60, areaM2: 30 }, { depthMm: 61, areaM2: 30 }])).toBe(61); // 60.5 rounds up
  });
  test("an area without a depth, or without m² when weighting is needed, is named missing; old/vague answers stay not recorded", () => {
    expect(part6([{ name: "Main", action: "Top up" }]).missing).toEqual(["Ready Check: existing insulation depth (mm) not recorded"]);
    expect(part6([{ name: "Main", action: "Top up", depth: "about 80" }]).missing).toEqual(["Ready Check: existing insulation depth (mm) not recorded"]);
    expect(part6([{ name: "Main", action: "Top up", depth: "80" }, { name: "Rear", action: "Remove" }]).missing).toEqual(["Ready Check: existing insulation depth (mm) not recorded (Rear)"]);
    const noM2 = readyCheckPart6Answers([
      { name: "Main", present: true, depthMm: 50, areaM2: 80, removal: true },
      { name: "Rear", present: true, depthMm: 120, areaM2: null, removal: true },
    ]);
    expect(noM2.answers["p6.height"]).toBeUndefined();
    expect(noM2.missing).toEqual(["Ready Check: ceiling area (m²) not recorded, so the average existing insulation depth can't be worked out (Rear)"]);
    // Same depth everywhere: no m² needed.
    expect(readyCheckPart6Answers([{ present: true, depthMm: 70, removal: true }, { present: true, depthMm: 70, removal: true }]).answers["p6.height"]).toBe("70");
  });
});
