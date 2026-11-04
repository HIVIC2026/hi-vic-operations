// New job flow Part 8 Task 12 (Jo 3 Nov 2026): area name choice, m² or length × width, before video wording,
// camera-only rule, A2 no-pricing note + "different R value" question. Pure.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { parseAudit } from "../src/lib/mitti.core";
import { ownerOtherRFromEntries } from "../src/lib/ready-check-answers.core";
import { areasFromReadyCheckEntries, areaDiagramLayout, areaDiagramSvg, boxLines } from "../src/lib/area-diagram.core";
import { excludedAreaName } from "../src/lib/excluded-areas.core";
import { FORMS, mittiAiPrompt, validateTemplate } from "../src/lib/mitti-forms.core";
import { recordsChecklistGaps } from "../src/lib/esc-records-checklist.core";
import {
  A2_NO_PRICING_NOTE, AREA_NAME_OPTIONS, AREA_SIZE_OPTIONS, LEAN_ALIASES, LIVE_ONLY_HELP, LEAN_Q, OTHER_R_OPTIONS,
  areaNameFromAnswers, areaSizeBasis, ownerOtherRValue,
} from "../src/lib/ready-check-lean.core";

let n = 0;
const sel = (...labels: string[]) => ({ selected: labels.map((label) => ({ label })) });
const it_ = (label: string, v: string | string[] | null, parent: string | null = null) =>
  ({ item_id: `i${n++}`, label, parent_id: parent, responses: v == null ? {} : Array.isArray(v) ? sel(...v) : { text: v } });
const area = (id: string) => ({ item_id: id, label: "", type: "dynamicfield" });
const parse = (...items: unknown[]) => { n = 0; return parseAudit({ audit_id: "a", items }); };

describe("area name: the choice, or the typed text for Other", () => {
  test("wording is Jo's", () => {
    expect([...AREA_NAME_OPTIONS]).toEqual(["Whole home (excluding garage)", "Extension", "Upstairs", "Other"]);
    expect(LEAN_Q.areaNameOther).toBe("Type the area name");
  });
  for (const choice of ["Whole home (excluding garage)", "Extension", "Upstairs"]) {
    test(`${choice}`, () => {
      const p = parse(area("A"), it_(LEAN_Q.areaName, [choice], "A"), it_(LEAN_Q.lengthM, "10", "A"), it_(LEAN_Q.widthM, "8", "A"));
      expect(p.areas[0]).toMatchObject({ name: choice, label: choice, areaM2: 80 });
      expect(p.patch.measured_area_m2).toBe(80);
      expect(p.excludedAreas).toEqual([]);
    });
  }
  test("Other uses the typed name", () => {
    const p = parse(area("A"), it_(LEAN_Q.areaName, ["Other"], "A"), it_(LEAN_Q.areaNameOther, "Granny flat", "A"), it_(LEAN_Q.lengthM, "5", "A"), it_(LEAN_Q.widthM, "4", "A"));
    expect(p.areas[0]).toMatchObject({ name: "Granny flat", label: "Granny flat", areaM2: 20 });
  });
  test("Other typed as a garage is left out of the eligible m²", () => {
    const p = parse(area("A"), it_(LEAN_Q.areaName, ["Upstairs"], "A"), it_(LEAN_Q.lengthM, "5", "A"), it_(LEAN_Q.widthM, "4", "A"),
      area("B"), it_(LEAN_Q.areaName, ["Other"], "B"), it_(LEAN_Q.areaNameOther, "Double garage", "B"), it_(LEAN_Q.lengthM, "6", "B"), it_(LEAN_Q.widthM, "6", "B"));
    expect(p.patch.measured_area_m2).toBe(20);
    expect(p.excludedAreas).toEqual([{ name: "Double garage", m2: 36 }]);
  });
  test("Other with no typed name: unnamed (falls back to Area n), never the word Other", () => {
    const p = parse(area("A"), it_(LEAN_Q.areaName, ["Other"], "A"), it_(LEAN_Q.lengthM, "5", "A"), it_(LEAN_Q.widthM, "4", "A"));
    expect(p.areas[0]).toMatchObject({ name: null, label: "Main ceiling" });
  });
  test("old free-text names still read", () => {
    const p = parse(area("A"), it_(LEAN_Q.areaName, "Main house – bedrooms\nhelp text", "A"), it_(LEAN_Q.lengthM, "10", "A"), it_(LEAN_Q.widthM, "8", "A"));
    expect(p.areas[0]).toMatchObject({ name: "Main house – bedrooms" });
  });
  test("pure helper", () => {
    expect(areaNameFromAnswers("Extension", null)).toBe("Extension");
    expect(areaNameFromAnswers("Other", " Pool house ")).toBe("Pool house");
    expect(areaNameFromAnswers("Other", "")).toBeNull();
    expect(areaNameFromAnswers("", "Pool house")).toBe("Pool house");
  });
  test("'Whole home (excluding garage)' is not a garage area; real garages still are", () => {
    expect(excludedAreaName("Whole home (excluding garage)")).toBe(false);
    expect(excludedAreaName("Whole home excluding the garage")).toBe(false);
    for (const g of ["Garage", "Double garage", "Carport", "Shed", "Whole home including garage"]) expect(excludedAreaName(g)).toBe(true);
  });
});

