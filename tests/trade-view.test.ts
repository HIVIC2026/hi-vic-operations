import { describe, expect, test } from "bun:test";
import { couldntGetInMessage, dayTile, distanceLine, expiryPill, goneIn, payPill, payState, prestartReady, roughInstallValue, roughValueNote, setupComplete, SETUP_STEPS, PRESTART_CHECKS, tradeGreeting } from "../src/lib/trade-view.core";

describe("trade view presentation", () => {
  test("greeting and quiet week", () => {
    expect(tradeGreeting("Jo", 3)).toEqual({ title: "Hello Jo", sub: "3 jobs booked this week." });
    expect(tradeGreeting("Jo", 1).sub).toBe("1 job booked this week.");
    expect(tradeGreeting(null, 0)).toEqual({ title: "Hello", sub: "No jobs booked this week. New job offers will appear here." });
  });
  test("own-rate rough install value, rounded down, never guaranteed", () => {
    expect(roughInstallValue(27.5, 121)).toBe(3327);
    expect(roughInstallValue(null, 120)).toBeNull();
    expect(roughValueNote("owner_estimate")).toBe("Based on the owner's guess. Your pay is set by your agreed rates and the area measured at the Ready Check, including any removal.");
    expect(roughValueNote("aerial").startsWith("Based on an aerial measurement.")).toBe(true);
    expect(roughValueNote("owner_estimate")).not.toMatch(/guarantee|yours to install|confirmed install/i);
  });
  test("countdown and distance", () => {
    const now = Date.parse("2026-10-06T00:00:00Z");
    expect(goneIn("2026-10-06T03:20:00Z", now)).toBe("Closes in 3h 20m");
    expect(goneIn("2026-10-06T00:40:00Z", now)).toBe("Closes in 40 min");
    expect(goneIn("2026-10-05T00:00:00Z", now)).toBe("Closing now");
    expect(distanceLine(14.4)).toBe("About 14 km away");
    expect(distanceLine(null)).toBe("Nearby");
  });
  test("money pills", () => {
    expect(payPill(payState({ paidAt: null, apApprovedAt: null, installerSupplied: false }))).toEqual({ label: "Being checked", tone: "blush" });
    expect(payPill(payState({ paidAt: null, apApprovedAt: "2026-10-01T00:00:00Z", installerSupplied: false })).tone).toBe("blue");
    expect(payPill(payState({ paidAt: null, apApprovedAt: "2026-10-01T00:00:00Z", installerSupplied: false })).label).toBe("Coming Thu 8 Oct");
    expect(payPill(payState({ paidAt: "2026-10-02T01:00:00Z", apApprovedAt: "2026-10-01T00:00:00Z", installerSupplied: false })).label).toBe("Paid Fri 2 Oct");
  });
  test("setup and before-you-start gating", () => {
    expect(setupComplete({ details: true, rates: true, bank: true, alerts: true })).toBe(true);
    expect(setupComplete({ details: true, rates: true, bank: true })).toBe(false);
    // Mitti is never shown to partners until the office invites them.
    expect(SETUP_STEPS.some((s) => s.key === ("mitti" as string))).toBe(false);
    expect(PRESTART_CHECKS.some((c) => /mitti/i.test(c.title + c.sub))).toBe(false);
    expect(prestartReady([true, true, false])).toBe(false);
    expect(prestartReady([true, true, true])).toBe(true);
  });
  test("couldn't get in and expiry", () => {
    expect(couldntGetInMessage("No one home")).toBe("Thanks for letting us know. No one home. We'll rebook with the owner and offer it back to you first.");
    const now = new Date("2026-10-06T00:00:00Z");
    expect(expiryPill("2026-10-20", now)).toEqual({ label: "14 days", warn: true, days: 14 });
    expect(expiryPill("2027-10-20", now).label).toBe("Current");
    expect(expiryPill("2026-10-01", now).label).toBe("Expired");
  });
  test("day tiles use the four 2-hour windows", () => {
    expect(dayTile("2026-10-13T21:00:00Z")).toEqual({ day: "WED 14", window: "8–10am" });
    expect(dayTile("2026-10-14T03:00:00Z").window).toBe("2–4pm");
  });
});
