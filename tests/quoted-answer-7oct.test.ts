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
