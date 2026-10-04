import { describe, expect, test } from "bun:test";
import { nextOfferBatch, offerExpiryBusinessHours, rankRecCandidates, recEligibilityBlocker, type RecCandidate } from "../src/lib/allocation.core";

const base = (id: string, o: Partial<RecCandidate> = {}): RecCandidate => ({
  business_id: id, name: id, is_active: true, onboarding_status: "approved", accepting_new_jobs: true, receives_hivic_leads: true,
  coverage_verified: true, covers_postcode: true, exact_postcode: true, has_valid_licence: true, approved_workers: 1,
  weekly_capacity: null, open_jobs: 0, recent_offers_30d: 0, acceptance_rate: null, ...o,
});

describe("eligibility", () => {
  test("booked in every owner time = not eligible; unknown times = skipped", () => {
    expect(recEligibilityBlocker(base("a", { free_in_window: false }))).toContain("every one of the owner's times");
    expect(recEligibilityBlocker(base("a", { free_in_window: null }))).toBeNull();
    expect(recEligibilityBlocker(base("a", { free_in_window: true }))).toBeNull();
  });
  test("no daily limit: trades run their own diaries", () => {
    expect(recEligibilityBlocker(base("a", { daily_limit: 2, max_jobs_on_window_day: 9 } as never))).toBeNull();
  });
});

describe("ranking", () => {
  const ids = (r: RecCandidate[]) => r.map((c) => c.business_id);
  test("nearby job that day beats reliability", () => {
    expect(ids(rankRecCandidates([base("a", { acceptance_rate: 1 }), base("b", { nearby_job_that_day: true, acceptance_rate: 0 })]))).toEqual(["b", "a"]);
  });
  test("then reliability (no-shows and evidence rejections count against)", () => {
    expect(ids(rankRecCandidates([base("a", { acceptance_rate: 0.9, no_shows: 2 }), base("b", { acceptance_rate: 0.8 })]))).toEqual(["b", "a"]);
  });
  test("then fewest recent jobs, then speed", () => {
    expect(ids(rankRecCandidates([base("a", { recent_jobs_30d: 5 }), base("b", { recent_jobs_30d: 1 })]))).toEqual(["b", "a"]);
    expect(ids(rankRecCandidates([base("a", { avg_accept_hours: 3 }), base("b", { avg_accept_hours: 0.5 }), base("c")]))).toEqual(["b", "a", "c"]);
  });
  test("price is never a factor", () => {
    expect(ids(rankRecCandidates([base("a", { electrician_rate_inc_gst: 500 }), base("b", { electrician_rate_inc_gst: 100 })]))).toEqual(["a", "b"]);
  });
  test("preferred first only on installer-supplied jobs", () => {
    const c = [base("a", { nearby_job_that_day: true }), base("b", { preferred: true })];
    expect(ids(rankRecCandidates(c))).toEqual(["a", "b"]);
    const r = rankRecCandidates(c, { installerSourced: true });
    expect(ids(r)).toEqual(["b", "a"]);
    expect(ids(nextOfferBatch(r, new Set(), 3, { installerSourced: true }))).toEqual(["b"]);
    expect(ids(nextOfferBatch(rankRecCandidates(c), new Set(), 3))).toEqual(["a", "b"]);
  });
  test("top 3 at once, then next 3", () => {
    const r = rankRecCandidates(["a", "b", "c", "d", "e"].map((x) => base(x)));
    expect(ids(nextOfferBatch(r, new Set(), 3))).toEqual(["a", "b", "c"]);
    expect(ids(nextOfferBatch(r, new Set(["a", "b", "c"]), 3))).toEqual(["d", "e"]);
  });
});

describe("4 Melbourne business hours to accept", () => {
  test("within one day", () => {
    // Tue 6 Oct 2026, 9am Melbourne (AEDT, UTC+11) = 5 Oct 22:00Z -> 1pm
    expect(offerExpiryBusinessHours(new Date("2026-10-05T22:00:00Z"), 4)).toBe("2026-10-06T02:00:00.000Z");
  });
  test("Friday 4pm -> Monday 11am", () => {
    // Fri 9 Oct 2026 4pm AEDT = 05:00Z; Mon 12 Oct 11am AEDT = 00:00Z
    expect(offerExpiryBusinessHours(new Date("2026-10-09T05:00:00Z"), 4)).toBe("2026-10-12T00:00:00.000Z");
  });
  test("evening offer starts next morning", () => {
    // Tue 6 Oct 8pm AEDT = 09:00Z -> Wed 7 Oct 12pm AEDT = 01:00Z
    expect(offerExpiryBusinessHours(new Date("2026-10-06T09:00:00Z"), 4)).toBe("2026-10-07T01:00:00.000Z");
  });
  test("skips Vic public holiday (Melbourne Cup, Tue 3 Nov 2026)", () => {
    // Mon 2 Nov 3pm AEDT = 04:00Z -> 2h Mon, 2h Wed -> Wed 4 Nov 10am AEDT = 23:00Z on 3 Nov
    expect(offerExpiryBusinessHours(new Date("2026-11-02T04:00:00Z"), 4)).toBe("2026-11-03T23:00:00.000Z");
  });
});
