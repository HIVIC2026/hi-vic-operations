// Jo 24 Oct 2026 (decision 80): a booked our-lead Ready Check can be changed by either side, like install days.
// Pure rules. (The old O12 "You're booked" email was removed in Part 3 Task 16; the new one is owner-booked-notice.core.)
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { installerRebookBlockers, readyCheckChangeBlockers, readyCheckStartAt } from "../src/lib/ready-check-times.core";

const NOW = new Date("2026-10-26T00:00:00Z"); // Mon 26 Oct, 11am Melbourne
const booked = readyCheckStartAt("2026-10-29", "09:00").toISOString();
const ok = { channel: "hivic_sourced", stage: "ready_check_scheduled", deleted: false, bookedAt: booked };

describe("who can change a booked Ready Check", () => {
  test("our lead, booked, not started = can change", () => expect(readyCheckChangeBlockers(ok, NOW)).toEqual([]));
  test("installer's own customers: never (no portal booking)", () => expect(readyCheckChangeBlockers({ ...ok, channel: "installer_sourced" }, NOW).join(" ")).toMatch(/directly with their own customers/));
  test("nothing booked / wrong stage", () => {
    expect(readyCheckChangeBlockers({ ...ok, bookedAt: null }, NOW).join(" ")).toMatch(/no booked Ready Check/);
    expect(readyCheckChangeBlockers({ ...ok, stage: "ready_check_complete" }, NOW).join(" ")).toMatch(/no booked Ready Check/);
    expect(readyCheckChangeBlockers({ ...ok, stage: "ready_check_ready_to_schedule" }, NOW).join(" ")).toMatch(/no booked Ready Check/);
  });
  test("already started", () => expect(readyCheckChangeBlockers(ok, new Date(Date.parse(booked) + 60_000)).join(" ")).toMatch(/already started/));
  test("deleted job", () => expect(readyCheckChangeBlockers({ ...ok, deleted: true }, NOW).join(" ")).toMatch(/no longer available/));
});

describe("installer's new day + time (same rules as offers)", () => {
  test("allowed day + time, 24h+ away = fine", () => expect(installerRebookBlockers({ day: "2026-10-30", time: "07:30" }, booked, NOW)).toEqual([]));
  test("odd or missing time", () => {
    expect(installerRebookBlockers({ day: "2026-10-30", time: "07:15" }, booked, NOW)).toEqual(["Please choose a time."]);
    expect(installerRebookBlockers({ day: "2026-10-30", time: "18:00" }, booked, NOW)).toEqual(["Please choose a time."]);
  });
  test("weekend or past 21 days", () => {
    expect(installerRebookBlockers({ day: "2026-10-31", time: "09:00" }, booked, NOW).join(" ")).toMatch(/not available/);
    expect(installerRebookBlockers({ day: "2026-12-30", time: "09:00" }, booked, NOW).join(" ")).toMatch(/not available/);
  });
  test("under 24 hours away", () => expect(installerRebookBlockers({ day: "2026-10-27", time: "08:00" }, booked, NOW)).toEqual(["The time must be at least 24 hours away."]));
  test("the same time as booked", () => expect(installerRebookBlockers({ day: "2026-10-29", time: "09:00" }, booked, NOW)).toEqual(["That is already the booked time."]));
});
