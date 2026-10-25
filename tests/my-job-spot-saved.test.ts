import { describe, expect, test } from "bun:test";
import { gateACard, isSpotSavedStage, SPOT_SAVED_PROGRESS } from "../src/lib/owner-myjob.core";
const saved = { spot_saved_at: "2026-10-06T00:00:00Z", opted_out_at: null };
describe("My job at Spot saved", () => {
  test("paperwork not done -> to-do card", () => expect(gateACard([{ gate: "A" }, { gate: "B" }])).toBe("todo"));
  test("paperwork done -> mint done card", () => expect(gateACard([{ gate: "B" }])).toBe("done"));
  test("spot saved stage only before a Ready Check", () => {
    expect(isSpotSavedStage("ready_check_awaiting_acceptance", saved, false)).toBe(true);
    expect(isSpotSavedStage("ready_check_awaiting_acceptance", saved, true)).toBe(false);
    expect(isSpotSavedStage("ready_check_scheduled", saved, false)).toBe(false);
    expect(isSpotSavedStage("preliminary_estimate_ready", { ...saved, opted_out_at: "x" }, false)).toBe(false);
    expect(isSpotSavedStage("preliminary_estimate_ready", null, false)).toBe(false);
  });
  test("six steps; step 2 is the release, never a Ready Check (decision 388)", () => expect(SPOT_SAVED_PROGRESS.map((s) => s.label)).toEqual(["Spot saved", "Spot released", "Your quote", "PIESA", "Install", "Done"]));
});
