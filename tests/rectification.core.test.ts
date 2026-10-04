import { describe, expect, test } from "bun:test";
import { heldWindowAction, pickableRectWindows, rectHoursBlocker, rectPlanBlockers, rectQuoteTimerAction, rectQuoteUnanswered } from "../src/lib/rectification.core";
import { allowedPiesaDays } from "../src/lib/piesa-windows.core";
import { buildNeedsHivic } from "../src/lib/allocation.core";

const now = new Date("2026-05-04T00:00:00Z"); // Mon 10am Melbourne
const H = 3_600_000, D = 86_400_000;
const at = (ms: number) => new Date(now.getTime() + ms).toISOString();

describe("rectification rules", () => {
  test("hours required and in range", () => {
    expect(rectHoursBlocker(null)).toBeTruthy();
    expect(rectHoursBlocker(0)).toBeTruthy();
    expect(rectHoursBlocker(101)).toBeTruthy();
    expect(rectHoursBlocker(3.5)).toBeNull();
  });
  test("electrician windows use the same day rules (3-5, 3 days)", () => {
    const d = allowedPiesaDays(now);
    expect(rectPlanBlockers(4, [{ date: d[0]!, slot: "morning" }], now).length).toBeGreaterThan(0);
    expect(rectPlanBlockers(4, [{ date: d[0]!, slot: "morning" }, { date: d[1]!, slot: "afternoon" }, { date: d[2]!, slot: "morning" }], now)).toEqual([]);
  });
  test("owner sees only windows at least 24 hours away", () => {
    const w = [{ id: "a", starts_at: at(20 * H), status: "proposed" }, { id: "b", starts_at: at(25 * H), status: "proposed" }, { id: "c", starts_at: at(48 * H), status: "accepted" }];
    expect(pickableRectWindows(w, now).map((x) => x.id)).toEqual(["b"]);
    expect(pickableRectWindows([w[0]!], now)).toEqual([]);
  });
  test("nudges at 24h and day 3, rectification only", () => {
    const q = { kind: "rectification", status: "issued", sent_at: at(-25 * H), nudge_24h_at: null, nudge_day3_at: null };
    expect(rectQuoteTimerAction({ ...q, sent_at: at(-23 * H) }, now)).toBeNull();
    expect(rectQuoteTimerAction(q, now)).toBe("nudge_24h");
    expect(rectQuoteTimerAction({ ...q, nudge_24h_at: at(0) }, now)).toBeNull();
    expect(rectQuoteTimerAction({ ...q, sent_at: at(-3 * D), nudge_24h_at: at(0) }, now)).toBe("nudge_day3");
    expect(rectQuoteTimerAction({ ...q, kind: "installation" }, now)).toBeNull();
    expect(rectQuoteTimerAction({ ...q, status: "accepted" }, now)).toBeNull();
  });
  test("day 5 unanswered goes to needs-attention; never expires", () => {
    expect(rectQuoteUnanswered({ kind: "rectification", status: "issued", sent_at: at(-4.9 * D) }, now)).toBe(false);
    expect(rectQuoteUnanswered({ kind: "rectification", status: "issued", sent_at: at(-5 * D) }, now)).toBe(true);
    const items = buildNeedsHivic({ now, jobs: [{ id: "j", job_number: "HV-1" }], coverageExhausted: [], releases: [], failedComms: [], rectDeclined: [], rectPricing: [], installerUnavailable: [], piesaTiming: [], escTiming: [], evidenceRejected: [], registryQueries: [], officeOverdue: [], rectUnanswered: [{ job_id: "j", sent_at: at(-6 * D) }] });
    expect(items[0]?.code).toBe("rectification_quote_unanswered");
    expect(items[0]?.why).toContain("30-day clock at risk");
  });
  test("held pick books if still ahead, else falls back", () => {
    expect(heldWindowAction(at(H), now)).toBe("book");
    expect(heldWindowAction(at(-H), now)).toBe("lapsed");
  });
});
