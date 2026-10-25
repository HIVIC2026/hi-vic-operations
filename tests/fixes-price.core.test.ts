// Decision 305 (Jo 25 Oct 2026): the owner's fixes quote comes from the electrician's ONE total on the A4 PIESA form.
// Decision 308: what the price includes is TICKED (with counts / Other detail); the decision-305 free text is the fallback.
// Decision 313: no $100 margin on installer-supplied jobs (A1).
import { describe, expect, test } from "bun:test";
import { A4_FIXES_LINE_DESCRIPTION, buildA4FixesQuote, describeFixesWork, fixesMarginFor, fixesPriceSource, fixesWorkTicks, parseFixesCount, parseFixesPrice } from "../src/lib/fixes-price.core";
import { RECTIFICATION_MARGIN_INC_GST } from "../src/lib/rectification-pricing.core";
import { expandPiesa } from "../src/lib/official-expand.core";
import {
  SHORT_PIESA_FIELDS, FIXES_PRICE_LABEL, FIXES_INCLUDED_LABEL, FIXES_WORK_LABEL, FIXES_WORK_OPTIONS, FIXES_WORK_READ_OPTIONS, FIXES_DOWNLIGHT_COUNT_LABEL, ONSITE_START_LABEL,
  FIXES_RCD_COUNT_LABEL, FIXES_OTHER_LABEL, FIXES_OTHER_HELP, shortAnswersFromEntries,
} from "../src/lib/official-short.core";
import { mittiAiPrompt } from "../src/lib/mitti-forms.core";
import { readFileSync } from "node:fs";

// Decision 338: the read list keeps the retired on-site tick (old forms); the asked list has the other ten.
const [DL, RCD, BREAKERS, , , , MAINS, , , ONSITE, OTHER] = FIXES_WORK_READ_OPTIONS;

describe("parseFixesPrice", () => {
  test.each([
    ["1234.5", 1234.5], ["$1,234.50", 1234.5], ["1 234", 1234], ["$1,234.50 inc GST", 1234.5], ["AUD 900", 900],
    ["  850 ", 850], ["$12,345", 12345], ["1234.50 incl. GST", 1234.5], [650, 650],
  ] as const)("%p → %p", (raw, n) => expect(parseFixesPrice(raw)).toBe(n));
  test.each([["", null], ["0", null], ["-50", null], ["abc", null], ["100 or 200", null], ["1,23", null], ["12.345", null], ["200000", null], [null, null], [Number.NaN, null], [0, null]] as const)(
    "%p is refused", (raw, n) => expect(parseFixesPrice(raw)).toBe(n));
});

