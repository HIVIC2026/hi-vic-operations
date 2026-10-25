// Decision 396 (Jo, 26 Oct 2026): "A5 asks both ruler photos" — the A5 Install day form asks, per ceiling area, the
// existing-insulation depth photo (areas that had insulation) and the new-insulation depth photo after install, both
// with a ruler, geotagged and timed (ESC Activity Guide v1.2 Table 4); the old "missing Ready Check photos become
// install-day photos" chase is gone. Plus the night-run fixes (A5 life support / solar from the PIESA, the warranty pack
// uses the office-confirmed product) and Jo's 26 Oct "access hatch photo kept but not mandatory". Pure, `bun test`.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  INSTALL_DAY_Q as ID, INSTALL_DAY_RULER_HELP, INSTALL_DAY_RULER_PAGE, INSTALL_DAY_RULER_Q as RQ, INSTALL_DAY_RULER_SECTION_BUTTON,
  installDayMissingQuestions, installDayPiesaFacts, installDayRulerMissingQuestions, installDayRulerPhotos, INSTALL_DAY_QUESTIONS,
} from "../src/lib/install-day.core";
import {
  INSTALL_DAY_EVIDENCE as E, AFTER_INSTALL_QUESTIONS as A, INSTALL_EVIDENCE_QUESTIONS as Q, RULER_LOCK, RULER_SECTION_MISSING, evaluateInstallEvidence, installCompletionDecision,
  installEvidenceGateLines, readInstallEvidence, rulerPhotoBlockersOf, rulerPhotoEvaluation, type JobZone,
} from "../src/lib/install-evidence.core";
import { installDayFormResult } from "../src/lib/install-day-confirm.core";
import { validateSavedDefinition } from "../src/lib/mitti-form-schema.core";
import { confirmedProductNames, decideWarrantyAttachment, installedProductOptions, warrantyFamilyForOption } from "../src/lib/product-warranty.core";
import { FORMS } from "../src/lib/mitti-forms.core";
import { LEAN_Q } from "../src/lib/ready-check-lean.core";
import { addCustomerProblems } from "../src/lib/add-customer.core";
import { installDayTemplate } from "./helpers/journey-forms";

const SIG = "2026-10-29T20:00:00Z"; // the before-work declaration signature = work start
const geo = (id: string, at: string, where: { lat?: number | null; lng?: number | null } = { lat: -38.14, lng: 145.12 }) => ({ media_id: id, captured_at: at, location: where.lat == null ? undefined : { lat: where.lat, lng: where.lng } });
let k = 0;
const item = (label: string, x: Record<string, unknown> = {}) => ({ item_id: `i${k++}`, label, ...x });
const photo = (label: string, ...files: ReturnType<typeof geo>[]) => item(label, { type: "media", media: files });
const pick = (label: string, v: string) => item(label, { type: "question", responses: { selected: [{ label: v }] } });
const tick = (label: string) => item(label, { type: "checkbox", responses: { value: true } });
const sign = (at: string) => item(ID.signature, { type: "signature", responses: { image: { media_id: "0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b", name: "Ivy Installer", timestamp: at } } });
/** One repeat copy (a container item) per ceiling area. */
const copy = (n: number, existing: ReturnType<typeof geo>[] | null, after: ReturnType<typeof geo>[] | null) =>
  ({ item_id: `copy-${n}`, label: "", children: [...(existing ? [photo(RQ.existingDepth, ...existing)] : [item(RQ.existingDepth, { type: "media", media: [] })]), ...(after ? [photo(RQ.newDepth, ...after)] : [item(RQ.newDepth, { type: "media", media: [] })])] });
/** A complete A5 apart from what the test changes: declaration, after files, sign-off, final tick. */
const a5 = (copies: unknown[]) => ({ items: [
  ...copies,
  tick(ID.declaration), sign(SIG),
  photo(E.afterVideos, geo("av1", "2026-10-30T03:00:00Z"), geo("av2", "2026-10-30T03:01:00Z")), photo(E.depthPhotos, geo("dp1", "2026-10-30T03:05:00Z"), geo("dp2", "2026-10-30T03:06:00Z")),
  pick(Q.multiDay, "No"), pick(A.lockoutRemoved, "Yes"), pick(A.lockoutRemovedBy, "Lead installer"), photo(A.switchboardAfterPhoto, geo("sw", "2026-10-30T04:00:00Z")),
  pick(A.solarRestarted, "There isn't one"), tick(A.leadPresent), tick(ID.allFilledIn), sign("2026-10-30T04:05:00Z"),
] });
const zones: JobZone[] = [
  { name: "Main house", underInsulated: true, areaM2: 100, product: "Bradford Gold R5", beforeVideo: true },
  { name: "Extension", underInsulated: false, areaM2: 20, product: "Bradford Gold R5", beforeVideo: true },
];
const before = (id: string) => geo(id, "2026-10-29T19:50:00Z");
const after = (id: string) => geo(id, "2026-10-30T03:10:00Z");
const ctx = (installDate: string) => ({ installDate, zones, multiDay: false, leadName: "Ivy Installer", solarPresent: false, existingInsulation: true });
const evalA5 = (copies: unknown[], installDate = "2026-10-29") => evaluateInstallEvidence(readInstallEvidence(a5(copies)), ctx(installDate), SIG);

