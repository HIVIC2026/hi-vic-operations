// Decision 324 (Jo 25 Oct 2026: "the whole quoting part for electrician is clunky" → ONE list). The A4 Repair work page asks
// the plain tick list (+ counts / Other), then the total price LAST. "Please tick the repair work that is required." and
// "Please describe the other repair work." are no longer asked: the official PIESA B2 ticks and "Other (indicate below)"
// details are DERIVED from the plain list. Old forms that answered the official ticks keep them exactly as before.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { B2_OPTIONS } from "../src/lib/official-forms.core";
import {
  FIXES_OTHER_LABEL, FIXES_PRICE_LABEL, FIXES_TO_B2, FIXES_WORK_LABEL, FIXES_WORK_OPTIONS, RECTIFICATION_OUTCOMES, REPAIR_OTHER_LEGACY_LABEL,
  REPAIR_TICKS_LEGACY_LABEL, SHORT_PIESA_FIELDS, derivedRepairTicks, shortAnswersFromEntries,
} from "../src/lib/official-short.core";
import { expandPiesa } from "../src/lib/official-expand.core";
import { mittiAiPrompt, validateTemplate } from "../src/lib/mitti-forms.core";
import { fixesFormNeeded, repairWorkList } from "../src/lib/fixes-day.core";
import { fixesTimesNeeded } from "../src/lib/fixes-times.core";
import { fixesPriceSource } from "../src/lib/fixes-price.core";

const NEEDED = "Is any electrical repair work needed before insulation can be installed?";
const ctx = { lifeSupportDeclared: "no" as const, today: "2026-10-25", ownerConfirmation: null };
const [DL, RCD, BRK, TPS, SECURE, JOIN, MAINS, OLD, SOLAR, ONSITE, OTHER] = FIXES_WORK_OPTIONS;
const sync = (work: string, extra: { label: string; value: string }[] = []) =>
  shortAnswersFromEntries("piesa", [{ label: NEEDED, value: "Yes" }, { label: FIXES_WORK_LABEL, value: work }, ...extra]);