describe("area size: m² or length × width, exactly one", () => {
  test("wording is Jo's", () => {
    expect(LEAN_Q.areaSizeHow).toBe("How do you want to give the size?");
    expect([...AREA_SIZE_OPTIONS]).toEqual(["Enter area (m²)", "Length × width"]);
    expect(areaSizeBasis("Enter area (m²)")).toBe("m2");
    expect(areaSizeBasis("Length × width")).toBe("lw");
    expect(areaSizeBasis("")).toBeNull();
  });
  test("m² only", () => {
    const p = parse(area("A"), it_(LEAN_Q.areaName, ["Extension"], "A"), it_(LEAN_Q.areaSizeHow, ["Enter area (m²)"], "A"), it_(LEAN_Q.measuredM2, "37.5", "A"));
    expect(p.areas[0]).toMatchObject({ areaM2: 37.5, lengthM: null, widthM: null });
    expect(p.patch.measured_area_m2).toBe(37.5);
  });
  test("length × width only", () => {
    const p = parse(area("A"), it_(LEAN_Q.areaName, ["Extension"], "A"), it_(LEAN_Q.areaSizeHow, ["Length × width"], "A"), it_(LEAN_Q.lengthM, "7.5", "A"), it_(LEAN_Q.widthM, "5", "A"));
    expect(p.areas[0]).toMatchObject({ areaM2: 37.5, lengthM: 7.5, widthM: 5 });
  });
  test("the chosen way wins over a stale answer in the other", () => {
    const p = parse(area("A"), it_(LEAN_Q.areaName, ["Extension"], "A"), it_(LEAN_Q.areaSizeHow, ["Length × width"], "A"), it_(LEAN_Q.measuredM2, "99", "A"), it_(LEAN_Q.lengthM, "4", "A"), it_(LEAN_Q.widthM, "5", "A"));
    expect(p.areas[0]).toMatchObject({ areaM2: 20, lengthM: 4, widthM: 5 });
    const q = parse(area("A"), it_(LEAN_Q.areaName, ["Extension"], "A"), it_(LEAN_Q.areaSizeHow, ["Enter area (m²)"], "A"), it_(LEAN_Q.measuredM2, "30", "A"), it_(LEAN_Q.lengthM, "4", "A"), it_(LEAN_Q.widthM, "5", "A"));
    expect(q.areas[0]).toMatchObject({ areaM2: 30 });
  });
  test("neither given: the area is still counted as an area with no size, the total is not taken, an issue is raised", () => {
    const p = parse(area("A"), it_(LEAN_Q.areaName, ["Extension"], "A"), it_(LEAN_Q.areaSizeHow, ["Enter area (m²)"], "A"));
    expect(p.areas).toHaveLength(1);
    expect(p.areas[0]).toMatchObject({ areaM2: null });
    expect(p.patch.measured_area_m2).toBeUndefined();
    expect(p.issues.some((i) => /measured area was missing/.test(i))).toBe(true);
  });
  test("one good area plus a named area with no size: total not taken (Nearly there)", () => {
    const p = parse(area("A"), it_(LEAN_Q.areaName, ["Upstairs"], "A"), it_(LEAN_Q.lengthM, "5", "A"), it_(LEAN_Q.widthM, "4", "A"), area("B"), it_(LEAN_Q.areaName, ["Extension"], "B"));
    expect(p.areas).toHaveLength(2);
    expect(p.patch.measured_area_m2).toBeUndefined();
  });
  test("old forms: m² alone and L × W alone with free-text names parse as before", () => {
    const a = parse(area("A"), it_("Where is this area?", "Main house", "A"), it_("Measured area m2", "50", "A"));
    expect(a.areas[0]).toMatchObject({ name: "Main house", areaM2: 50 });
    const b = parse(area("A"), it_(LEAN_Q.areaName, "Main house", "A"), it_(LEAN_Q.lengthM, "10", "A"), it_(LEAN_Q.widthM, "5", "A"));
    expect(b.areas[0]).toMatchObject({ areaM2: 50, lengthM: 10, widthM: 5 });
  });
});

