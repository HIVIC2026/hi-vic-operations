import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BOOK_BY_BUSINESS_DAYS, bookBy, installCountdown, overdue } from "../src/lib/next-step-dates.core";

describe("book-by dates", () => {
  test("business days per step", () => {
    expect(BOOK_BY_BUSINESS_DAYS).toEqual({ ready_check: 5, price: 1, piesa: 2, install: 1 });
  });
  test("piesa skips the weekend and Cup Day", () => {
    expect(bookBy("piesa", "2026-10-30T06:00:00Z")).toBe("2026-11-04");
  });
  test("ready check, price, install", () => {
    expect(bookBy("ready_check", "2026-10-26T01:00:00Z")).toBe("2026-11-02");
    expect(bookBy("price", "2026-11-04T03:00:00Z")).toBe("2026-11-05");
    expect(bookBy("install", "2026-11-05T00:00:00Z")).toBe("2026-11-06");
  });
});

describe("overdue", () => {
  test("uses the Melbourne day", () => {
    expect(overdue("2026-11-01", new Date("2026-11-01T12:00:00Z"))).toBe(false);
    expect(overdue("2026-11-01", new Date("2026-11-01T13:30:00Z"))).toBe(true);
  });
});

describe("installCountdown", () => {
  const now = new Date("2026-11-12T01:00:00Z");
  test("plural line", () => {
    expect(installCountdown("2026-12-06", now)).toEqual({
      daysLeft: 24,
      line: "⏱ 24 days left to install · must be done by Sun 6 Dec (30 days from the PIESA)",
    });
  });
  test("singular", () => {
    expect(installCountdown("2026-11-13", now)?.line).toBe("⏱ 1 day left to install · must be done by Fri 13 Nov (30 days from the PIESA)");
  });
  test("no deadline", () => {
    expect(installCountdown(null, now)).toBeNull();
  });
  test("a deadline already passed never prints negative days (fix wave minor 10)", () => {
    expect(installCountdown("2026-11-10", now)).toEqual({ daysLeft: -2, line: "Install deadline passed Tue 10 Nov" });
    expect(installCountdown("2026-11-12", now)?.line).toBe("⏱ 0 days left to install · must be done by Thu 12 Nov (30 days from the PIESA)");
  });
});

test("defines no lock function; the lock lives in prestart.core.ts", () => {
  expect(readFileSync("src/lib/next-step-dates.core.ts", "utf8")).not.toMatch(/leadInstallerLock|leadLocked/);
});