describe("decision 396: the A5 ruler questions (wording, paste file, form health)", () => {
  test("decision 396: exact wording, kept out of Q1–Q48 so no question is renumbered", () => {
    expect(RQ.existingDepth).toBe("Existing insulation depth — photo with a ruler standing upright in it");
    expect(RQ.newDepth).toBe("New insulation depth after install — photo with a ruler standing upright in it");
    expect(INSTALL_DAY_QUESTIONS.at(-1)!.n).toBe(48);
    expect(INSTALL_DAY_QUESTIONS.some((q) => q.label === RQ.existingDepth || q.label === RQ.newDepth)).toBe(false);
  });
  test("decision 396: the ONE ChatGPT paste block adds only these questions to A5 (template 1f325828…) and publishes", () => {
    const doc = readFileSync("docs/mitti-paste-A5-ruler-photos.md", "utf8");
    const blocks = doc.match(/```[\s\S]*?```/g) ?? [];
    expect(blocks).toHaveLength(1);
    const b = blocks[0]!;
    expect(b).toContain("1f325828-3f71-4b1a-988f-083c83414f95");
    expect(b).toContain('"A5 – Install day"');
    for (const l of [RQ.existingDepth, RQ.newDepth, INSTALL_DAY_RULER_PAGE, INSTALL_DAY_RULER_SECTION_BUTTON, ...Object.values(INSTALL_DAY_RULER_HELP)]) expect(b).toContain(`"${l}"`);
    expect(b).toMatch(/"Existing insulation depth[^\n]*NOT required/);
    expect(b).toMatch(/"New insulation depth after install[^\n]*— Required/);
    expect(b).toContain("Change nothing else");
    expect(b.trim().split("\n").at(-2)).toContain("Publish.");
    // The full build prompt carries the same page, so a rebuild keeps it.
    const build = readFileSync("docs/MITTI_INSTALL_FORM_FIX_PROMPT.md", "utf8");
    for (const l of [RQ.existingDepth, RQ.newDepth, ...Object.values(INSTALL_DAY_RULER_HELP)]) expect(build).toContain(`\`${l}\``);
  });
  test("decision 396: a template without them can still be created (Q1–Q48 check) but form health lists them", () => {
    const tpl = { items: installDayTemplate(INSTALL_DAY_QUESTIONS).items };
    expect(installDayMissingQuestions(tpl)).toEqual([]);
    expect(installDayRulerMissingQuestions(tpl)).toEqual([RQ.existingDepth, RQ.newDepth]);
    const health = validateSavedDefinition("piisa", tpl);
    expect(health.ok).toBe(true);
    expect(health.issues.join(" ")).toContain(RQ.newDepth);
    const built = { items: [...tpl.items, { item_id: "r1", label: RQ.existingDepth, type: "media" }, { item_id: "r2", label: RQ.newDepth, type: "media" }] };
    expect(installDayRulerMissingQuestions(built)).toEqual([]);
    expect(validateSavedDefinition("piisa", built).issues).toEqual([]);
  });
});

describe("decision 396: reading the ruler photos per area", () => {
  test("decision 396: one repeat copy per area, in form order; hidden (inactive) items never read", () => {
    const r = installDayRulerPhotos(a5([copy(1, [before("e1")], [after("n1")]), copy(2, null, [after("n2")]), { ...copy(3, [before("x")], [after("x")]), inactive: true }]));
    expect(r.onForm).toBe(true);
    expect(r.areas.map((a) => [a.existing.map((f) => f.mediaId), a.after.map((f) => f.mediaId)])).toEqual([[["e1"], ["n1"]], [[], ["n2"]]]);
  });
  test("decision 396: flat forms (parent_id lists) pair by repeat parent; a form with no ruler questions is 'not on form'", () => {
    const flat = { items: [
      { item_id: "c1", label: "" }, { item_id: "x1", parent_id: "c1", label: RQ.newDepth, media: [after("n1")] }, { item_id: "x2", parent_id: "c1", label: RQ.existingDepth, media: [before("e1")] },
      { item_id: "c2", label: "" }, { item_id: "x3", parent_id: "c2", label: RQ.newDepth, media: [after("n2")] },
    ] };
    expect(installDayRulerPhotos(flat).areas.map((a) => [a.existing.length, a.after.length])).toEqual([[1, 1], [0, 1]]);
    expect(installDayRulerPhotos({ items: [item(ID.declaration)] })).toEqual({ onForm: false, areas: [] });
  });
});

describe("decision 396: the rule — Installation complete needs every area's ruler photos", () => {
  test("decision 396: complete set → nothing outstanding; the area that had no insulation needs only the new-depth photo", () => {
    const s = evalA5([copy(1, [before("e1")], [after("n1")]), copy(2, null, [after("n2")])]);
    expect(s.applies).toBe(false); // install before the decision-205 effective date — the ruler photos apply anyway
    expect(s.blockers).toEqual([]);
    expect(s.rulerPhotos?.map((a) => [a.name, a.existingRequired, a.existing.length, a.after.length])).toEqual([["Main house", true, 1, 1], ["Extension", false, 0, 1]]);
    expect(installCompletionDecision({ formCompleted: true, declarationSaved: true, summary: s, alreadyCompleted: false, allFilledInTicked: true }).record).toBe(true);
  });
  test("decision 396: a missing photo is a clear blocker naming the area — for the Mitti path, the button path, the gates and the leave-site text", () => {
    const s = evalA5([copy(1, null, [after("n1")]), copy(2, null, null)]);
    expect(s.blockers).toEqual(["Main house: existing insulation depth photo with a ruler is missing", "Extension: new insulation depth photo with a ruler is missing"]);
    const d = installCompletionDecision({ formCompleted: true, declarationSaved: true, summary: s, alreadyCompleted: false, allFilledInTicked: true });
    expect(d.record).toBe(false);
    expect(d.nextLine).toBe("Install day form: Main house: existing insulation depth photo with a ruler is missing (and 1 more item)");
    expect(rulerPhotoBlockersOf(s)).toEqual(s.blockers);
    expect(installEvidenceGateLines(s, "2026-10-29")).toEqual(s.blockers.map((b) => `Install evidence: ${b}`));
    expect(RULER_LOCK).toContain("Installation complete stays locked");
    const r = installDayFormResult({ formCompleted: true, installDayForm: true, finalTickTicked: true, declaration: { ok: true, message: "" }, summary: s });
    expect(r).toEqual({ state: "not_finished", missing: s.blockers });
  });
  test("decision 396: after the effective date the ruler lines join the rest of the install evidence", () => {
    const s = evalA5([copy(1, [before("e1")], null), copy(2, null, [after("n2")])], "2026-11-03");
    expect(s.applies).toBe(true);
    expect(s.blockers).toContain("Main house: new insulation depth photo with a ruler is missing");
    expect(s.items.filter((i) => i.id.startsWith("ruler_")).map((i) => [i.id, i.zone, i.state])).toEqual([["ruler_existing", 1, "met"], ["ruler_new", 1, "missing"], ["ruler_existing", 2, "not_required"], ["ruler_new", 2, "met"]]);
  });
  test("decision 396: geotag and capture time enforced like the other A5 photos; existing before work, new after", () => {
    const noGps = geo("g", "2026-10-30T03:10:00Z", { lat: null }), noTime = { media_id: "t", location: { lat: -38.1, lng: 145.1 } };
    const s = evalA5([copy(1, [geo("late", "2026-10-29T21:00:00Z")], [noGps]), copy(2, null, [noTime as never, before("early")])]);
    expect(s.blockers).toEqual([
      "Main house: existing insulation depth photo with a ruler: 1 taken after work started — must be taken before work starts",
      "Main house: new insulation depth photo with a ruler: location (GPS) not recorded on 1 of 1 — take it again with location on",
      "Extension: new insulation depth photo with a ruler: capture time not recorded on 1 of 2 — office review",
      "Extension: new insulation depth photo with a ruler: taken before work started — take it when the insulation is in",
    ]);
  });
  test("decision 396: unknown existing insulation is never silently exempt; no Ready Check areas = one area", () => {
    const r = rulerPhotoEvaluation(installDayRulerPhotos(a5([copy(1, null, [after("n")])])), [{ name: null, underInsulated: null }], SIG);
    expect(r.blockers).toEqual(["Main ceiling: existing insulation depth photo with a ruler is missing"]);
    expect(rulerPhotoEvaluation(installDayRulerPhotos(a5([])), [], SIG).blockers).toEqual([RULER_SECTION_MISSING]);
  });
  test("decision 396: an A5 without the ruler page holds completion with the paste instruction", () => {
    const s = evalA5([]);
    expect(s.blockers).toEqual([RULER_SECTION_MISSING]);
    expect(RULER_SECTION_MISSING).toContain("docs/mitti-paste-A5-ruler-photos.md");
    expect(installCompletionDecision({ formCompleted: true, declarationSaved: true, summary: s, alreadyCompleted: false, allFilledInTicked: true }).record).toBe(false);
  });
  test("decision 396: 'All filled in — you can leave site' depends only on the A5 itself", () => {
    const s = evalA5([copy(1, [before("e1")], [after("n1")]), copy(2, null, [after("n2")])]);
    expect(installDayFormResult({ formCompleted: true, installDayForm: true, finalTickTicked: true, declaration: { ok: true, message: "" }, summary: s }).state).toBe("all_filled_in");
    expect(installDayFormResult({ formCompleted: true, installDayForm: true, finalTickTicked: false, declaration: { ok: true, message: "" }, summary: s }).state).toBe("not_finished");
  });
});

describe("night run 25 Oct 2026: A5 life support / solar from the PIESA", () => {
  test("the signed PIESA first, then the stored A3 answers; the owner's declaration only for life support; any Yes wins", () => {
    expect(installDayPiesaFacts({ piesaAnswers: { lifeSupport: "No", "p3.present": "No" }, a3Short: null, lifeSupportDeclared: null })).toEqual({ lifeSupport: false, solarPresent: false });
    expect(installDayPiesaFacts({ piesaAnswers: null, a3Short: { lifeSupportPresent: "No", solarPresent: "Yes" }, lifeSupportDeclared: "unknown" })).toEqual({ lifeSupport: false, solarPresent: true });
    expect(installDayPiesaFacts({ piesaAnswers: { lifeSupport: "No" }, a3Short: null, lifeSupportDeclared: "yes" }).lifeSupport).toBe(true);
    expect(installDayPiesaFacts({ piesaAnswers: null, a3Short: null, lifeSupportDeclared: null })).toEqual({ lifeSupport: null, solarPresent: null });
  });
});

describe("night run 25 Oct 2026: the warranty pack uses the office-confirmed actual product", () => {
  test("confirmed products (label review) win over the quoted / install-day option", () => {
    const names = confirmedProductNames("Knauf | Earthwool Ceiling Batt R5.0 | R5");
    expect(names).toEqual(["Knauf Earthwool Ceiling Batt R5.0"]);
    expect(installedProductOptions({ installDayProducts: ["Bradford Gold R5"], readyCheckProduct: "Bradford Gold R5", confirmedProducts: names })).toEqual(names);
    expect(warrantyFamilyForOption(names[0])).toBe("earthwool");
    expect(decideWarrantyAttachment(names, () => true).attach.map((w) => w.productName)).toEqual(["Earthwool"]);
    expect(confirmedProductNames("Bradford | Gold Ceiling Batt R5.0 | R5\nBradford | Gold Ceiling Batt R5.0 | R5")).toEqual(["Bradford Gold Ceiling Batt R5.0"]);
    expect(installedProductOptions({ installDayProducts: [], readyCheckProduct: "Bradford Gold R5", confirmedProducts: [] })).toEqual(["Bradford Gold R5"]);
    expect(warrantyFamilyForOption("Bradford Optimo R5")).toBeNull();
  });
});

describe("Jo 26 Oct 2026: the A1/A2 ceiling access (hatch) photo is kept but not mandatory", () => {
  test("the portal never requires or chases it", () => {
    for (const f of ["ready_check", "ready_check_priced"] as const) expect(FORMS[f].fields.find((x) => x.label === LEAN_Q.accessPhoto)).toMatchObject({ required: false });
    const area = { name: "Main", length: "10", width: "8", existing: false, type: "", depth: "", depthPhoto: null, action: null, downlights: "", hazards: "", hazardPhoto: null };
    const p = addCustomerProblems({ owner: { full_name: "Ann Owner", email: "a@b.co", phone: "0400000000", address_line: "1 Test St", rough: "" }, progress: "measured", areas: [area], how: "tape", roof5: false, sketch: true, access: false, lines: [{ code: "R5_BATTS", qty: 80 }], agreed: null });
    expect(p).toEqual([]);
  });
  test("the paste file sets it NOT required on both A1 and A2 and changes nothing else", () => {
    const doc = readFileSync("docs/mitti-paste-A1-A2-hatch-optional.md", "utf8");
    const b = (doc.match(/```[\s\S]*?```/g) ?? [])[0]!;
    expect(b).toContain("01ee0428-be6d-4435-b34d-8b738935f099");
    expect(b).toContain("dbaf67a2-c9c5-4120-8c69-0f4a43c5bd39");
    expect(b).toContain(`"${LEAN_Q.accessPhoto}"`);
    expect(b).toContain("NOT required");
    expect(b).toContain("Change nothing else. Publish both.");
  });
});