describe("decision 324: one plain repair list, price last", () => {
  test("the two official-tick questions are legacy (read, never asked); the price is the last repair question", () => {
    for (const label of [REPAIR_TICKS_LEGACY_LABEL, REPAIR_OTHER_LEGACY_LABEL]) {
      expect(SHORT_PIESA_FIELDS.find((f) => f.label === label)).toMatchObject({ required: false, portalOnly: true });
      expect(mittiAiPrompt("piesa")).not.toContain(label);
      expect(validateTemplate("piesa", [{ label, type: "list" }]).issues).not.toContain(`Missing: ${label}`);
    }
    const ids = SHORT_PIESA_FIELDS.map((f) => f.id);
    expect(ids.indexOf("fixesWork")).toBeLessThan(ids.indexOf("fixesOtherDetail"));
    expect(ids.indexOf("fixesOtherDetail")).toBeLessThan(ids.indexOf("fixesPriceIncGst"));
    const prompt = mittiAiPrompt("piesa");
    expect(prompt.indexOf(FIXES_WORK_LABEL)).toBeLessThan(prompt.indexOf(FIXES_PRICE_LABEL));
  });
  test("every plain option maps as Jo set out; 'Be on site' adds no B2 tick", () => {
    expect(FIXES_TO_B2[DL]).toBe(B2_OPTIONS[0]);
    expect(FIXES_TO_B2[RCD]).toBe(B2_OPTIONS[2]);
    expect(FIXES_TO_B2[BRK]).toBe(B2_OPTIONS[1]);
    expect(FIXES_TO_B2[TPS]).toBe(B2_OPTIONS[3]);
    for (const o of [SECURE, JOIN, OLD]) expect(FIXES_TO_B2[o]).toBe(B2_OPTIONS[4]);
    for (const o of [MAINS, SOLAR, OTHER]) expect(FIXES_TO_B2[o]).toBe(B2_OPTIONS[5]);
    expect(FIXES_TO_B2[ONSITE]).toBeNull();
  });
  test("derived ticks are in the official order, de-duplicated; Other details = plain names + the description", () => {
    const short = { fixesWork: `${OTHER}, ${SOLAR}, ${JOIN}, ${SECURE}, ${RCD}, ${DL}, ${MAINS}`, fixesOtherDetail: "Fit a junction box cover" };
    expect(derivedRepairTicks(short)).toEqual({
      work: [B2_OPTIONS[0], B2_OPTIONS[2], B2_OPTIONS[4], B2_OPTIONS[5]],
      other: `${MAINS}; ${SOLAR}; Fit a junction box cover`,
    });
    expect(derivedRepairTicks({ fixesWork: ONSITE })).toEqual({ work: [], other: "" });
  });
  test("a new form: the official PIESA B2 is filled from the plain list", () => {
    const short = sync(`${DL}, ${BRK}, ${OTHER}`, [{ label: "How many downlights are you replacing?", value: "6" }, { label: `${FIXES_OTHER_LABEL}\nSay exactly what you'll do, where, and how many.`, value: "Move the smoke alarm cable" }]);
    expect(short["rectificationOutcome"]).toBe(RECTIFICATION_OUTCOMES[1]);
    expect(short["rectificationWork"]).toBe([B2_OPTIONS[0], B2_OPTIONS[1], B2_OPTIONS[5]].join(" | "));
    expect(short["rectificationOther"]).toBe("Move the smoke alarm cable");
    const e = expandPiesa({ ...short, "b3.declaration": "true" }, ctx);
    expect(e.answers["b2"]).toEqual([B2_OPTIONS[0], B2_OPTIONS[1], B2_OPTIONS[5]]);
    expect(e.answers["b2.other"]).toBe("Move the smoke alarm cable");
    expect(e.flagged).not.toContain("Electrical fixes: the required work isn't ticked.");
    expect(e.flagged).not.toContain("Electrical fixes: 'Other' is ticked but not described.");
  });
  test("expandPiesa derives on its own too (short answers without the official ticks)", () => {
    const e = expandPiesa({ rectificationOutcome: RECTIFICATION_OUTCOMES[1], fixesWork: `${TPS}, ${MAINS}`, "b3.declaration": "true" }, ctx);
    expect(e.answers["b2"]).toEqual([B2_OPTIONS[3], B2_OPTIONS[5]]);
    expect(e.answers["b2.other"]).toBe(MAINS);
  });
  test("Other ticked with no description and nothing else under Other → the existing office flag", () => {
    const e = expandPiesa({ ...sync(`${RCD}, ${OTHER}`), "b3.declaration": "true" }, ctx);
    expect(e.answers["b2"]).toEqual([B2_OPTIONS[2], B2_OPTIONS[5]]);
    expect(e.flagged).toContain("Electrical fixes: 'Other' is ticked but not described.");
  });
  test("an old form that answered the official ticks keeps them exactly as before", () => {
    const short = sync(`${DL}, ${RCD}`, [{ label: REPAIR_TICKS_LEGACY_LABEL, value: B2_OPTIONS[4] }]);
    expect(short["rectificationWork"]).toBe(B2_OPTIONS[4]);
    expect(expandPiesa({ ...short, "b3.declaration": "true" }, ctx).answers["b2"]).toEqual([B2_OPTIONS[4]]);
    const older = shortAnswersFromEntries("piesa", [{ label: NEEDED, value: "Yes" }, { label: REPAIR_TICKS_LEGACY_LABEL, value: B2_OPTIONS[5] }, { label: REPAIR_OTHER_LEGACY_LABEL, value: "Loose junction box" }]);
    expect(repairWorkList(older)).toEqual(["Other: Loose junction box"]);
  });
  test("downstream readers use the derived ticks: A5 repair list, fixes form, fixes times, fixes price", () => {
    const short = sync(`${DL}, ${SOLAR}`, [{ label: "How many downlights are you replacing?", value: "4" }, { label: FIXES_PRICE_LABEL, value: "$880" }]);
    expect(repairWorkList(short)).toEqual([B2_OPTIONS[0], `Other: ${SOLAR}`]);
    expect(fixesFormNeeded(short)).toBe(true);
    expect(fixesTimesNeeded(short)).toBe(true);
    expect(fixesPriceSource(short)).toMatchObject({ path: "a4_price", electricianPriceIncGst: 880 });
    // "Be on site" alone: no B2 tick, the electrician-present outcome, no fixes visit (decision 314 unchanged)
    const onsite = sync(ONSITE);
    expect(onsite["rectificationWork"]).toBeUndefined();
    expect(onsite["rectificationOutcome"]).toBe(RECTIFICATION_OUTCOMES[2]);
    expect(fixesFormNeeded(onsite)).toBe(false);
  });
  test("the three A4 docs carry the new order and tell Jo to delete the two questions", () => {
    for (const f of ["docs/MITTI_PIESA_CHATGPT_PROMPT.md", "docs/MITTI_PIESA_BUILD_PROMPT.md", "docs/MITTI_PIESA_FORM_SPEC.md"]) {
      const doc = readFileSync(f, "utf8");
      expect(doc, f).toContain("Decision 324");
      expect(doc.indexOf(FIXES_WORK_LABEL), f).toBeLessThan(doc.indexOf(FIXES_PRICE_LABEL));
      for (const l of [REPAIR_TICKS_LEGACY_LABEL, REPAIR_OTHER_LEGACY_LABEL]) expect(doc, `${f}: ${l}`).toContain(l);
    }
  });
});
