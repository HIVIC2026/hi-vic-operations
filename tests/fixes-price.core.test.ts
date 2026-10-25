// Decision 305 (Jo 25 Oct 2026): the owner's fixes quote comes from the electrician's ONE total on the A4 PIESA form.
import { describe, expect, test } from "bun:test";
import { A4_FIXES_LINE_DESCRIPTION, buildA4FixesQuote, fixesPriceSource, parseFixesPrice } from "../src/lib/fixes-price.core";
import { RECTIFICATION_MARGIN_INC_GST } from "../src/lib/rectification-pricing.core";
import { expandPiesa } from "../src/lib/official-expand.core";
import { SHORT_PIESA_FIELDS, FIXES_PRICE_LABEL, FIXES_INCLUDED_LABEL, FIXES_INCLUDED_HELP } from "../src/lib/official-short.core";
import { readFileSync } from "node:fs";

describe("parseFixesPrice", () => {
  test.each([
    ["1234.5", 1234.5], ["$1,234.50", 1234.5], ["1 234", 1234], ["$1,234.50 inc GST", 1234.5], ["AUD 900", 900],
    ["  850 ", 850], ["$12,345", 12345], ["1234.50 incl. GST", 1234.5], [650, 650],
  ] as const)("%p → %p", (raw, n) => expect(parseFixesPrice(raw)).toBe(n));
  test.each([["", null], ["0", null], ["-50", null], ["abc", null], ["100 or 200", null], ["1,23", null], ["12.345", null], ["200000", null], [null, null], [Number.NaN, null], [0, null]] as const)(
    "%p is refused", (raw, n) => expect(parseFixesPrice(raw)).toBe(n));
});

describe("fixesPriceSource", () => {
  test("price + included text → the A4 path", () => {
    expect(fixesPriceSource({ fixesPriceIncGst: "$1,234.50", fixesIncluded: "  Replace 6 downlights with IC-4 LEDs, install 1 RCD " }))
      .toEqual({ path: "a4_price", electricianPriceIncGst: 1234.5, included: "Replace 6 downlights with IC-4 LEDs, install 1 RCD" });
  });
  test("old forms (no price, no text) keep the rate card", () => {
    expect(fixesPriceSource({}).path).toBe("rate_card");
    expect(fixesPriceSource(null).path).toBe("rate_card");
  });
  test("a price without what it covers, an unreadable or a zero price never builds the quote", () => {
    expect(fixesPriceSource({ fixesPriceIncGst: "900" })).toEqual({ path: "rate_card", reason: "The PIESA form has a repair price but not what it includes" });
    expect(fixesPriceSource({ fixesPriceIncGst: "about 900", fixesIncluded: "RCD" }).path).toBe("rate_card");
    expect(fixesPriceSource({ fixesPriceIncGst: "0", fixesIncluded: "RCD" }).path).toBe("rate_card");
    expect(fixesPriceSource({ fixesIncluded: "RCD" }).path).toBe("rate_card");
  });
});

describe("buildA4FixesQuote", () => {
  test("one line, electrician price + the decision-142 margin, cost = price ex GST", () => {
    const q = buildA4FixesQuote({ electricianPriceIncGst: 1100, included: "Install 1 RCD", gstRate: 0.1 });
    expect(q.lines).toHaveLength(1);
    expect(q.lines[0]).toMatchObject({ description: A4_FIXES_LINE_DESCRIPTION, explanation: "Install 1 RCD", quantity: 1, unit: "flat", is_other: false, code: null });
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
});

describe("A4 form fields (decision 305)", () => {
  test("placed right after 'describe the other repair work', required, shown only when repair work is needed", () => {
    const i = SHORT_PIESA_FIELDS.findIndex((f) => f.id === "rectificationOther");
    expect(SHORT_PIESA_FIELDS[i + 1]).toMatchObject({ id: "fixesPriceIncGst", label: FIXES_PRICE_LABEL, type: "number", required: true, when: "rectificationNeeded = Yes" });
    expect(SHORT_PIESA_FIELDS[i + 2]).toMatchObject({ id: "fixesIncluded", label: FIXES_INCLUDED_LABEL, type: "text", required: true, when: "rectificationNeeded = Yes" });
  });
  test("the three A4 docs carry both questions and the help text verbatim", () => {
    for (const f of ["docs/MITTI_PIESA_CHATGPT_PROMPT.md", "docs/MITTI_PIESA_BUILD_PROMPT.md", "docs/MITTI_PIESA_FORM_SPEC.md"]) {
      const doc = readFileSync(f, "utf8");
      for (const s of [FIXES_PRICE_LABEL, FIXES_INCLUDED_LABEL, FIXES_INCLUDED_HELP]) expect(doc, `${f}: ${s}`).toContain(s);
    }
  });
  test("expandPiesa ignores them: the official PIESA output is identical with or without the price", () => {
    const base = { rectificationOutcome: "Yes, repair work is needed", rectificationWork: "Other (indicate below):", rectificationOther: "Fix", "b3.declaration": "true" };
    const ctx = { lifeSupportDeclared: "no" as const, today: "2026-10-25", ownerConfirmation: null };
    const a = expandPiesa(base, ctx);
    const b = expandPiesa({ ...base, fixesPriceIncGst: "$900", fixesIncluded: "Install 1 RCD" }, ctx);
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).not.toContain("Install 1 RCD");
  });
});