describe("decision 308 ticks", () => {
  test("the ten options (decision 338 moved 'Be on site…' to its own question), exactly as given to Jo", () => {
    expect([...FIXES_WORK_OPTIONS]).toEqual([
      "Replace downlights with IC-4 rated LED downlights", "Install RCD safety switches", "Upgrade circuit protection (breakers) for insulation",
      "Replace old cables with TPS cable", "Secure and support loose cables in the ceiling", "Repair or replace damaged connections or junction boxes",
      "Identify and mark the mains cable in the ceiling", "Remove or make safe old unused cables", "Label and protect solar or battery cables in the ceiling", "Other",
    ]);
    expect(FIXES_WORK_READ_OPTIONS[9]).toBe("Be on site at the start of the install day");
  });
  test("decision 338: the on-site question (Yes) is described exactly like the old tick", () => {
    expect(fixesPriceSource({ fixesPriceIncGst: "650", onsiteStartNeeded: "Yes" })).toEqual({ path: "a4_price", electricianPriceIncGst: 650, included: "Be on site at the start of the install day" });
    expect(fixesPriceSource({ fixesPriceIncGst: "650", fixesWork: `${RCD}, Other`, fixesRcdCount: "1", fixesOtherDetail: "Move cable", onsiteStartNeeded: "Yes" })).toEqual({ path: "a4_price", electricianPriceIncGst: 650, included: "Install 1 RCD safety switch; Be on site at the start of the install day; Other: Move cable" });
    expect(fixesPriceSource({ fixesPriceIncGst: "650", fixesWork: RCD, fixesRcdCount: "2", onsiteStartNeeded: "No" })).toEqual({ path: "a4_price", electricianPriceIncGst: 650, included: "Install 2 RCD safety switches" });
  });
  test("ticks read from Mitti's ', ' join, ' | ', arrays; in form order; Other only as its own answer", () => {
    expect(fixesWorkTicks(`${RCD}, ${DL}`)).toEqual([DL, RCD]);
    expect(fixesWorkTicks(`${MAINS} | Other`)).toEqual([MAINS, OTHER]);
    expect(fixesWorkTicks([BREAKERS, "other"])).toEqual([BREAKERS, OTHER]);
    expect(fixesWorkTicks("Remove or make safe old unused cables")).toEqual(["Remove or make safe old unused cables"]);
    expect(fixesWorkTicks("")).toEqual([]);
    expect(fixesWorkTicks(null)).toEqual([]);
    expect(fixesWorkTicks("something else")).toEqual([]);
  });
  test("decision 314: the on-site tick is listed as is in the explanation", () => {
    expect(fixesPriceSource({ fixesPriceIncGst: "650", fixesWork: `${ONSITE}` })).toEqual({ path: "a4_price", electricianPriceIncGst: 650, included: "Be on site at the start of the install day" });
    expect(fixesWorkTicks(`${RCD}, ${ONSITE}, Other`)).toEqual([RCD, ONSITE, OTHER]);
  });
  test("counts are whole numbers 1–500, never guessed", () => {
    expect(parseFixesCount("6")).toBe(6); expect(parseFixesCount(" 12 ")).toBe(12); expect(parseFixesCount("6.0")).toBe(6); expect(parseFixesCount(3)).toBe(3);
    for (const bad of ["", "0", "-1", "six", "2.5", "1000", null, undefined]) expect(parseFixesCount(bad)).toBeNull();
  });
  test("the explanation: ticks in form order with quantities written in", () => {
    expect(describeFixesWork({ ticks: [DL, RCD, OTHER], downlights: 6, rcds: 1, other: "Move the smoke alarm cable" }))
      .toBe("Replace 6 downlights with IC-4 rated LED downlights; Install 1 RCD safety switch; Other: Move the smoke alarm cable");
    expect(describeFixesWork({ ticks: [DL, RCD, MAINS], downlights: 1, rcds: 2, other: "" }))
      .toBe("Replace 1 downlight with an IC-4 rated LED downlight; Install 2 RCD safety switches; Identify and mark the mains cable in the ceiling");
  });
});

describe("fixesPriceSource", () => {
  test("price + ticks (with counts and Other) → the A4 path, explanation from the ticks", () => {
    expect(fixesPriceSource({ fixesPriceIncGst: "$1,234.50", fixesWork: `${DL}, ${RCD}, Other`, fixesDownlightCount: "6", fixesRcdCount: "1", fixesOtherDetail: "  Move the smoke alarm cable " }))
      .toEqual({ path: "a4_price", electricianPriceIncGst: 1234.5, included: "Replace 6 downlights with IC-4 rated LED downlights; Install 1 RCD safety switch; Other: Move the smoke alarm cable" });
    expect(fixesPriceSource({ fixesPriceIncGst: "900", fixesWork: BREAKERS })).toEqual({ path: "a4_price", electricianPriceIncGst: 900, included: BREAKERS });
  });
  test("a ticked downlight/RCD/Other without its detail falls back to the rate card", () => {
    expect(fixesPriceSource({ fixesPriceIncGst: "900", fixesWork: DL })).toEqual({ path: "rate_card", reason: "The PIESA form ticks downlights but not how many are being replaced" });
    expect(fixesPriceSource({ fixesPriceIncGst: "900", fixesWork: RCD, fixesRcdCount: "lots" })).toEqual({ path: "rate_card", reason: "The PIESA form ticks RCD safety switches but not how many are being installed" });
    expect(fixesPriceSource({ fixesPriceIncGst: "900", fixesWork: "Other", fixesOtherDetail: " " })).toEqual({ path: "rate_card", reason: "The PIESA form ticks Other but does not describe the other work" });
    // the free text never rescues an incomplete tick answer
    expect(fixesPriceSource({ fixesPriceIncGst: "900", fixesWork: DL, fixesIncluded: "6 downlights" }).path).toBe("rate_card");
  });
  test("old decision-305 forms: the free text is still read as the fallback", () => {
    expect(fixesPriceSource({ fixesPriceIncGst: "$1,234.50", fixesIncluded: "  Replace 6 downlights with IC-4 LEDs, install 1 RCD " }))
      .toEqual({ path: "a4_price", electricianPriceIncGst: 1234.5, included: "Replace 6 downlights with IC-4 LEDs, install 1 RCD" });
  });
  test("old forms (no price, nothing included) keep the rate card", () => {
    expect(fixesPriceSource({})).toEqual({ path: "rate_card", reason: "The PIESA form has no repair price (older form)" });
    expect(fixesPriceSource(null).path).toBe("rate_card");
  });
  test("no ticks, an unreadable or a zero price never builds the quote", () => {
    expect(fixesPriceSource({ fixesPriceIncGst: "900" })).toEqual({ path: "rate_card", reason: "The PIESA form has a repair price but not what it includes" });
    expect(fixesPriceSource({ fixesPriceIncGst: "about 900", fixesWork: BREAKERS }).path).toBe("rate_card");
    expect(fixesPriceSource({ fixesPriceIncGst: "0", fixesWork: BREAKERS }).path).toBe("rate_card");
    expect(fixesPriceSource({ fixesWork: BREAKERS })).toEqual({ path: "rate_card", reason: "The PIESA form has no repair price" });
  });
  test("end to end from Mitti entries (help text on its own line)", () => {
    const short = shortAnswersFromEntries("piesa", [
      { label: "Is any electrical repair work needed before insulation can be installed?", value: "Yes" },
      { label: FIXES_PRICE_LABEL, value: "1100" },
      { label: FIXES_WORK_LABEL, value: `${DL}, Other` },
      { label: FIXES_DOWNLIGHT_COUNT_LABEL, value: "4" },
      { label: `${FIXES_OTHER_LABEL}\n${FIXES_OTHER_HELP}`, value: "Fit a new junction box above the laundry" },
    ]);
    expect(fixesPriceSource(short)).toEqual({ path: "a4_price", electricianPriceIncGst: 1100, included: "Replace 4 downlights with IC-4 rated LED downlights; Other: Fit a new junction box above the laundry" });
  });
});

