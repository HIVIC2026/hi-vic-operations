import { describe, expect, test } from "bun:test";
import { buildJourney, GATES } from "../src/lib/journey.core";
import { STAGE_ORDER, EXCEPTION_STAGES } from "../src/lib/workflow";

describe("job journey", () => {
  test("every stage belongs to exactly one gate or is an exception", () => {
    for (const s of STAGE_ORDER) expect(GATES.filter((g) => g.steps.includes(s) || g.legacy?.includes(s)).length).toBe(1);
    for (const s of EXCEPTION_STAGES) expect(GATES.some((g) => g.steps.includes(s))).toBe(false);
  });
  test("new enquiry: gate 1 current, rest upcoming", () => {
    const j = buildJourney({ stage: "new_enquiry" });
    expect(j.current?.key).toBe("enquiry");
    expect(j.gates.slice(1).every((g) => g.status === "upcoming")).toBe(true);
    expect(j.upNext[0]!.stage).toBe("eligibility_review");
  });
  test("awaiting quote acceptance: earlier gates done, next is deposit", () => {
    const j = buildJourney({ stage: "measured_estimate_ready", eligibility_outcome: "likely_eligible" });
    expect(j.headline).toBe("Gate 3 – Quote & acceptance");
    expect(j.gates[0]!.status).toBe("done");
    expect(j.gates[1]!.status).toBe("done");
    expect(j.upNext.map((s) => s.stage)).toEqual(["measured_quote_accepted", "awaiting_deposit_payment", "piesa_and_install_window_pending"]);
  });
  test("rectification skipped when not needed", () => {
    const j = buildJourney({ stage: "piesa_complete", eligibility_outcome: "likely_eligible", rectificationNeeded: false });
    expect(j.gates.find((g) => g.key === "rectification")!.status).toBe("skipped");
    expect(j.upNext[0]!.stage).toBe("installation_scheduling");
  });
  test("legacy stage shown only while current", () => {
    const j = buildJourney({ stage: "assessment_booked", eligibility_outcome: "likely_eligible" });
    const piesa = j.gates.find((g) => g.key === "piesa")!;
    expect(piesa.status).toBe("current");
    expect(piesa.steps.some((s) => s.stage === "assessment_booked" && s.status === "current")).toBe(true);
    expect(buildJourney({ stage: "piesa_scheduled" }).gates.find((g) => g.key === "piesa")!.steps.some((s) => s.legacy)).toBe(false);
  });
  test("on hold / cancelled / complete", () => {
    expect(buildJourney({ stage: "on_hold", hold_reason: "x" }).exception).toBe("on_hold");
    expect(buildJourney({ stage: "cancelled" }).current).toBeNull();
    const c = buildJourney({ stage: "complete", eligibility_outcome: "likely_eligible" });
    expect(c.gates.every((g) => g.status === "done")).toBe(true);
    expect(c.upNext).toHaveLength(0);
  });
  test("mismatch or ineligible blocks current gate", () => {
    expect(buildJourney({ stage: "installation_booked", mismatches: ["x"] }).current!.status).toBe("blocked");
    expect(buildJourney({ stage: "eligibility_review", eligibility_outcome: "does_not_appear_eligible" }).current!.status).toBe("blocked");
  });
});
