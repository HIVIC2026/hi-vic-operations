import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { recEligibilityBlocker } from "../src/lib/allocation.core";
import { allowedInstallDays } from "../src/lib/install-days.core";
import { chooseHoldWeek } from "../src/lib/install-holds.core";

const read = (p: string) => readFileSync(p, "utf8");

describe("trades run their own diaries: no capacity limits", () => {
  test("matching never blocks on a daily limit", () => {
    const c = { is_active: true, onboarding_status: "approved", coverage_verified: true, covers_postcode: true, has_valid_licence: true, approved_workers: 1, weekly_capacity: null, open_jobs: 0, daily_limit: 1, max_jobs_on_window_day: 9 } as never;
    expect(recEligibilityBlocker(c)).toBeNull();
    expect(read("src/lib/allocation.server.ts")).not.toContain("daily_job_limit");
    expect(read("src/lib/readycheck-booking.server.ts")).not.toContain("daily_job_limit");
  });
  test("install days ignore capacity", () => {
    const days = allowedInstallDays({ now: new Date("2026-10-05T00:00:00Z"), deadline: "2026-10-09" });
    expect(days.length).toBeGreaterThan(0);
    expect(read("src/lib/install-days.server.ts")).not.toContain("daily_capacity_m2");
  });
  test("expected install week is the earliest week, never flagged", () => {
    expect(chooseHoldWeek({ earliest: "2026-10-26" })).toEqual({ week: "2026-10-26", overCapacity: false });
    const s = read("src/lib/install-holds.server.ts");
    expect(s).not.toContain("daily_capacity_m2");
    expect(s).toContain("_over: false");
    // The office "expected install week" card was removed from the Job page (audit removal 9).
  });
  test("both fields hidden and never saved", () => {
    const form = read("src/components/portal/business.tsx");
    expect(form).not.toContain('field("daily_job_limit"');
    expect(form).not.toContain('field("daily_capacity_m2"');
    expect(read("src/routes/installer-onboarding.tsx")).not.toContain("m² per day");
    const save = read("src/lib/pilot.functions.ts");
    expect(save).toContain('delete (patch as Record<string, unknown>)["daily_job_limit"];');
    expect(save).toContain('delete (patch as Record<string, unknown>)["daily_capacity_m2"];');
    expect(read("src/lib/partner-activation.functions.ts")).not.toContain("daily_capacity_m2: cap");
  });
});
