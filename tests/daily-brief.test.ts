import { describe, expect, test } from "bun:test";
import { briefDueFor, buildDailyBrief, melbourneMidnight, prestartNotPassed, reminderDue, reminderKey, yesterdayBounds } from "../src/lib/daily-brief.core";

const H = 3_600_000;
const start = "2026-10-10T00:00:00.000Z";
const s = Date.parse(start);

describe("visit reminders", () => {
  test("nothing more than 24h before", () => expect(reminderDue(start, s - 25 * H)).toBeNull());
  test("24h reminder from 24h until 2h before", () => { expect(reminderDue(start, s - 24 * H)).toBe("24h"); expect(reminderDue(start, s - 3 * H)).toBe("24h"); });
  test("2h reminder in the last 2 hours", () => { expect(reminderDue(start, s - 2 * H)).toBe("2h"); expect(reminderDue(start, s - 60_000)).toBe("2h"); });
  test("nothing once the visit has started", () => expect(reminderDue(start, s)).toBeNull());
  test("moved visit gets a new key; same visit keeps its key", () => {
    expect(reminderKey("b1", "24h", "owner", start)).toBe(reminderKey("b1", "24h", "owner", start));
    expect(reminderKey("b1", "24h", "owner", start)).not.toBe(reminderKey("b1", "24h", "owner", "2026-10-11T00:00:00.000Z"));
    expect(reminderKey("b1", "24h", "owner", start)).not.toBe(reminderKey("b1", "24h", "trade", start));
  });
});

describe("daily brief timing (Melbourne)", () => {
  test("not before 7am Melbourne", () => expect(briefDueFor(Date.parse("2026-10-05T19:59:00Z"), false)).toBeNull()); // 6:59am AEDT
  test("due from 7am Melbourne for that day", () => expect(briefDueFor(Date.parse("2026-10-05T20:00:00Z"), false)).toBe("2026-10-06"));
  test("once per day", () => expect(briefDueFor(Date.parse("2026-10-05T23:00:00Z"), true)).toBeNull());
  test("midnight respects daylight saving", () => {
    expect(new Date(melbourneMidnight("2026-10-06")).toISOString()).toBe("2026-10-05T13:00:00.000Z"); // AEDT +11
    expect(new Date(melbourneMidnight("2026-07-01")).toISOString()).toBe("2026-06-30T14:00:00.000Z"); // AEST +10
  });
  test("yesterday bounds", () => expect(yesterdayBounds("2026-10-06")).toEqual({ day: "2026-10-05", from: "2026-10-04T13:00:00.000Z", to: "2026-10-05T13:00:00.000Z" }));
});

describe("daily brief content", () => {
  test("groups needs by urgency and sorts risks by time", () => {
    const b = buildDailyBrief({ date: "2026-10-06", apQueue: 2, needs: [{ urgency: "soon", jobNumber: "A", why: "x" }, { urgency: "urgent", jobNumber: "B", why: "y" }],
      atRisk: [{ kind: "esc_deadline", jobNumber: "C", when: "2026-10-09T00:00:00Z", detail: "" }, { kind: "clock_30_day", jobNumber: "D", when: "2026-10-07", detail: "" }],
      yesterday: { day: "2026-10-05", enquiries: 1, bookings: 0, installs: 0, veecsSubmitted: 0, veecsRegistered: 0 } });
    expect(b.needs.urgent.map((n) => n.jobNumber)).toEqual(["B"]);
    expect(b.needs.soon.map((n) => n.jobNumber)).toEqual(["A"]);
    expect(b.atRisk.map((r) => r.jobNumber)).toEqual(["D", "C"]);
  });
  test("install at risk unless the latest check for that start passed", () => {
    const bk = [{ job_id: "j1", scheduled_start: start }, { job_id: "j2", scheduled_start: start }, { job_id: "j3", scheduled_start: start }];
    const checks = [
      { job_id: "j1", scheduled_start: start, passed: false, checked_at: "2026-10-09T01:00:00Z" }, { job_id: "j1", scheduled_start: start, passed: true, checked_at: "2026-10-09T02:00:00Z" },
      { job_id: "j2", scheduled_start: start, passed: true, checked_at: "2026-10-09T01:00:00Z" }, { job_id: "j2", scheduled_start: start, passed: false, checked_at: "2026-10-09T02:00:00Z" },
    ];
    expect(prestartNotPassed(bk, checks).map((b) => b.job_id)).toEqual(["j2", "j3"]);
  });
});
