import { describe, expect, test } from "bun:test";
import { quotedGap, quotedPrice } from "../src/lib/bulk-import.core";

describe("Quoted? Yes / No (Jo, 7 Oct)", () => {
  test("unanswered blocks — never preset, even when the file has a price", () => {
    expect(quotedGap(null, 3450)).toMatch(/Quoted/);
    expect(quotedGap(undefined, null)).toMatch(/Quoted/);
  });
  test("Yes needs a price inc GST and keeps it exactly", () => {
    expect(quotedGap("yes", null)).toMatch(/price inc GST/);
    expect(quotedGap("yes", 0)).toMatch(/price inc GST/);
    expect(quotedGap("yes", 3187.55)).toBeNull();
    expect(quotedPrice("yes", 3187.55)).toBe(3187.55);
  });
  test("No needs no price and keeps none (Quote needed from installer)", () => {
    expect(quotedGap("no", null)).toBeNull();
    expect(quotedPrice("no", 999)).toBeNull();
  });
});

import { installerFactLabels, planQuotedAnswer, QUOTED_ANSWER_NEEDED, QUOTE_NEEDED_LABEL } from "../src/lib/bulk-import.core";
describe("Quoted? left blank never blocks; answered later on the job page (Jo, 5:46pm)", () => {
  const f = { site_check: "yes" as const, site_check_date: null, quoted_price_inc_gst: null, price_includes: null };
  test("blank shows 'Quoted? – answer needed' for trade and office", () => {
    expect(installerFactLabels({ ...f, quoted: null }).price).toBe(QUOTED_ANSWER_NEEDED);
  });
  test("Yes keeps the price exactly and clears the answer-needed note", () => {
    const p = planQuotedAnswer(null, "yes", 3187.55, `Book the Ready Check · ${QUOTED_ANSWER_NEEDED}`);
    expect(p).toEqual({ patch: { installer_quoted: "yes", installer_quoted_price_inc_gst: 3187.55, next_action: "Book the Ready Check" } });
    expect(installerFactLabels({ ...f, quoted: "yes", quoted_price_inc_gst: 3187.55 }).price).toContain("3,187.55");
  });
  test("No shows 'Quote needed from installer'", () => {
    const p = planQuotedAnswer(null, "no", null, QUOTED_ANSWER_NEEDED);
    expect(p).toEqual({ patch: { installer_quoted: "no", installer_quoted_price_inc_gst: null, next_action: QUOTE_NEEDED_LABEL } });
    expect(installerFactLabels({ ...f, quoted: "no" }).price).toBe(QUOTE_NEEDED_LABEL);
  });
  test("Yes without a price, or answering twice, is refused", () => {
    expect(planQuotedAnswer(null, "yes", null, null)).toEqual({ error: "Enter the quoted price inc GST" });
    expect(planQuotedAnswer("yes", "no", null, null)).toEqual({ error: "You've already answered this." });
  });
});
