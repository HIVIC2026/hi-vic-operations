import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  acceptanceWithCancellations, canMarkArrived, canMarkOwnerNotHome, ownerChangeAllowed, ownerMissOutcome, reliabilityFacts, reopenPlan, tradeNoShowDue,
} from "../src/lib/visit-events.core";
import { buildNeedsHivic, rankRecCandidates } from "../src/lib/allocation.core";

const NOW = new Date("2026-10-10T00:00:00Z");
const h = (n: number) => new Date(NOW.getTime() + n * 3_600_000).toISOString();

describe("owner 24h rule and misses", () => {
  test("change allowed only more than 24h before", () => {
    expect(ownerChangeAllowed(h(25), NOW)).toBe(true);
    expect(ownerChangeAllowed(h(24), NOW)).toBe(false);
    expect(ownerChangeAllowed(h(3), NOW)).toBe(false);
  });
  test("first miss = one free rebook; second = office", () => {
    expect(ownerMissOutcome(0)).toBe("rebook");
    expect(ownerMissOutcome(1)).toBe("needs_office");
    expect(ownerMissOutcome(3)).toBe("needs_office");
  });
  test("owner not home only after the start", () => {
    expect(canMarkOwnerNotHome(h(1), NOW)).toBe(false);
    expect(canMarkOwnerNotHome(h(-0.1), NOW)).toBe(true);
  });
});

describe("trade arrival and no-show", () => {
  test("arrival window: 2h before to 4h after", () => {
    expect(canMarkArrived(h(3), NOW)).toBe(false);
    expect(canMarkArrived(h(1.5), NOW)).toBe(true);
    expect(canMarkArrived(h(-3.9), NOW)).toBe(true);
    expect(canMarkArrived(h(-4), NOW)).toBe(false);
  });
  test("no-show only after 4h with no arrival and no evidence", () => {
    expect(tradeNoShowDue({ startIso: h(-3.9), arrived: false, evidenceSinceStart: 0 }, NOW)).toBe(false);
    expect(tradeNoShowDue({ startIso: h(-4), arrived: false, evidenceSinceStart: 0 }, NOW)).toBe(true);
    expect(tradeNoShowDue({ startIso: h(-6), arrived: true, evidenceSinceStart: 0 }, NOW)).toBe(false);
    expect(tradeNoShowDue({ startIso: h(-6), arrived: false, evidenceSinceStart: 1 }, NOW)).toBe(false);
  });
});

describe("reopen plan per visit type", () => {
  test("PIESA and Ready Check release the trade; installer never replaced; rectification to office", () => {
    expect(reopenPlan("assessment")).toEqual({ stage: "piesa_and_install_window_pending", releaseTrade: true, office: false });
    expect(reopenPlan("ready_check")).toEqual({ stage: "ready_check_ready_to_schedule", releaseTrade: true, office: false });
    expect(reopenPlan("installation")).toEqual({ stage: "installation_scheduling", releaseTrade: false, office: false });
    expect(reopenPlan("rectification").office).toBe(true);
  });
});

describe("real reliability", () => {
  const row = (id: string, event: string, ago: number, extra: Partial<{ business_id: string | null; counts_against: string; clears_event_id: string | null }> = {}) =>
    ({ id, business_id: "B1", event, counts_against: "trade", clears_event_id: null, created_at: h(-24 * ago), ...extra });
  test("counts no-shows, rejections, cancellations in 90 days; cleared and owner-side ignored", () => {
    const f = reliabilityFacts([
      row("1", "trade_no_show", 5), row("2", "trade_no_show", 10), row("3", "no_show_cleared", 9, { business_id: null, counts_against: "none", clears_event_id: "2" }),
      row("4", "evidence_rejected", 20), row("5", "trade_cancelled", 30), row("6", "trade_no_show", 120),
      row("7", "owner_no_show", 1, { counts_against: "owner" }),
    ], NOW).get("B1");
    expect(f).toEqual({ no_shows: 1, evidence_rejections: 1, trade_cancellations: 1 });
  });
  test("a cancellation lowers acceptance like a decline", () => {
    expect(acceptanceWithCancellations(3, 4, 0)).toBe(0.75);
    expect(acceptanceWithCancellations(3, 4, 2)).toBe(0.5);
    expect(acceptanceWithCancellations(0, 0, 0)).toBeNull();
  });
  test("ranking now drops a trade with real no-shows (price never used)", () => {
    const base = { is_active: true, onboarding_status: "approved", coverage_verified: true, covers_postcode: true, has_valid_licence: true, approved_workers: 1, acceptance_rate: 0.8, recent_jobs_30d: 1, avg_accept_hours: 1 } as never;
    const a = { ...(base as object), business_id: "A", name: "A", no_shows: 2 }, b = { ...(base as object), business_id: "B", name: "B", no_shows: 0 };
    expect(rankRecCandidates([a, b] as never).map((c: { business_id: string }) => c.business_id)).toEqual(["B", "A"]);
  });
});

describe("needs-attention items", () => {
  test("visit flags appear with their own wording", () => {
    const items = buildNeedsHivic({
      now: NOW, jobs: [{ id: "J", job_number: "HV-1", stage: "piesa_scheduled", suburb: null }], coverageExhausted: [], releases: [], failedComms: [], rectDeclined: [], rectPricing: [],
      installerUnavailable: [], piesaTiming: [], escTiming: [], evidenceRejected: [], registryQueries: [], officeOverdue: [],
      visitFlags: [{ job_id: "J", code: "trade_no_show", created_at: h(-1) }, { job_id: "J", code: "owner_no_show_repeat", created_at: h(-2) }],
    } as never);
    expect(items.map((i) => i.code).sort()).toEqual(["owner_no_show_repeat", "trade_no_show"]);
    expect(items.find((i) => i.code === "trade_no_show")!.urgency).toBe("urgent");
  });
});

describe("wiring (static)", () => {
  const src = (f: string) => readFileSync(f, "utf8");
  test("matching uses real reliability, not zeros", () => {
    for (const f of ["src/lib/allocation.server.ts", "src/lib/readycheck-booking.server.ts"]) {
      expect(src(f)).toContain("reliabilityFor(ids)");
      expect(src(f)).not.toContain("no_shows: 0");
    }
  });
  test("rejected evidence counts against the uploader's business", () => {
    expect(src("src/lib/portal.functions.ts")).toMatch(/status === "rejected"[\s\S]{0,200}recordEvidenceRejected/);
  });
  test("no-show timer skips Test Centre jobs and runs on the 15-minute tick", () => {
    expect(src("src/lib/visit-events.server.ts")).toContain('=== "qa_test") continue');
    expect(src("src/routes/api/public/hooks/allocation-tick.ts")).toContain("sweepTradeNoShows");
  });
  test("reopened times are recorded only — no dead outbox row (F13), never sent directly", () => {
    const s = src("src/lib/visit-events.server.ts");
    expect(s).not.toContain("enqueue_external_action");
    expect(s).toContain('"visit_times_reopened"');
    expect(s).not.toMatch(/sendEmail|resend|fetch\(/i);
  });
});
