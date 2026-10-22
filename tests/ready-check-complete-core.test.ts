// Stage 6 (Jo 22 Oct 2026): the automatic Ready Check completion checks. Pure module, run with `bun test`.
import { describe, expect, test } from "bun:test";
import { readyCheckCompletionChecks, type ReadyCheckFacts } from "../src/lib/ready-check-complete.core";

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
    expect(r.reasons).toEqual(["Office needs to: existing insulation is R2 or above — this home does not appear eligible; tell the owner"]);
  });

  test("an unestablished insulation level is a different item from R2 or above", () => {
    const r = readyCheckCompletionChecks({ ...clean, belowR2: null });
    expect(r.reasons.join("|")).toContain("existing insulation level isn't established");
    expect(r.reasons.join("|")).not.toContain("R2 or above");
  });

  test("contact permission 'No' and 'not asked' are both office items, and both name the owner's choice", () => {
    const no = readyCheckCompletionChecks({ ...clean, contactPermission: false });
    const missing = readyCheckCompletionChecks({ ...clean, contactPermission: null });
    expect(no.reasons.join("|")).toContain("did not agree to be contacted");
    expect(missing.reasons.join("|")).toContain("contact permission is not on the form");
  });

  test("every failure is listed at once, so the office sees the whole picture", () => {
    const r = readyCheckCompletionChecks({ ...clean, formComplete: false, depthPhoto: false, overviewPhoto: false });
    expect(r.ready).toBe(false);
    expect(r.reasons.length).toBe(3);
    expect(r.reasons.every((x) => x.startsWith("Office needs to: "))).toBe(true);
  });

  test("life support declared and unreviewed blocks the quote", () => {
    const r = readyCheckCompletionChecks({ ...clean, lifeSupportReviewed: false });
    expect(r.reasons.join("|")).toContain("life support equipment is declared and has not been reviewed");
  });

  test("no price and no electrician decision are both office items", () => {
    const r = readyCheckCompletionChecks({ ...clean, priceKnown: false, electricianDecided: false });
    expect(r.reasons.length).toBe(2);
    expect(r.reasons.join("|")).toContain("no quoted price");
    expect(r.reasons.join("|")).toContain("electrician arrangement isn't decided");
  });
});
