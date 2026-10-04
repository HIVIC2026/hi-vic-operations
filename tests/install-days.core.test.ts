import { describe, expect, test } from "bun:test";
import { allowedInstallDays, installDayBlockers, installDayOutsideWindow, installWindowDeadline, shouldFlagTenDaysLeft } from "../src/lib/install-days.core";
import { buildNeedsHivic } from "../src/lib/allocation.core";

const now = new Date("2026-10-05T00:00:00Z"); // Mon 5 Oct, 11am Melbourne

describe("install days", () => {
  test("30-day window from clearance; earlier stored deadline wins", () => {
    expect(installWindowDeadline("2026-10-01", null)).toBe("2026-10-31");
    expect(installWindowDeadline("2026-10-01", "2026-10-20")).toBe("2026-10-20");
    expect(installWindowDeadline(null, null)).toBeNull();
  });
  test("only business days 24h+ away, inside the window", () => {
    const d = allowedInstallDays({ now, deadline: "2026-10-16" });
    expect(d[0]).toBe("2026-10-07"); // Tue 6 Oct 8am is under 24h away
    expect(d).not.toContain("2026-10-10"); // Saturday
    expect(d.at(-1)).toBe("2026-10-16");
    expect(allowedInstallDays({ now, deadline: null })).toEqual([]);
  });
  test("no capacity check: every allowed day stays", () => {
    expect(allowedInstallDays({ now, deadline: "2026-10-09" })).toEqual(["2026-10-07", "2026-10-08", "2026-10-09"]);
  });
  test("owner must pick 3–5 allowed distinct days", () => {
    const ok = ["2026-10-07", "2026-10-08", "2026-10-09"];
    expect(installDayBlockers(ok, ok)).toEqual([]);
    expect(installDayBlockers(ok.slice(0, 2), ok).length).toBeGreaterThan(0);
    expect(installDayBlockers([...ok, "2026-12-01"], ok).length).toBeGreaterThan(0);
  });
  test("hard gate: a day after the deadline can never be booked", () => {
    expect(installDayOutsideWindow("2026-10-31T23:00:00Z", "2026-10-31")).toBe(true); // 1 Nov Melbourne
    expect(installDayOutsideWindow("2026-10-30T22:00:00Z", "2026-10-31")).toBe(false);
    expect(installDayOutsideWindow("2026-10-20T00:00:00Z", null)).toBe(true);
  });
  test("10-days-left flag once, only when nothing booked and not expired", () => {
    expect(shouldFlagTenDaysLeft({ deadline: "2026-10-15", booked: false, flaggedAt: null, now })).toBe(true);
    expect(shouldFlagTenDaysLeft({ deadline: "2026-10-16", booked: false, flaggedAt: null, now })).toBe(false);
    expect(shouldFlagTenDaysLeft({ deadline: "2026-10-15", booked: true, flaggedAt: null, now })).toBe(false);
    expect(shouldFlagTenDaysLeft({ deadline: "2026-10-15", booked: false, flaggedAt: "x", now })).toBe(false);
    expect(shouldFlagTenDaysLeft({ deadline: "2026-10-01", booked: false, flaggedAt: null, now })).toBe(false);
  });
  test("needs-attention: 10 days left and installer declined, only while scheduling", () => {
    const base = { now, coverageExhausted: [], releases: [], failedComms: [], rectDeclined: [], rectPricing: [], installerUnavailable: [], piesaTiming: [], escTiming: [], evidenceRejected: [], registryQueries: [], officeOverdue: [] };
    const jobs = [{ id: "a", job_number: "A", stage: "installation_scheduling", suburb: null }, { id: "b", job_number: "B", stage: "installation_booked", suburb: null }];
    const items = buildNeedsHivic({ ...base, jobs, installFlags: [
      { job_id: "a", code: "install_ten_days_left", created_at: "x" }, { job_id: "a", code: "install_days_declined", created_at: "x" }, { job_id: "b", code: "install_days_declined", created_at: "x" },
    ] } as never);
    expect(items.map((i) => `${i.jobId}:${i.code}`).sort()).toEqual(["a:install_days_declined", "a:install_ten_days_left"]);
  });
});