describe("buildA4FixesQuote", () => {
  test("one line, electrician price + the decision-142 margin, cost = price ex GST", () => {
    const q = buildA4FixesQuote({ electricianPriceIncGst: 1100, included: "Install 1 RCD safety switch", gstRate: 0.1 });
    expect(q.lines).toHaveLength(1);
    expect(q.lines[0]).toMatchObject({ description: A4_FIXES_LINE_DESCRIPTION, explanation: "Install 1 RCD safety switch", quantity: 1, unit: "flat", is_other: false, code: null });
    expect(q.subtotalIncGst).toBe(1100 + RECTIFICATION_MARGIN_INC_GST);
    expect(q.lines[0]!.line_total_inc_gst).toBe(q.subtotalIncGst);
    expect(q.costExGst).toBe(1000);
    expect(q.electricianPriceIncGst).toBe(1100);
    expect(q.marginIncGst).toBe(RECTIFICATION_MARGIN_INC_GST);
  });
  test("cents survive", () => {
    const q = buildA4FixesQuote({ electricianPriceIncGst: 1234.5, included: "x", gstRate: 0.1 });
    expect(q.subtotalIncGst).toBe(1334.5);
    expect(q.costExGst).toBe(1122.27);
  });
  test("decision 313: margin 0 = the electrician's price as is", () => {
    const q = buildA4FixesQuote({ electricianPriceIncGst: 1234.5, included: "x", gstRate: 0.1, margin: 0 });
    expect(q.lines).toHaveLength(1);
    expect(q.subtotalIncGst).toBe(1234.5);
    expect(q.lines[0]!.unit_price_inc_gst).toBe(1234.5);
    expect(q.marginIncGst).toBe(0);
  });
  test("decision 351: the margin follows WHOSE electrician on both routes — installer's own = pass-through, ours = +$100", () => {
    // installer's own / usual / nominated electrician (A1 or A2) → no markup ever
    expect(fixesMarginFor("installer_usual")).toBe(0);
    // our (HIV-supplied) electrician → +$100 (decision 142), including on A1 jobs
    expect(fixesMarginFor("ours")).toBe(RECTIFICATION_MARGIN_INC_GST);
    expect(fixesMarginFor()).toBe(RECTIFICATION_MARGIN_INC_GST);
    expect(RECTIFICATION_MARGIN_INC_GST).toBe(100);
    // A4 price $1,180 (not a fixed figure): usual → $1,180 exactly; ours → $1,280; trade cost is the electrician's price either way
    const usual = buildA4FixesQuote({ electricianPriceIncGst: 1180, included: "x", gstRate: 0.1, margin: fixesMarginFor("installer_usual") });
    const ours = buildA4FixesQuote({ electricianPriceIncGst: 1180, included: "x", gstRate: 0.1, margin: fixesMarginFor("ours") });
    expect(usual.subtotalIncGst).toBe(1180);
    expect(ours.subtotalIncGst).toBe(1280);
    expect(usual.costExGst).toBe(ours.costExGst);
  });
});

