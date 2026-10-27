import { expect, test } from "bun:test";
import { isSpotSavedStage, ownerAction, ownerHero, ownerStage } from "../src/lib/owner-myjob.core";

const spot = { spot_saved_at: "2026-10-27T10:00:00Z", opted_out_at: null };

test("archived job at a spot-saved stage reads as closed, with no spot-saved header or progress step", () => {
  const stage = ownerStage("ready_check_ready_to_schedule", "2026-10-27T11:30:00Z");
  expect(stage).toBe("cancelled");
  expect(isSpotSavedStage(stage, spot, false)).toBe(false);
  const hero = ownerHero(stage, 1120);
  expect(hero.headline).toBe("This job is closed");
  expect(hero.closed).toBe(true);
  expect(ownerAction({ stage, readyCheckRequested: false, visit: null, quoteOpen: null, bookingOpen: false }).title).toBe("This job is closed");
});

test("cancelled job header is closed; open job header unchanged", () => {
  expect(ownerHero("cancelled", 1120).closed).toBe(true);
  expect(ownerStage("ready_check_ready_to_schedule", null)).toBe("ready_check_ready_to_schedule");
  expect(ownerHero("ready_check_ready_to_schedule", 1120).closed).toBe(false);
});
