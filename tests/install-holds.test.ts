import { describe, expect, test } from "bun:test";
import { chooseHoldWeek, holdShouldRelease, initialHoldWeek, mondayOf, piesaHoldWeek, rectificationHoldWeek } from "../src/lib/install-holds.core";

describe("install holds rules", () => {
  test("mondayOf", () => {
    expect(mondayOf("2026-10-04")).toBe("2026-09-28"); // Sunday
    expect(mondayOf("2026-10-05")).toBe("2026-10-05");
  });
  test("initial hold about 3 weeks out", () => {
    expect(initialHoldWeek(new Date("2026-10-05T01:00:00Z"))).toBe("2026-10-26");
  });
  test("PIESA booked: install 7–21 days after", () => {
    expect(piesaHoldWeek("2026-10-14T00:00:00Z")).toEqual({ earliest: "2026-10-19", latest: "2026-11-02" });
  });
  test("rectification: week after the expected date", () => {
    expect(rectificationHoldWeek("2026-10-21T00:00:00Z")).toBe("2026-10-26");
  });
  test("no capacity set: always fits", () => {
    expect(chooseHoldWeek({ earliest: "2026-10-26", areaM2: 9999, dailyCapacityM2: null, usedByWeek: { "2026-10-26": 9999 } })).toEqual({ week: "2026-10-26", overCapacity: false });
  });
  test("capacity full: next week that fits", () => {
    expect(chooseHoldWeek({ earliest: "2026-10-26", areaM2: 200, dailyCapacityM2: 100, usedByWeek: { "2026-10-26": 400 } })).toEqual({ week: "2026-11-02", overCapacity: false });
  });
  test("nothing fits inside the PIESA range: earliest kept and flagged", () => {
    expect(chooseHoldWeek({ earliest: "2026-10-19", latest: "2026-11-02", areaM2: 200, dailyCapacityM2: 50, usedByWeek: {} })).toEqual({ week: "2026-10-19", overCapacity: true });
  });
  test("release after 10 days only when no PIESA booked", () => {
    const c = "2026-10-01T00:00:00Z";
    expect(holdShouldRelease(c, new Date("2026-10-10T23:00:00Z"), false)).toBe(false);
    expect(holdShouldRelease(c, new Date("2026-10-11T00:00:00Z"), false)).toBe(true);
    expect(holdShouldRelease(c, new Date("2026-11-11T00:00:00Z"), true)).toBe(false);
  });
});
