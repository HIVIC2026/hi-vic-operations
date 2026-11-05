// Part 5b (Jo 1–5 Nov 2026): the balance (90%) is due ON INSTALL DAY. Reminders and overdue count from install day.
// Cutover: an install booked before the rule went live keeps the old "7 days after" date — pure rule, no data fix.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BALANCE_DUE_DAYS, BALANCE_INSTALL_DAY_FROM, balanceDueAt, balanceDueDay, balanceOverdue, balanceRule } from "../src/lib/balance-q21.core";

const NEW_BOOKING = { bookedAt: "2026-11-10T01:00:00Z" }; // booked after the cutover
const OLD_BOOKING = { bookedAt: "2026-10-20T01:00:00Z" }; // booked before the cutover

describe("balance due on install day (Part 5b)", () => {
  test("rule: booked on/after the cutover = install day; booked before = legacy 7 days; no booking record follows the completion time", () => {
    expect(balanceRule(NEW_BOOKING)).toBe("install_day");
    expect(balanceRule(OLD_BOOKING)).toBe("legacy_7_days");
    expect(balanceRule({ bookedAt: BALANCE_INSTALL_DAY_FROM })).toBe("install_day");
    expect(balanceRule({ bookedAt: null, completedAt: "2026-11-12T03:00:00Z" })).toBe("install_day");
    expect(balanceRule({ bookedAt: null, completedAt: "2026-10-30T03:00:00Z" })).toBe("legacy_7_days");
    expect(balanceRule({ bookedAt: null, completedAt: null })).toBe("install_day");
    expect(balanceRule({ bookedAt: "not a date", completedAt: null })).toBe("install_day");
  });
  test("due = end of install day (Melbourne) for a new booking; legacy booking keeps +7 days", () => {
    // Completed Fri 13 Nov 2026 14:00 Melbourne (03:00Z). Melbourne is UTC+11 in November.
    expect(balanceDueAt("2026-11-13T03:00:00Z", NEW_BOOKING)).toBe("2026-11-13T12:59:59.999Z");
    expect(balanceDueAt("2026-11-13T03:00:00Z", OLD_BOOKING)).toBe("2026-11-20T12:59:59.999Z");
    expect(balanceDueAt(null, NEW_BOOKING)).toBeNull();
    expect(balanceDueAt("garbage", NEW_BOOKING)).toBeNull();
    // Default (no booking facts): the completion time decides — a completion after the cutover is due on install day.
    expect(balanceDueAt("2026-11-13T03:00:00Z")).toBe("2026-11-13T12:59:59.999Z");
    expect(balanceDueAt("2026-10-01T23:00:00Z")).toBe("2026-10-09T12:59:59.999Z");
    expect(balanceDueDay("2026-11-13T03:00:00Z")).toBe("2026-11-13");
    expect(BALANCE_DUE_DAYS).toBe(7); // the legacy clock, still used for cutover jobs and the office "overdue" row
  });
  test("overdue counts from install day for a new booking: not on the day, from the next Melbourne day; clears on payment", () => {
    expect(balanceOverdue("2026-11-13T03:00:00Z", false, new Date("2026-11-13T12:59:59.999Z"), NEW_BOOKING)).toBe(false);
    expect(balanceOverdue("2026-11-13T03:00:00Z", false, new Date("2026-11-13T13:00:00Z"), NEW_BOOKING)).toBe(true);
    expect(balanceOverdue("2026-11-13T03:00:00Z", true, new Date("2026-11-20T13:00:00Z"), NEW_BOOKING)).toBe(false);
    // Legacy booking: the old clock.
    expect(balanceOverdue("2026-11-13T03:00:00Z", false, new Date("2026-11-14T13:00:00Z"), OLD_BOOKING)).toBe(false);
    expect(balanceOverdue("2026-11-13T03:00:00Z", false, new Date("2026-11-20T13:00:00Z"), OLD_BOOKING)).toBe(true);
  });
  test("the servers pass the booking facts: payments view and the invoice due date use the one core", () => {
    const pay = readFileSync("src/lib/payments.server.ts", "utf8");
    expect(pay).toMatch(/balanceDueAt\(job\?\.installation_completed_at,\s*\{\s*bookedAt/);
    const dates = readFileSync("src/lib/invoice-dates.server.ts", "utf8");
    expect(dates).toContain("balanceDueAt(completedAt,");
    expect(dates).not.toContain("overdue after 7 days");
  });
});
