import { expect, test } from "bun:test";
import { melbourneToday } from "../src/lib/melbourne-time.core";
import { melbourneToday as veecToday } from "../src/lib/veec.core";
import { melbourneToday as recToday } from "../src/lib/rec-onboarding.core";
test("7am Melbourne is the Melbourne date, not the UTC date (daylight saving, AEDT +11)", () => {
  // Wed 7 Oct 2026 07:00 AEDT = Tue 6 Oct 20:00 UTC
  expect(melbourneToday(new Date("2026-10-06T20:00:00Z"))).toBe("2026-10-07");
});
test("7am Melbourne in standard time (AEST +10)", () => {
  // Tue 7 Jul 2026 07:00 AEST = Mon 6 Jul 21:00 UTC
  expect(melbourneToday(new Date("2026-07-06T21:00:00Z"))).toBe("2026-07-07");
});
test("one helper: legacy exports agree", () => {
  const d = new Date("2026-10-06T20:00:00Z");
  expect(veecToday(d)).toBe("2026-10-07"); expect(recToday(d)).toBe("2026-10-07");
});
