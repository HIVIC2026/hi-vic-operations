import { describe, expect, test } from "bun:test";
import { gateACard, isSpotSavedStage, SPOT_SAVED_PROGRESS, spotSavedLayout } from "../src/lib/owner-myjob.core";
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
  test("not released: unchanged", () => expect(spotSavedLayout(false)).toEqual({ stepLabel: "Step 1 of 6", showWaitingBox: true, doneSub: "Nothing else to do until your spot is released.", currentIndex: 1 }));
  test("released: no waiting messages, step 2, quote is current", () => expect(spotSavedLayout(true)).toEqual({ stepLabel: "Step 2 of 6", showWaitingBox: false, doneSub: null, currentIndex: 2 }));
});

import { readFileSync } from "node:fs";
describe("released spot is wired into My job", () => {
  const server = readFileSync("src/lib/owner-myjob.server.ts", "utf8");
  const page = readFileSync("src/routes/my-job.$token.tsx", "utf8");
  test("server reads this job's spot_released event", () => {
    expect(server).toMatch(/from\("workflow_events"\)\.select\("id"\)\.eq\("job_id", jobId\)\.eq\("event_type", SPOT_RELEASED_EVENT\)/);
    expect(server).toMatch(/^\s+released,$/m);
  });
  test("page uses the layout helper", () => expect(page).toContain("spotSavedLayout(sp.released)"));
});
