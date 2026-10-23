// Stage 6 (Jo 22 Oct 2026): the automatic Ready Check completion checks. Pure module, run with `bun test`.
import { describe, expect, test } from "bun:test";
import { readyCheckCompletionChecks, readyCheckFactsFromEntries, type ReadyCheckFacts } from "../src/lib/ready-check-complete.core";

const E = (label: string, value: unknown) => ({ label, value });
const base = { formComplete: true, electricianDecided: true, priceKnown: true };

describe("readyCheckFactsFromEntries", () => {
  test("no existing insulation: below R2, and the depth/overview photos are satisfied by the answer itself", () => {
    const f = readyCheckFactsFromEntries([
      E("Is there existing insulation in this ceiling area?", "No"),
      E("Upload an overview photo of this ceiling area", "https://mitti/overview.jpg"),
      E("Life support equipment at property?", "No"),
      E("Homeowner agrees to be contacted by Home Insulation Victoria", "Yes"),
    ], base);
    expect(f.belowR2).toBe(true);
    expect(f.depthPhoto).toBe(true);
    expect(f.overviewPhoto).toBe(true);
    expect(f.lifeSupportReviewed).toBe(true);
    expect(f.contactPermission).toBe(true);
  });

  test("insulation present with no depth photo and no below-R2 tick is NOT established as below R2", () => {
    const f = readyCheckFactsFromEntries([
      E("Is there existing insulation in this ceiling area?", "Yes"),
      E("Photo with tape measure showing depth", null),
    ], base);
    expect(f.belowR2).toBe(null);
    expect(f.depthPhoto).toBe(false);
  });

  test("the installer's below-R2 tick stands in for the depth photo", () => {
    const f = readyCheckFactsFromEntries([
      E("Is there existing insulation in this ceiling area?", "Yes"),
      E("No photo? I confirm the existing insulation is below R2.0 and the home is eligible for the rebate", "true"),
    ], base);
    expect(f.belowR2).toBe(true);
    expect(f.depthPhoto).toBe(true);
  });

  test("life support 'Yes' is never auto-reviewed", () => {
    const f = readyCheckFactsFromEntries([E("Life support equipment at property?", "Yes")], base);
    expect(f.lifeSupportReviewed).toBe(false);
  });

  test("a question the form never asked leaves contact permission 'not asked', never a guess", () => {
    const f = readyCheckFactsFromEntries([E("Assessor", "Sam")], base);
    expect(f.contactPermission).toBe(null);
  });
});

const clean: ReadyCheckFacts = {
  formComplete: true, belowR2: true, lifeSupportReviewed: true, depthPhoto: true,
  overviewPhoto: true, contactPermission: true, electricianDecided: true, priceKnown: true,
};

describe("readyCheckCompletionChecks", () => {
  test("a finished form with every fact present is ready and gives no office items", () => {
    expect(readyCheckCompletionChecks(clean)).toEqual({ ready: true, reasons: [] });
  });

  test("insulation R2 or above is an office item telling the office to tell the owner", () => {
    const r = readyCheckCompletionChecks({ ...clean, belowR2: false });
    expect(r.ready).toBe(false);
    expect(r.reasons).toEqual(["Fails: existing insulation is R2 or above"]);
  });

  test("an unestablished insulation level is a different item from R2 or above", () => {
    const r = readyCheckCompletionChecks({ ...clean, belowR2: null });
    expect(r.reasons.join("|")).toContain("existing insulation level isn't established");
    expect(r.reasons.join("|")).not.toContain("R2 or above");
  });

  test("contact permission 'No' and 'not asked' are both office items, and both name the owner's choice", () => {
    const no = readyCheckCompletionChecks({ ...clean, contactPermission: false });
    const missing = readyCheckCompletionChecks({ ...clean, contactPermission: null });
    expect(no.reasons.join("|")).toContain("Owner hasn't agreed to be contacted – can't proceed");
    expect(missing.reasons.join("|")).toContain("contact permission is not on the form");
  });

  test("every failure is listed at once, so the office sees the whole picture", () => {
    const r = readyCheckCompletionChecks({ ...clean, formComplete: false, depthPhoto: false, overviewPhoto: false });
    expect(r.ready).toBe(false);
    expect(r.reasons.length).toBe(1); // photos no longer block (Jo 23 Oct)
    expect(r.reasons.every((x) => x.startsWith("Office needs to: "))).toBe(true);
  });

  test("life support declared and unreviewed blocks the quote", () => {
    const r = readyCheckCompletionChecks({ ...clean, lifeSupportReviewed: false });
    expect(r.reasons.join("|")).toContain("Life support at property – office to check");
  });

  test("no price and no electrician decision are both office items", () => {
    const r = readyCheckCompletionChecks({ ...clean, priceKnown: false, electricianDecided: false });
    expect(r.reasons.length).toBe(2);
    expect(r.reasons.join("|")).toContain("no quoted price");
    expect(r.reasons.join("|")).toContain("electrician arrangement isn't decided");
  });
});
