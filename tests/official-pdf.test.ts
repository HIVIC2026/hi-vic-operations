import { describe, expect, test } from "bun:test";
import { officialFillBlocker } from "../src/lib/official-pdf.core";

describe("official form filling", () => {
  test("blocked for both forms while the Word-form mapping is unapproved and the old PDF mapping is superseded", () => {
    for (const k of ["piesa", "piisa"] as const) expect(officialFillBlocker(k)).toMatch(/can't be used/);
  });
});
