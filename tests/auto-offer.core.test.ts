import { describe, expect, test } from "bun:test";
import {
  AUTO_OFFER_READY_STAGES, autoOfferExclusion, autoOfferMisses, autoOfferParityBlocker, autoOfferReturnedSummary, autoOfferStageReady, autoOfferStep, autoOfferSwitchOn,
  rankAutoElectricians, rankAutoInstallers, type AutoOfferCandidate, type AutoOfferFacts, type AutoOfferRow,
} from "../src/lib/auto-offer.core";
import { TEST_PARTNER_MARK, isTestPartner, partnerAllowedForJob } from "../src/lib/test-send.core";

// Decision 246: automatic offers by coverage.
const cand = (id: string, o: Partial<AutoOfferCandidate> = {}): AutoOfferCandidate => ({
  business_id: id, name: id.toUpperCase(), coversPostcode: true, paused: false, credentialsOk: true, workersCleared: true, blocker: null, activeJobs: 0, distanceKm: 10, testPartner: false, ...o,
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

describe("TEST / live parity (qa_test jobs are offered too, but only to TEST partners)", () => {
  const live = cand("live", { distanceKm: 1 });
  const testBiz = cand("test", { distanceKm: 2, testPartner: true });
  test("a TEST job skips every live partner and a live job skips every TEST partner, both ways fail closed", () => {
    expect(autoOfferParityBlocker(testBiz, true)).toBeNull();
    expect(autoOfferParityBlocker(live, true)).toContain("TEST job");
    expect(autoOfferParityBlocker(live, false)).toBeNull();
    expect(autoOfferParityBlocker(testBiz, false)).toContain("never");
    // An unknown flag is never treated as a TEST partner for a TEST job.
    expect(autoOfferParityBlocker({ testPartner: undefined as unknown as boolean }, true)).not.toBeNull();
    expect(autoOfferExclusion(live, new Set(), true)).toContain("TEST");
    expect(autoOfferExclusion(testBiz, new Set(), false)).toContain("TEST");
  });
  test("ranking honours parity for installers and electricians", () => {
    expect(rankAutoInstallers([live, testBiz], new Set(), true).map((c) => c.business_id)).toEqual(["test"]);
    expect(rankAutoInstallers([live, testBiz], new Set(), false).map((c) => c.business_id)).toEqual(["live"]);
    expect(rankAutoInstallers([live, testBiz]).map((c) => c.business_id)).toEqual(["live"]); // default = live job
    expect(rankAutoElectricians([live, testBiz], new Set(), "test", true).map((c) => c.business_id)).toEqual(["test"]);
    expect(rankAutoElectricians([live, testBiz], new Set(), "test", false).map((c) => c.business_id)).toEqual(["live"]);
  });
  test("a TEST job gets the automatic offer, to the TEST partner only; with no TEST partner it goes back to the office", () => {
    expect(autoOfferStep({ ...base("ready_check"), jobIsTest: true, candidates: [live, testBiz] })).toMatchObject({ action: "offer", businessId: "test" });
    expect(autoOfferStep({ ...base("piesa"), jobIsTest: true, candidates: [live, testBiz], usualBusinessId: "live" })).toMatchObject({ action: "offer", businessId: "test", basis: "coverage" });
    expect(autoOfferStep({ ...base("ready_check"), jobIsTest: true, candidates: [live] })).toMatchObject({ action: "return_to_office", reason: "no_match" });
    // Live job: the TEST partner is never the pick, even when it is the nearest or the usual electrician.
    expect(autoOfferStep({ ...base("ready_check"), candidates: [testBiz, live] })).toMatchObject({ action: "offer", businessId: "live" });
    expect(autoOfferStep({ ...base("piesa"), jobIsTest: false, candidates: [testBiz, live], usualBusinessId: "test" })).toMatchObject({ action: "offer", businessId: "live" });
    expect(autoOfferStep({ ...base("piesa"), candidates: [testBiz] })).toMatchObject({ action: "return_to_office", reason: "no_match" });
  });
  test("the parity rule is the same one the candidate readers and offer guard use (test-send.core)", () => {
    const marked = { onboarding_notes: `${TEST_PARTNER_MARK} Reinsulate` };
    const plain = { onboarding_notes: "TEST Sparkies" }; // a name/notes prefix alone is NOT the TEST-partner mark
    for (const [biz, source] of [[marked, "qa_test"], [marked, "website"], [plain, "qa_test"], [plain, "website"]] as const) {
      const c = { testPartner: isTestPartner(biz) };
      expect(autoOfferParityBlocker(c, source === "qa_test") === null).toBe(partnerAllowedForJob(biz, source));
    }
  });
});

describe("ready stages", () => {
  test("PIESA waits in measured_quote_accepted (after acceptance + $349) or back in piesa_and_install_window_pending", () => {
    expect(AUTO_OFFER_READY_STAGES.piesa).toEqual(["measured_quote_accepted", "piesa_and_install_window_pending"]);
    expect(autoOfferStageReady("piesa", "measured_quote_accepted")).toBe(true);
    expect(autoOfferStageReady("piesa", "piesa_scheduled")).toBe(false);
    expect(autoOfferStageReady("ready_check", "ready_check_ready_to_schedule")).toBe(true);
    expect(autoOfferStageReady("ready_check", "measured_quote_accepted")).toBe(false);
    expect(autoOfferStageReady("ready_check", null)).toBe(false);
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
