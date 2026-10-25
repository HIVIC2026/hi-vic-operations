import { expect, test } from "bun:test";
import { REMOVAL_BUDGET_EMAIL_NOTE, removalFromScenario, removalNote } from "../src/lib/estimate-removal.core";
// The old Step 3 / launch-campaign Save my spot renderers these tests used to lock were removed on 24 Oct 2026 (no send
// path used them after Jo's approved O1/O2 designs). The removal rules they shared stay covered here.
test("primary zero-removal snapshot excludes removal", () => {
  expect(removalFromScenario({ removal: 0, removal_m2: 0 })).toEqual({kind:"excluded"});
});
test("priced removal is a reconciled inclusion, never an exclusion", () => {
  expect(removalFromScenario({ removal: 450, removal_m2: 150 })).toEqual({kind:"included",amount:450,areaM2:150});
});
test("missing or inconsistent removal facts show the $15/m² budget note, never an amount", () => {
  for (const s of [null,{}, {removal:0}, {removal:0,removal_m2:150}, {removal:-1,removal_m2:150}]) {
    expect(removalFromScenario(s)).toEqual({kind:"unknown"});
    expect(removalNote(removalFromScenario(s))).toBe(REMOVAL_BUDGET_EMAIL_NOTE);
  }
});
const EXACT = "Existing insulation may need to be removed. Please budget $15 per m² including GST for the areas that need removal only. We’ll confirm the area and cost before you approve any removal.";
test("Jo's exact removal sentence (23:18 UTC)", () => { expect(REMOVAL_BUDGET_EMAIL_NOTE).toBe(EXACT); });
