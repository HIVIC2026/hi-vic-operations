import { describe, expect, test } from "bun:test";
import { allowedPiesaDays, isBusinessDay, noTakerStep, piesaWindowBlockers, windowBounds } from "../src/lib/piesa-windows.core";

// Monday 5 Oct 2026, 10:00 Melbourne (AEDT +11)
const now = new Date("2026-10-04T23:00:00Z");

describe("PIESA window rules", () => {
  test("allowed days start 2 business days out, stay within 21 days, skip weekends/holidays", () => {
    const d = allowedPiesaDays(now);
    expect(d[0]).toBe("2026-10-07");
    expect(d.at(-1)! <= "2026-10-26").toBe(true);
    expect(d.every(isBusinessDay)).toBe(true);
    expect(allowedPiesaDays(new Date("2026-10-29T23:00:00Z"))).not.toContain("2026-11-03"); // Melbourne Cup
  });
  test("3–5 picks on at least 3 different days", () => {
    const ok = [{ date: "2026-10-07", slot: "morning" as const }, { date: "2026-10-08", slot: "afternoon" as const }, { date: "2026-10-09", slot: "morning" as const }];
    expect(piesaWindowBlockers(ok, now)).toEqual([]);
    expect(piesaWindowBlockers(ok.slice(0, 2), now).length).toBeGreaterThan(0);
    expect(piesaWindowBlockers([...ok.slice(0, 2), { date: "2026-10-07", slot: "afternoon" }], now)).toContain("Please choose times on at least 3 different days.");
    expect(piesaWindowBlockers([...ok, ok[0]!], now)).toContain("Each time can only be chosen once.");
    expect(piesaWindowBlockers([...ok.slice(0, 2), { date: "2026-10-06", slot: "morning" }], now).length).toBeGreaterThan(0); // too soon
    expect(piesaWindowBlockers([...ok.slice(0, 2), { date: "2026-10-10", slot: "morning" }], now).length).toBeGreaterThan(0); // Saturday
    const six = ["07", "08", "09", "12", "13", "14"].map((d) => ({ date: `2026-10-${d}`, slot: "morning" as const }));
    expect(piesaWindowBlockers(six, now).length).toBeGreaterThan(0);
  });
  test("windows are 8–12 and 12–4 Melbourne time, across daylight saving", () => {
    expect(windowBounds("2026-10-07", "morning")).toEqual({ starts_at: "2026-10-06T21:00:00.000Z", ends_at: "2026-10-07T01:00:00.000Z" });
    expect(windowBounds("2026-06-10", "afternoon")).toEqual({ starts_at: "2026-06-10T02:00:00.000Z", ends_at: "2026-06-10T06:00:00.000Z" });
  });
  test("no takers: round 1 asks the owner for more times, round 2 goes to needs attention, no third request", () => {
    expect(noTakerStep(0)).toBe("none");
    expect(noTakerStep(1)).toBe("ask_owner_for_more_times");
    expect(noTakerStep(2)).toBe("needs_attention");
    expect(noTakerStep(3)).toBe("needs_attention");
  });
});
