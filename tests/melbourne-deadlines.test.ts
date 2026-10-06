import { describe, expect, test } from "bun:test";
import { addBusinessDays, buildComplianceTimeline } from "../src/lib/compliance-timeline.core";
import { addMelbourneCalendarDays, melbourneMonthStart } from "../src/lib/melbourne-time.core";

describe("Melbourne deadlines (security review 6 Oct)", () => {
  test("business days count Melbourne dates, not UTC: 11:30pm Fri Melbourne is still Friday", () => {
    // Fri 9 Oct 2026 23:30 AEDT = 12:30 UTC Fri. 1 business day later = Mon 12 Oct, end of day Melbourne.
    expect(addBusinessDays("2026-10-09T12:30:00Z", 1)).toBe("2026-10-12T12:59:59.999Z");
    // Sat 10 Oct 00:30 AEDT = Fri 13:30 UTC. UTC would say Friday; Melbourne says Saturday -> still Mon.
    expect(addBusinessDays("2026-10-09T13:30:00Z", 1)).toBe("2026-10-12T12:59:59.999Z");
  });
  test("skips Victorian public holidays (Melbourne Cup, Tue 3 Nov 2026)", () => {
    // Mon 2 Nov 2026 10am AEDT -> next business day is Wed 4 Nov.
    expect(addBusinessDays("2026-11-01T23:00:00Z", 1)).toBe("2026-11-04T12:59:59.999Z");
  });
  test("PIESA 30 days are Melbourne calendar days across the DST start (4 Oct 2026)", () => {
    // PIESA Thu 24 Sep 2026 (AEST). Day 30 = Sat 24 Oct (AEDT): due 23:59:59.999 AEDT = 12:59:59.999Z.
    expect(addMelbourneCalendarDays("2026-09-24T03:00:00Z", 30)).toBe("2026-10-24T12:59:59.999Z");
    const gates = buildComplianceTimeline({ piesaCompletedAt: "2026-09-24T03:00:00Z", piesaOutcome: "pass", now: "2026-10-01T00:00:00Z" } as never);
    expect(gates.find((g) => g.key === "install_within_piesa_window")?.dueAt).toBe("2026-10-24T12:59:59.999Z");
  });
  test("across the DST end (5 Apr 2026)", () => {
    expect(addMelbourneCalendarDays("2026-03-20T03:00:00Z", 30)).toBe("2026-04-19T13:59:59.999Z");
  });
  test("this month starts at Melbourne midnight on the 1st", () => {
    // 31 Oct 2026 14:00 UTC = 1 Nov 01:00 AEDT -> November.
    expect(melbourneMonthStart(new Date("2026-10-31T14:00:00Z"))).toBe("2026-10-31T13:00:00.000Z");
    expect(melbourneMonthStart(new Date("2026-07-15T00:00:00Z"))).toBe("2026-06-30T14:00:00.000Z");
  });
});