describe("diagram", () => {
  const entries = [
    { label: LEAN_Q.product, value: "Bradford Gold R6" },
    { label: LEAN_Q.areaName, value: "Other" }, { label: LEAN_Q.areaNameOther, value: "Granny flat" }, { label: LEAN_Q.areaSizeHow, value: "Enter area (m²)" }, { label: LEAN_Q.measuredM2, value: "36" },
    { label: LEAN_Q.areaName, value: "Upstairs" }, { label: LEAN_Q.areaSizeHow, value: "Length × width" }, { label: LEAN_Q.lengthM, value: "6" }, { label: LEAN_Q.widthM, value: "4" },
  ];
  test("areas read the choice / typed name and either size", () => {
    const a = areasFromReadyCheckEntries(entries);
    expect(a.map((x) => [x.name, x.lengthM, x.widthM, x.areaM2])).toEqual([["Granny flat", null, null, 36], ["Upstairs", 6, 4, 24]]);
  });
  test("m²-only area draws a square labelled '{name} · {m²} m²', no length/width labels", () => {
    const [m2only, lw] = areasFromReadyCheckEntries(entries);
    expect(boxLines(m2only!)[0]).toBe("Granny flat · 36 m²");
    expect(boxLines(m2only!).join("|")).not.toMatch(/Dimensions|×/);
    expect(boxLines(lw!)).toContain("6 × 4 m");
    const l = areaDiagramLayout({ kind: "ready_check", jobNumber: "HV-1", address: "x", generatedAt: "2026-11-03T00:00:00Z", areas: [m2only!] });
    const b = l.boxes[0]!;
    expect(b.w).toBe(b.h);
    const svg = areaDiagramSvg({ kind: "ready_check", jobNumber: "HV-1", address: "x", generatedAt: "2026-11-03T00:00:00Z", areas: [m2only!] });
    expect(svg).toContain("Granny flat · 36 m²");
    expect(svg).not.toContain("rotate(-90");
  });
});