describe("A4 form fields (decisions 305/308)", () => {
  test("decision 324: right after 'repair needed?' (and the 309 legacy) — the ticks, the two counts, Other, then the total price LAST", () => {
    const i = SHORT_PIESA_FIELDS.findIndex((f) => f.id === "rectificationPossible");
    // Decision 338: the tick list is no longer Required (it may be empty when the only work is being on site at the start).
    expect(SHORT_PIESA_FIELDS[i + 1]).toMatchObject({ id: "fixesWork", label: "What will you do? Tick everything included in your price.", type: "multichoice", required: false, choices: [...FIXES_WORK_OPTIONS], when: "rectificationNeeded = Yes" });
    expect(SHORT_PIESA_FIELDS[i + 2]).toMatchObject({ id: "fixesDownlightCount", label: "How many downlights are you replacing?", type: "number", required: true });
    expect(SHORT_PIESA_FIELDS[i + 2]!.when).toContain(DL);
    expect(SHORT_PIESA_FIELDS[i + 3]).toMatchObject({ id: "fixesRcdCount", label: "How many RCD safety switches are you installing?", type: "number", required: true });
    expect(SHORT_PIESA_FIELDS[i + 3]!.when).toContain(RCD);
    expect(SHORT_PIESA_FIELDS[i + 4]).toMatchObject({ id: "fixesOtherDetail", label: "Describe the other work", type: "text", required: true });
    // Decision 338: "Does an electrician need to be on site at the start of the install?" right after Other, before the price.
    expect(SHORT_PIESA_FIELDS[i + 5]).toMatchObject({ id: "onsiteStartNeeded", label: ONSITE_START_LABEL, type: "yesno", required: true, choices: ["Yes", "No"], when: "rectificationNeeded = Yes" });
    expect(ONSITE_START_LABEL).toBe("Does an electrician need to be on site at the start of the install?");
    expect(SHORT_PIESA_FIELDS[i + 6]).toMatchObject({ id: "fixesPriceIncGst", label: FIXES_PRICE_LABEL, type: "number", required: true, when: "rectificationNeeded = Yes" });
    expect(FIXES_OTHER_HELP).toBe("Say exactly what you'll do, where, and how many.");
  });
  test("the decision-305 free text is legacy: read, never asked", () => {
    const f = SHORT_PIESA_FIELDS.find((x) => x.id === "fixesIncluded")!;
    expect(f).toMatchObject({ required: false, portalOnly: true });
    expect(mittiAiPrompt("piesa")).not.toContain(FIXES_INCLUDED_LABEL);
    expect(mittiAiPrompt("piesa")).toContain(FIXES_WORK_LABEL);
  });
  test("the three A4 docs carry every new question, the options, the help text and the fallback instruction", () => {
    for (const f of ["docs/MITTI_PIESA_CHATGPT_PROMPT.md", "docs/MITTI_PIESA_BUILD_PROMPT.md", "docs/MITTI_PIESA_FORM_SPEC.md"]) {
      const doc = readFileSync(f, "utf8");
      for (const s of [FIXES_PRICE_LABEL, FIXES_WORK_LABEL, ...FIXES_WORK_OPTIONS, FIXES_DOWNLIGHT_COUNT_LABEL, FIXES_RCD_COUNT_LABEL, FIXES_OTHER_LABEL, FIXES_OTHER_HELP, "Only if you ticked", "all these grey"]) expect(doc, `${f}: ${s}`).toContain(s);
    }
  });
  test("expandPiesa ignores them: the official PIESA output is identical with or without the price and ticks", () => {
    const base = { rectificationOutcome: "Yes, repair work is needed", rectificationWork: "Other (indicate below):", rectificationOther: "Fix", "b3.declaration": "true" };
    const ctx = { lifeSupportDeclared: "no" as const, today: "2026-10-25", ownerConfirmation: null };
    const a = expandPiesa(base, ctx);
    const b = expandPiesa({ ...base, fixesPriceIncGst: "$900", fixesIncluded: "Install 1 RCD", fixesWork: `${DL}, ${RCD}, Other`, fixesDownlightCount: "6", fixesRcdCount: "1", fixesOtherDetail: "Smoke alarm cable" }, ctx);
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).not.toContain("Install 1 RCD");
    expect(JSON.stringify(b)).not.toContain("Smoke alarm cable");
  });
});
