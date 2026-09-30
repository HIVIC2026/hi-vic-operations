import { describe, expect, test } from "bun:test";
import { stuckReasons } from "../src/lib/stuck.core";

const now = new Date("2026-09-30T05:00:00Z");
const base = { stage: "assessment_booking", lastActivityAt: "2026-09-29T05:00:00Z", invoiceSyncErrors: [], readyCheckFailed: false, readyCheckPaidAt: null, confirmedBookings: [] };

describe("stuckReasons", () => {
  test("healthy job", () => expect(stuckReasons(base, now)).toEqual([]));
  test("closed jobs never flagged", () => expect(stuckReasons({ ...base, stage: "complete", invoiceSyncErrors: ["x"] }, now)).toEqual([]));
  test("xero error", () => expect(stuckReasons({ ...base, invoiceSyncErrors: ["401 unauthorised"] }, now)[0]).toMatch(/Xero sync failed/));
  test("ready check failed", () => expect(stuckReasons({ ...base, readyCheckFailed: true }, now)).toHaveLength(1));
  test("ready check paid but stale", () => expect(stuckReasons({ ...base, readyCheckPaidAt: "2026-09-28T00:00:00Z" }, now)).toHaveLength(1));
  test("ready check paid recently ok", () => expect(stuckReasons({ ...base, readyCheckPaidAt: "2026-09-30T01:00:00Z" }, now)).toEqual([]));
  test("confirmed booking not advanced", () => expect(stuckReasons({ ...base, confirmedBookings: [{ kind: "assessment", scheduled_start: "2026-10-02T00:00:00Z" }] }, now)[0]).toMatch(/assessment booked/));
  test("booking already advanced ok", () => expect(stuckReasons({ ...base, stage: "assessment_booked", confirmedBookings: [{ kind: "assessment", scheduled_start: "x" }] }, now)).toEqual([]));
  test("idle 7 days", () => expect(stuckReasons({ ...base, lastActivityAt: "2026-09-20T00:00:00Z" }, now)).toContain("No activity for over 7 days"));
});