describe("before video wording (video only), old label still read", () => {
  test("Jo's words", () => {
    expect(LEAN_Q.beforeVideo).toBe("Take a video of this ceiling area. Turn a light on, say the area's name, then film slowly all the way round.");
    expect(LEAN_ALIASES.beforeVideo).toContain("Slow 360° video of this ceiling area, lit, saying its name");
  });
  const media = (label: string, parent: string) => ({ item_id: `m${n++}`, label, parent_id: parent, media: [{ media_id: "p" }] });
  test("new label and old label both count as the area's before video", () => {
    const base = (label: string) => { n = 0; return parseAudit({ audit_id: "a", items: [area("A"), it_(LEAN_Q.areaName, ["Upstairs"], "A"), it_(LEAN_Q.lengthM, "5", "A"), it_(LEAN_Q.widthM, "4", "A"), media(label, "A")] }); };
    expect(base(LEAN_Q.beforeVideo).areas[0]!.beforeVideo).toBe(true);
    expect(base("Slow 360° video of this ceiling area, lit, saying its name").areas[0]!.beforeVideo).toBe(true);
  });
  test("a live template still carrying the old label is not reported as missing it", () => {
    const items = FORMS.ready_check.fields.filter((f) => !f.statement).map((f) => ({ label: f.label === LEAN_Q.beforeVideo ? "Slow 360° video of this ceiling area, lit, saying its name" : f.label, type: f.type === "media" ? "media" : f.type === "tick" ? "checkbox" : f.type === "signature" ? "signature" : "textsingle" }));
    expect(validateTemplate("ready_check", items).issues.filter((i) => /video/i.test(i))).toEqual([]);
  });
  test("the records checklist accepts the old before video label until Jo pastes", () => {
    const all = FORMS.ready_check.fields.map((f) => f.label).filter((l) => l !== LEAN_Q.beforeVideo);
    const gaps = recordsChecklistGaps({ a1a2: [...all, "Slow 360° video of this ceiling area, lit, saying its name"], a3: [], a5: [] });
    expect(gaps.filter((g) => /Before video/.test(g))).toEqual([]);
  });
});

