import { describe, expect, test } from "bun:test";
import { knownPrefill, rcProgress, toObservations, fromObservations, RC_ORIGINAL_CONDITION_KEYS } from "../src/lib/ready-check-draft.core";

describe("portal Ready Check draft", () => {
  test("blank answers stay unknown, never guessed", () => {
    const { obs, problems } = toObservations({});
    expect(problems).toEqual([]);
    expect(Object.values(obs).every((v) => v === null)).toBe(true);
  });
  test("a bad number is refused, not coerced", () => {
    expect(toObservations({ "elec.downlight_count": "six" }).problems.length).toBe(1);
  });
  test("saved answers round-trip", () => {
    const { obs } = toObservations({ "measure.eligible_area_m2": "117.5", "insulation.existing": "present" });
    const v = fromObservations(obs);
    expect(v["measure.eligible_area_m2"]).toBe("117.5");
    expect(v["insulation.existing"]).toBe("present");
  });
  test("installer 'not yet confirmed' insulation is not prefilled", () => {
    expect(knownPrefill({ insulation: "unknown" })).toEqual({});
    expect(knownPrefill({ insulation: "none" })["insulation.existing"]).toBe("none");
  });
  test("works stay blocked until original-condition answers exist", () => {
    expect(rcProgress({}, []).worksBlockers.length).toBe(RC_ORIGINAL_CONDITION_KEYS.length);
    expect(RC_ORIGINAL_CONDITION_KEYS.length).toBeGreaterThan(0);
  });
  test("only assessment evidence counts; rejected and awaiting review are listed separately and never complete", () => {
    const p = rcProgress({}, [
      { label: "Manhole", gate: "assessment", required: true, status: "rejected" },
      { label: "Roof", gate: "assessment", required: true, status: "uploaded" },
      { label: "Before ceiling space", gate: "installation", required: true, status: "outstanding" },
    ]);
    expect(p.evidence.rejected).toEqual(["Manhole"]);
    expect(p.evidence.awaitingReview).toEqual(["Roof"]);
    expect(p.evidence.missing).toEqual([]);
    expect(p.allEntered).toBe(false);
  });
});
