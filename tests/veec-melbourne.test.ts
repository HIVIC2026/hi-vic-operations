import { expect, test } from "bun:test";
import { melbourneToday, veecQueryOverdue } from "../src/lib/veec.core";
test("Melbourne today across UTC midnight and daylight saving", () => {
  expect(melbourneToday(new Date("2026-10-06T13:59:00Z"))).toBe("2026-10-07"); // AEDT +11
  expect(melbourneToday(new Date("2026-07-06T13:59:00Z"))).toBe("2026-07-06"); // AEST +10
  expect(melbourneToday(new Date("2026-07-06T14:00:00Z"))).toBe("2026-07-07");
});
test("VEEC query escalates after 3 Melbourne calendar days", () => {
  expect(veecQueryOverdue("2026-10-04", null, new Date("2026-10-06T12:30:00Z"))).toBe(false); // 6 Oct 23:30 Melb = 2 days
  expect(veecQueryOverdue("2026-10-04", null, new Date("2026-10-06T13:30:00Z"))).toBe(true);
  expect(veecQueryOverdue("2026-10-04", "2026-10-05", new Date("2026-10-09T00:00:00Z"))).toBe(false);
});