describe("build sheet / prompt", () => {
  const rc = FORMS.ready_check.fields, a1 = FORMS.ready_check_priced.fields;
  const by = (fs: typeof rc, l: string) => fs.find((f) => f.label === l);
  test("area name is a single choice with Other → typed name", () => {
    expect(by(rc, LEAN_Q.areaName)).toMatchObject({ type: "choice", choices: [...AREA_NAME_OPTIONS], perArea: true, required: true });
    expect(by(rc, LEAN_Q.areaNameOther)).toMatchObject({ type: "text", perArea: true, when: `${LEAN_Q.areaName} = Other` });
  });
  test("size choice and the m² / length × width fields appear when chosen", () => {
    expect(by(rc, LEAN_Q.areaSizeHow)).toMatchObject({ type: "choice", choices: [...AREA_SIZE_OPTIONS], perArea: true });
    expect(by(rc, LEAN_Q.measuredM2)).toMatchObject({ type: "number", perArea: true, when: `${LEAN_Q.areaSizeHow} = Enter area (m²)` });
    expect(by(rc, LEAN_Q.measuredM2)!.portalOnly).toBeFalsy();
    expect(by(rc, LEAN_Q.lengthM)).toMatchObject({ when: `${LEAN_Q.areaSizeHow} = Length × width` });
  });
  test("a template built before the size choice (Length + Width only) still validates", () => {
    const items = rc.filter((f) => !f.statement && ![LEAN_Q.areaSizeHow, LEAN_Q.measuredM2, LEAN_Q.areaNameOther, LEAN_Q.otherRAsked, LEAN_Q.otherRWhich].includes(f.label)).map((f) => ({ label: f.label, type: ["media", "signature"].includes(f.type) ? f.type : ["choice", "multichoice", "yesno"].includes(f.type) ? "list" : f.type === "tick" ? "checkbox" : "textsingle" }));
    expect(validateTemplate("ready_check", items).issues).toEqual([]);
  });
  test("A2 only: the no-pricing note is the first item; the R value questions are optional and before the no-pricing tick", () => {
    expect(rc[0]).toMatchObject({ label: A2_NO_PRICING_NOTE, statement: "statement" });
    expect(A2_NO_PRICING_NOTE).toBe("This is a Home Insulation Victoria customer. Don't discuss or give any pricing. If the owner asks about a different R value, note it below and we'll quote them.");
    expect(by(a1, A2_NO_PRICING_NOTE)).toBeUndefined();
    expect(by(a1, LEAN_Q.otherRAsked)).toBeUndefined();
    expect(by(rc, LEAN_Q.otherRAsked)).toMatchObject({ type: "yesno", required: false, choices: ["Yes", "No"] });
    expect(by(rc, LEAN_Q.otherRWhich)).toMatchObject({ type: "choice", required: false, choices: [...OTHER_R_OPTIONS], when: `${LEAN_Q.otherRAsked} = Yes` });
    const idx = (l: string) => rc.findIndex((f) => f.label === l);
    expect(idx(LEAN_Q.otherRWhich)).toBe(idx(LEAN_Q.otherRAsked) + 1);
    expect(idx(LEAN_Q.otherRWhich)).toBeLessThan(idx(LEAN_Q.noPricingTick));
    expect(by(rc, LEAN_Q.noPricingTick)).toMatchObject({ required: true });
  });
  test("camera only on every form, with the help line", () => {
    for (const k of Object.keys(FORMS) as (keyof typeof FORMS)[]) {
      const p = mittiAiPrompt(k);
      expect(p).not.toMatch(/multiple files/);
      expect(p).toContain("camera only");
      expect(p).toContain(`"${LIVE_ONLY_HELP}"`);
    }
    expect(LIVE_ONLY_HELP).toBe("Take it live — uploads not allowed.");
    expect(mittiAiPrompt("ready_check")).toMatch(/can't block|cannot block/);
  });
  test("before video is video only in the prompt", () => {
    expect(mittiAiPrompt("ready_check")).toMatch(/video only/i);
  });
});

describe("A2: owner asked about a different R value (office note only)", () => {
  test("pure reader", () => {
    expect(ownerOtherRValue("Yes", "R6")).toEqual({ asked: true, r: 6, note: "Owner asked about R6" });
    expect(ownerOtherRValue("Yes", "R5")).toMatchObject({ r: 5 });
    expect(ownerOtherRValue("Yes", "R7")).toMatchObject({ r: 7 });
    expect(ownerOtherRValue("No", "R6")).toEqual({ asked: false, r: null, note: null });
    expect(ownerOtherRValue(null, null)).toEqual({ asked: null, r: null, note: null });
    expect(ownerOtherRValue("Yes", null)).toMatchObject({ asked: true, r: null });
    expect(ownerOtherRValue("Yes", null).note).toMatch(/different R value/);
  });
  test("from the stored answers", () => {
    const e = (label: string, value: string | null) => ({ label, value });
    expect(ownerOtherRFromEntries([e(LEAN_Q.otherRAsked, "Yes"), e(LEAN_Q.otherRWhich, "R7")]).note).toBe("Owner asked about R7");
    expect(ownerOtherRFromEntries([e("Something else", "x")])).toEqual({ asked: null, r: null, note: null });
  });
  test("parseAudit carries it; the sync records it as an office-only event", () => {
    n = 0;
    const p = parseAudit({ audit_id: "a", items: [it_(LEAN_Q.otherRAsked, ["Yes"]), it_(LEAN_Q.otherRWhich, ["R6"])] });
    expect(p.snapshot.map((s) => s.label)).toContain(LEAN_Q.otherRWhich);
    const srv = readFileSync("src/lib/mitti.server.ts", "utf8");
    expect(srv).toContain("applyOwnerOtherRValue(");
    expect(srv).toMatch(/OWNER_OTHER_R_EVENT[\s\S]{0,40}mitti_owner_other_r_value/);
  });
});

describe("second paste file", () => {
  const doc = readFileSync("docs/mitti-paste-2026-11-03-part8-second.md", "utf8");
  test("carries the new wording character for character, and changes nothing else", () => {
    expect(doc).toContain(`"${LEAN_Q.areaSizeHow}"`);
    for (const o of AREA_SIZE_OPTIONS) expect(doc).toContain(`"${o}"`);
    expect(doc).toContain(`"${LEAN_Q.measuredM2}"`);
    expect(doc).toContain(LEAN_Q.beforeVideo);
    expect(doc).toContain(LEAN_Q.lengthM);
    expect(doc).toContain(LEAN_Q.widthM);
    expect(doc).toContain('"A1 – Ready Check | Installer-Supplied Customer"');
    expect(doc).toContain('"A2 – Ready Check | HIVIC Sourced Customer"');
    expect(doc).toMatch(/Change nothing else[\s\S]*Publish/);
    expect(doc).not.toContain(LEAN_Q.otherRAsked); // already live
  });
});
