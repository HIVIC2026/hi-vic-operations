import { describe, expect, test } from "bun:test";
import { fillTemplate, gateDoc, quoteAcceptanceReady } from "../src/lib/owner-gates.core";

describe("owner quote acceptance line", () => {
  const body = gateDoc("quote_acceptance").body;
  test("shows the real version and inc-GST price", () => {
    const v = { quote_version: "2", total: "$3,178.00" };
    expect(quoteAcceptanceReady(v)).toBe(true);
    const t = fillTemplate(body, v);
    expect(t).toContain("version 2, $3,178.00 inc GST");
    expect(t).not.toContain("—");
  });
  test("is never offered with a blank version or price", () => {
    expect(quoteAcceptanceReady({ quote_version: "", total: "$3,178.00" })).toBe(false);
    expect(quoteAcceptanceReady({ quote_version: "1", total: undefined })).toBe(false);
    expect(quoteAcceptanceReady({})).toBe(false);
  });
});
