import { describe, expect, test } from "bun:test";
import { applyRectificationMargin, RECTIFICATION_MARGIN_INC_GST, type RectificationLine } from "../src/lib/rectification-pricing.core";

const line = (over: Partial<RectificationLine>): RectificationLine => ({ code: "SW", description: "Switch", quantity: 2, unit: "each", unit_price_inc_gst: 110, line_total_inc_gst: 220, is_other: false, explanation: null, sort: 1, ...over });
const total = (ls: RectificationLine[]) => Math.round(ls.reduce((a, l) => a + l.line_total_inc_gst, 0) * 100) / 100;

describe("electrical fixes margin (decision 142)", () => {
  test("$100 spread in proportion across every line, no HIV line, total never under +$100", () => {
    const input = [line({ code: "CALLOUT", description: "Call-out", quantity: 1, unit: "flat", unit_price_inc_gst: 165, line_total_inc_gst: 165, sort: 0 }), line({}), line({ code: "JB", description: "Junction box", quantity: 3, unit_price_inc_gst: 33.3, line_total_inc_gst: 99.9, sort: 2 })];
    const out = applyRectificationMargin(input);
    expect(RECTIFICATION_MARGIN_INC_GST).toBe(100);
    expect(out.length).toBe(3);
    expect(out.some((l) => /insulation victoria|attendance/i.test(l.description))).toBe(false);
    // every line goes up by roughly the same ~20.6% and unit × quantity still equals the line total
    for (const [i, l] of out.entries()) {
      expect(l.unit_price_inc_gst).toBeGreaterThan(input[i]!.unit_price_inc_gst);
      expect(Math.round(l.unit_price_inc_gst * l.quantity * 100) / 100).toBe(l.line_total_inc_gst);
      expect(l.line_total_inc_gst / input[i]!.line_total_inc_gst).toBeCloseTo(1 + 100 / 484.9, 2);
    }
    const t = total(out);
    expect(t).toBeGreaterThanOrEqual(584.9);
    expect(t).toBeLessThan(585);
  });
  test("a zero-value quote still carries the margin as a flat attendance line", () => {
    const out = applyRectificationMargin([]);
    expect(out.map((l) => [l.description, l.line_total_inc_gst])).toEqual([["Site attendance", 100]]);
  });
});
