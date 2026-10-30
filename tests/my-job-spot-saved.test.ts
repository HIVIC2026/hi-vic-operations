import { describe, expect, test } from "bun:test";
import { gateACard, isSpotSavedStage, SPOT_SAVED_PROGRESS, spotSavedLayout, spotReleasedForPage } from "../src/lib/owner-myjob.core";
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
  test("not released: unchanged", () => expect(spotSavedLayout(false)).toEqual({ stepLabel: "Step 1 of 6", showWaitingBox: true, doneSub: "Nothing else to do until your spot is released.", currentIndex: 1, showReleasedSub: true }));
  test("released: no waiting messages, step 2, quote is current", () => expect(spotSavedLayout(true)).toEqual({ stepLabel: "Step 2 of 6", showWaitingBox: false, doneSub: null, currentIndex: 2, showReleasedSub: false }));
});

import { readFileSync } from "node:fs";
describe("released spot is wired into My job", () => {
  const server = readFileSync("src/lib/owner-myjob.server.ts", "utf8");
  const page = readFileSync("src/routes/my-job.$token.tsx", "utf8");
  test("server reads this job's spot-release events", () => {
    expect(server).toMatch(/from\("workflow_events"\)\.select\("event_type, created_at, details"\)\.eq\("job_id", jobId\)\.in\("event_type", \[\.\.\.SPOT_RELEASE_EVENTS\]\)/);
    expect(server).toContain("spotReleasedForPage(");
    expect(server).toMatch(/^\s+released,$/m);
  });
  test("page uses the layout helper", () => expect(page).toContain("spotSavedLayout(sp.released)"));
});

describe("which releases count on the spot-saved page", () => {
  const ev = (event_type: string, at: string) => ({ event_type, created_at: at, details: { release_seq: 1 } });
  const rel = ev("spot_released", "2026-10-29T06:25:00Z");
  test("never released", () => expect(spotReleasedForPage([])).toBe(false));
  test("released, owner not confirmed yet", () => expect(spotReleasedForPage([rel])).toBe(true));
  test("released and confirmed (HV-3542)", () => expect(spotReleasedForPage([rel, ev("spot_release_confirmed", "2026-10-29T06:34:00Z")])).toBe(true));
  test("lapsed = back on the waiting list", () => expect(spotReleasedForPage([rel, ev("spot_release_lapsed", "2026-11-03T06:25:00Z")])).toBe(false));
});
test("page hides the 'Spot released' sub line once released", () => expect(readFileSync("src/routes/my-job.$token.tsx", "utf8")).toContain("i === 1 && !L.showReleasedSub"));
