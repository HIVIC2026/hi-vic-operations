import { describe, expect, test } from "bun:test";
import { quoteExpiresAt, quoteIsExpired, quoteTimerAction } from "../src/lib/quote-expiry.core";

const base = { kind: "installation", status: "issued", nudge_day3_at: null, nudge_day10_at: null };
// 1 March 2026 10:00 Melbourne (AEDT, UTC+11) = 23:00 UTC 28 Feb
const sent = "2026-02-28T23:00:00Z";
const at = (iso: string) => new Date(iso);

describe("quote expiry (14 full days, Melbourne calendar)", () => {
  test("sent on the 1st expires at the end of the 15th", () => {
    // midnight 16 March Melbourne (AEDT) = 13:00 UTC 15 March
    expect(quoteExpiresAt(sent).toISOString()).toBe("2026-03-15T13:00:00.000Z");
    expect(quoteIsExpired({ kind: "installation", sent_at: sent }, at("2026-03-15T12:59:00Z"))).toBe(false);
    expect(quoteIsExpired({ kind: "installation", sent_at: sent }, at("2026-03-15T13:00:00Z"))).toBe(true);
  });
  test("rectification quotes and quotes without a sent date never expire", () => {
    expect(quoteIsExpired({ kind: "rectification", sent_at: sent }, at("2027-01-01T00:00:00Z"))).toBe(false);
    expect(quoteIsExpired({ kind: "installation", sent_at: null }, at("2027-01-01T00:00:00Z"))).toBe(false);
  });
});

describe("timer actions", () => {
  test("nothing before day 3", () => {
    expect(quoteTimerAction({ ...base, sent_at: sent }, at("2026-03-03T22:00:00Z"))).toBeNull();
  });
  test("day 3 nudge once", () => {
    expect(quoteTimerAction({ ...base, sent_at: sent }, at("2026-03-03T23:00:00Z"))).toBe("nudge_day3");
    expect(quoteTimerAction({ ...base, sent_at: sent, nudge_day3_at: "x" }, at("2026-03-05T00:00:00Z"))).toBeNull();
  });
  test("day 10 nudge once", () => {
    expect(quoteTimerAction({ ...base, sent_at: sent, nudge_day3_at: "x" }, at("2026-03-10T23:00:00Z"))).toBe("nudge_day10");
    expect(quoteTimerAction({ ...base, sent_at: sent, nudge_day3_at: "x", nudge_day10_at: "y" }, at("2026-03-12T00:00:00Z"))).toBeNull();
  });
  test("late timer skips the stale day 3 nudge", () => {
    expect(quoteTimerAction({ ...base, sent_at: sent }, at("2026-03-11T00:00:00Z"))).toBe("nudge_day10");
  });
  test("expires at 14 full days", () => {
    expect(quoteTimerAction({ ...base, sent_at: sent, nudge_day3_at: "x", nudge_day10_at: "y" }, at("2026-03-15T13:00:00Z"))).toBe("expire");
  });
  test("no action for accepted, declined, superseded, expired, rectification or unsent quotes", () => {
    const late = at("2026-03-20T00:00:00Z");
    for (const status of ["accepted", "declined", "superseded", "expired", "draft"]) expect(quoteTimerAction({ ...base, status, sent_at: sent }, late)).toBeNull();
    expect(quoteTimerAction({ ...base, kind: "rectification", sent_at: sent }, late)).toBeNull();
    expect(quoteTimerAction({ ...base, sent_at: null }, late)).toBeNull();
  });
});
