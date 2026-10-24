// Ready Check booking rules (pure). Price is never a ranking input.
import { describe, expect, test } from "bun:test";
import {
  fullCurrentCert, installerCandidate, installerEligibilityBlocker, priceSeenBlocker, rankedInstallers,
  type InstallerFacts,
} from "../src/lib/readycheck-booking.core";
import { piesaWindowBlockers, allowedPiesaDays } from "../src/lib/piesa-windows.core";

const base = (over: Partial<InstallerFacts> = {}) => installerCandidate({
  business_id: "b", name: "TEST", is_active: true, onboarding_status: "approved", accepting_new_jobs: true, receives_hivic_leads: true,
  coverage_verified: true, covers_postcode: true, exact_postcode: true, credentialsOk: true, fullCertifiedInstallers: 1, freeMeasureUps: true,
  weekly_capacity: null, open_jobs: 0, recent_offers_30d: 0, acceptance_rate: null, free_in_window: true, ...over,
});

describe("Ready Check installer eligibility", () => {
  test("Full + current certification only; missing level is NOT confirmed", () => {
    expect(fullCurrentCert({ status: "verified", level: "full", expiresOn: "2030-01-01" }, "2026-10-04")).toBe(true);
    expect(fullCurrentCert({ status: "verified", level: "provisional", expiresOn: "2030-01-01" }, "2026-10-04")).toBe(false);
    expect(fullCurrentCert({ status: "verified", level: "full", expiresOn: "2026-10-03" }, "2026-10-04")).toBe(false);
    expect(fullCurrentCert({ status: "verified", level: null, expiresOn: null }, "2026-10-04")).toBe(false);
  });
  test("each requirement blocks on its own", () => {
    expect(installerEligibilityBlocker(base())).toBeNull();
    expect(installerEligibilityBlocker(base({ onboarding_status: "draft" }))).toMatch(/approved/);
    expect(installerEligibilityBlocker(base({ fullCertifiedInstallers: 0 }))).toMatch(/Full, current EEC/);
    expect(installerEligibilityBlocker(base({ covers_postcode: false }))).toMatch(/coverage/);
    expect(installerEligibilityBlocker(base({ free_in_window: false }))).toMatch(/booked/);
    expect(installerEligibilityBlocker(base({ freeMeasureUps: false }))).toMatch(/free Ready Checks/);
  });
  test("Choose installer list order: nearby that day → reliability → fewest recent → speed; ineligible left out", () => {
    const c = [
      base({ business_id: "far", name: "A", acceptance_rate: 1 }),
      base({ business_id: "near", name: "B", nearby_job_that_day: true, acceptance_rate: 0.1 }),
      base({ business_id: "busy", name: "C", acceptance_rate: 1, recent_jobs_30d: 9 }),
      base({ business_id: "slow", name: "D", acceptance_rate: 1, avg_accept_hours: 9 }),
      base({ business_id: "x", name: "E", fullCertifiedInstallers: 0 }),
    ];
    const order = rankedInstallers(c).map((x) => x.business_id);
    expect(order[0]).toBe("near");
    expect(order).not.toContain("x");
    expect(order.at(-1)).toBe("busy");
    expect(order).toHaveLength(4);
  });
});

describe("Ready Check flow rules", () => {
  test("windows: same rules as PIESA (3–5, 3 different days)", () => {
    const d = allowedPiesaDays();
    expect(piesaWindowBlockers([{ date: d[0]!, slot: "8-10" }]).length).toBeGreaterThan(0);
    expect(piesaWindowBlockers([{ date: d[0]!, slot: "8-10" }, { date: d[1]!, slot: "12-14" }, { date: d[2]!, slot: "8-10" }])).toEqual([]);
  });
  // Jo 24 Oct 2026: office-picked single offers and the installer's times — see tests/ready-check-times.core.test.ts.
  test("price seen first only when an estimate exists", () => {
    expect(priceSeenBlocker({ hasEstimate: true, estimateViewed: false })).toMatch(/estimated price/);
    expect(priceSeenBlocker({ hasEstimate: true, estimateViewed: true })).toBeNull();
    expect(priceSeenBlocker({ hasEstimate: false, estimateViewed: false })).toBeNull();
  });
});
