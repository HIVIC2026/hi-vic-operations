// Ready Check booking rules (pure). Price is never a ranking input.
import { describe, expect, test } from "bun:test";
import {
  fullCurrentCert, installerCandidate, installerEligibilityBlocker, nextInstallerBatch, priceSeenBlocker, readyCheckNoTakerStep, readyCheckStartBlockers,
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
  test("ranking: nearby that day → reliability → fewest recent → speed; top 3 then next 3", () => {
    const c = [
      base({ business_id: "far", name: "A", acceptance_rate: 1 }),
      base({ business_id: "near", name: "B", nearby_job_that_day: true, acceptance_rate: 0.1 }),
      base({ business_id: "busy", name: "C", acceptance_rate: 1, recent_jobs_30d: 9 }),
      base({ business_id: "slow", name: "D", acceptance_rate: 1, avg_accept_hours: 9 }),
      base({ business_id: "x", name: "E", fullCertifiedInstallers: 0 }),
    ];
    const first = nextInstallerBatch(c, new Set(), 3).map((x) => x.business_id);
    expect(first).toEqual(["near", "slow", "far"].sort((a, b) => first.indexOf(a) - first.indexOf(b)));
    expect(first[0]).toBe("near");
    expect(first).not.toContain("x");
    expect(nextInstallerBatch(c, new Set(first), 3).map((x) => x.business_id)).toEqual(["busy"]);
  });
});

describe("Ready Check flow rules", () => {
  test("windows: same rules as PIESA (3–5, 3 different days)", () => {
    const d = allowedPiesaDays();
    expect(piesaWindowBlockers([{ date: d[0]!, slot: "8-10" }]).length).toBeGreaterThan(0);
    expect(piesaWindowBlockers([{ date: d[0]!, slot: "8-10" }, { date: d[1]!, slot: "12-14" }, { date: d[2]!, slot: "8-10" }])).toEqual([]);
  });
  test("offers start only when waiting, no installer, owner times open, no open offers", () => {
    expect(readyCheckStartBlockers({ stage: "ready_check_ready_to_schedule", hasInstaller: false, openWindows: 3, hasOpenOffers: false })).toEqual([]);
    expect(readyCheckStartBlockers({ stage: "ready_check_scheduled", hasInstaller: true, openWindows: 0, hasOpenOffers: true })).toHaveLength(4);
  });
  test("no taker: round 1 asks owner once; round 2 goes to needs attention", () => {
    expect(readyCheckNoTakerStep(1)).toBe("ask_owner_for_more_times");
    expect(readyCheckNoTakerStep(2)).toBe("needs_attention");
  });
  test("price seen first only when an estimate exists", () => {
    expect(priceSeenBlocker({ hasEstimate: true, estimateViewed: false })).toMatch(/estimated price/);
    expect(priceSeenBlocker({ hasEstimate: true, estimateViewed: true })).toBeNull();
    expect(priceSeenBlocker({ hasEstimate: false, estimateViewed: false })).toBeNull();
  });
});
