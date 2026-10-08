import { expect, test } from "bun:test";
import { laterReadyCheckProblems } from "../src/lib/later-ready-check.core";
test("later job requires booked Ready Check date", () => {
  expect(laterReadyCheckProblems({ startsAt: "" })).toContain("Enter the booked Ready Check date and time");
  expect(laterReadyCheckProblems({ startsAt: "2026-10-12T01:00:00Z" })).toEqual([]);
});
test("manual measurements are optional but supplied area needs a method", () => {
  expect(laterReadyCheckProblems({ startsAt: "2026-10-12T01:00:00Z", area: 150 })).toContain("Tell us how the ceiling area was measured");
  expect(laterReadyCheckProblems({ startsAt: "2026-10-12T01:00:00Z", area: 150, method: "Laser" })).toEqual([]);
});