import { describe, expect, test } from "bun:test";
import {
  autoOfferExclusion, autoOfferMisses, autoOfferReturnedSummary, autoOfferStep, autoOfferSwitchOn, rankAutoElectricians, rankAutoInstallers,
  type AutoOfferCandidate, type AutoOfferFacts, type AutoOfferRow,
} from "../src/lib/auto-offer.core";

// Decision 246: automatic offers by coverage.
const cand = (id: string, o: Partial<AutoOfferCandidate> = {}): AutoOfferCandidate => ({
  business_id: id, name: id.toUpperCase(), coversPostcode: true, paused: false, credentialsOk: true, workersCleared: true, blocker: null, activeJobs: 0, distanceKm: 10, ...o,
});
const base = (kind: "ready_check" | "piesa", rows: AutoOfferRow[] = []): AutoOfferFacts => ({ kind, switchOn: true, jobReady: true, hasTrade: false, returned: false, rows });
const miss = (id: string, status = "declined"): AutoOfferRow => ({ business_id: id, status, offered_at: "2026-10-24T00:00:00Z", auto: true });

test("switches fail closed", () => {
  expect(autoOfferSwitchOn(null, "ready_check")).toBe(false);
  expect(autoOfferSwitchOn({}, "piesa")).toBe(false);
  expect(autoOfferSwitchOn({ auto_installer_offers: "true" }, "ready_check")).toBe(false);
  expect(autoOfferSwitchOn({ auto_installer_offers: true }, "ready_check")).toBe(true);
  expect(autoOfferSwitchOn({ auto_installer_offers: true }, "piesa")).toBe(false);
  expect(autoOfferStep({ ...base("ready_check"), switchOn: false, candidates: [cand("a")] })).toEqual({ action: "none", reason: "switch_off" });
});

describe("installer pick", () => {
  test("only coverage-matching, unpaused, PL-current, CII-cleared installers; fewest active jobs then nearest", () => {
    const cs = [
      cand("far", { activeJobs: 0, distanceKm: 80 }), cand("near", { activeJobs: 0, distanceKm: 5 }), cand("busy", { activeJobs: 3, distanceKm: 1 }),
      cand("nocover", { coversPostcode: false, distanceKm: 0 }), cand("paused", { paused: true }), cand("pl", { credentialsOk: false }), cand("cii", { workersCleared: false }),
    ];
    expect(rankAutoInstallers(cs).map((c) => c.business_id)).toEqual(["near", "far", "busy"]);
    expect(autoOfferExclusion(cs[3]!, new Set())).toContain("Coverage");
    expect(autoOfferExclusion(cs[4]!, new Set())).toContain("Paused");
    expect(autoOfferExclusion(cs[5]!, new Set())).toContain("public liability");
    expect(autoOfferExclusion(cs[6]!, new Set())).toContain("CII");
    expect(autoOfferStep({ ...base("ready_check"), candidates: cs })).toMatchObject({ action: "offer", businessId: "near", attempt: 1, basis: "coverage" });
  });
  test("unknown distance sorts last among equal loads", () => {
    expect(rankAutoInstallers([cand("x", { distanceKm: null }), cand("y", { distanceKm: 40 })]).map((c) => c.business_id)).toEqual(["y", "x"]);
  });
  test("next match after a decline or lapse; never the same installer twice", () => {
    const cs = [cand("a", { distanceKm: 1 }), cand("b", { distanceKm: 2 })];
    expect(autoOfferStep({ ...base("ready_check", [miss("a")]), candidates: cs })).toMatchObject({ action: "offer", businessId: "b", attempt: 2 });
    expect(autoOfferStep({ ...base("ready_check", [miss("a", "expired")]), candidates: cs })).toMatchObject({ businessId: "b" });
  });
  test("after 2 misses the job goes back to the office (Needs me “Choose again”)", () => {
    const step = autoOfferStep({ ...base("ready_check", [miss("a"), miss("b", "expired")]), candidates: [cand("c")] });
    expect(step).toEqual({ action: "return_to_office", reason: "two_misses", misses: 2, tried: ["a", "b"] });
    expect(autoOfferReturnedSummary("ready_check", "two_misses", 2)).toContain("choose again");
  });
  test("no other match → back to the office straight away", () => {
    expect(autoOfferStep({ ...base("ready_check", [miss("a")]), candidates: [cand("a")] })).toMatchObject({ action: "return_to_office", reason: "no_match", misses: 1 });
    expect(autoOfferStep({ ...base("ready_check"), candidates: [] })).toMatchObject({ action: "return_to_office", reason: "no_match", misses: 0 });
  });
});

describe("nothing happens when", () => {
  const cs = [cand("a")];
  test.each([
    ["job not ready", { jobReady: false }, "job_not_ready"],
    ["trade assigned", { hasTrade: true }, "already_assigned"],
    ["already returned", { returned: true }, "returned_to_office"],
  ] as const)("%s", (_n, patch, reason) => {
    expect(autoOfferStep({ ...base("ready_check"), ...patch, candidates: cs })).toEqual({ action: "none", reason });
  });
  test("an offer is open, or the office made its own offer", () => {
    expect(autoOfferStep({ ...base("piesa", [{ ...miss("a"), status: "pending" }]), candidates: cs })).toEqual({ action: "none", reason: "offer_open" });
    expect(autoOfferStep({ ...base("piesa", [{ ...miss("b"), auto: false }]), candidates: cs })).toEqual({ action: "none", reason: "office_in_charge" });
  });
});

describe("electrician pick", () => {
  test("usual electrician first when eligible, else nearest approved REC covering the postcode", () => {
    const cs = [cand("near", { distanceKm: 3 }), cand("usual", { distanceKm: 50, activeJobs: 9 }), cand("mid", { distanceKm: 10 })];
    expect(rankAutoElectricians(cs, new Set(), "usual").map((c) => c.business_id)).toEqual(["usual", "near", "mid"]);
    expect(autoOfferStep({ ...base("piesa"), candidates: cs, usualBusinessId: "usual" })).toMatchObject({ action: "offer", businessId: "usual", basis: "usual_electrician" });
    expect(autoOfferStep({ ...base("piesa", [miss("usual")]), candidates: cs, usualBusinessId: "usual" })).toMatchObject({ action: "offer", businessId: "near", basis: "coverage", attempt: 2 });
  });
  test("a blocked usual electrician (e.g. no agreed rate) is skipped", () => {
    const cs = [cand("usual", { blocker: "No agreed electrician rate recorded." }), cand("near", { distanceKm: 3 })];
    expect(autoOfferStep({ ...base("piesa"), candidates: cs, usualBusinessId: "usual" })).toMatchObject({ businessId: "near" });
  });
  test("misses only count automatic offers", () => {
    expect(autoOfferMisses([miss("a"), { ...miss("b"), auto: false }, { ...miss("c"), status: "accepted" }])).toBe(1);
  });
});
