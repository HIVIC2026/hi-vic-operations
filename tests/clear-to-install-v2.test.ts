// Part 5b (Jo 1–5 Nov 2026): one "You're clear to install" email, one page, three steps, one reminder series. OFF until approved.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CLEAR_TO_INSTALL_OFFICE_FLAG_DAY, CLEAR_TO_INSTALL_REMINDER_DAYS, CLEAR_TO_INSTALL_V2_APPROVED, allClearStepsDone, clearToInstallReminderDue, clearToInstallSteps,
  renderClearToInstallReminderV2, renderClearToInstallV2,
} from "../src/lib/clear-to-install-v2.core";
import { depositReminderDue } from "../src/lib/deposit-request.core";
import { PIESA_CONFIRM_SCHEDULE } from "../src/lib/piesa-owner-confirm.core";

const F = { firstName: "Helen", address: "12 Sample St, Glen Waverley", installer: "Rapid Insulation", amountCents: 18390, link: "https://example.invalid/my-job/t?screen=clear" };
const state = (o: { confirmed?: boolean; signed?: boolean; paid?: boolean } = {}) => ({
  piesa: { checkedOn: "2026-11-05", electrician: "Spark", result: "Safe to insulate" as const, done: o.confirmed === true },
  consent: { name: "Helen Yang", address: F.address, phone: "", email: "", done: o.signed === true, signedOn: null },
  deposit: { amountCents: 18390, paid: o.paid === true },
});

describe("You're clear to install (v2)", () => {
  test("OFF by default: a template row that sends nothing until Jo approves", () => {
    expect(CLEAR_TO_INSTALL_V2_APPROVED).toBe(false);
  });
  test("Jo's wording, verbatim", () => {
    const m = renderClearToInstallV2(F);
    expect(m.subject).toBe("You're clear to install – 12 Sample St, Glen Waverley");
    expect(m.text).toBe([
      "Hi Helen, the electrical safety check is done and your ceiling is clear for insulation. Three quick things on one page, then Rapid Insulation will call you to book the install day:",
      "1. Confirm the safety check happened.",
      "2. Sign the rebate consent.",
      "3. Pay your 10% deposit ($183.90).",
      F.link,
      "Jo",
      "Home Insulation Victoria",
    ].join("\n\n"));
    expect(m.html).toContain(F.link);
    expect(m.html).toContain("Home Insulation Victoria");
    for (const b of [m.text, m.html]) expect(b).not.toMatch(/HIV\b|fixes|You pay about|7 days/);
    expect(renderClearToInstallV2({ ...F, firstName: " " }).text).toContain("Hi there,");
    expect(renderClearToInstallV2({ ...F, address: "" }).subject).toBe("You're clear to install – your home");
  });
  test("page step states: each step marks done on its own record", () => {
    expect(clearToInstallSteps(state()).map((s) => [s.n, s.done])).toEqual([[1, false], [2, false], [3, false]]);
    expect(clearToInstallSteps(state({ confirmed: true })).map((s) => s.done)).toEqual([true, false, false]);
    expect(clearToInstallSteps(state({ signed: true })).map((s) => s.done)).toEqual([false, true, false]);
    expect(clearToInstallSteps(state({ paid: true })).map((s) => s.done)).toEqual([false, false, true]);
    expect(clearToInstallSteps(state()).map((s) => s.label)).toEqual(["Confirm the safety check happened", "Sign the rebate consent", "Pay your 10% deposit"]);
    expect(allClearStepsDone(state({ confirmed: true, signed: true, paid: true }))).toBe(true);
    expect(allClearStepsDone(state({ confirmed: true, signed: true }))).toBe(false);
  });
  test("one reminder series: days 1, 3, 7 after the request; office flag day 5 unchanged", () => {
    expect([...CLEAR_TO_INSTALL_REMINDER_DAYS]).toEqual([1, 3, 7]);
    expect(CLEAR_TO_INSTALL_OFFICE_FLAG_DAY).toBe(5);
    expect(PIESA_CONFIRM_SCHEDULE.find((s) => s.step === "office_alert_5")?.afterDays).toBe(5);
    const req = "2026-11-05T00:00:00Z";
    const at = (d: number) => new Date(Date.parse(req) + d * 86_400_000);
    const open = state();
    expect(clearToInstallReminderDue({ requestedAt: req, steps: open, sent: [], now: at(0.9) })).toBeNull();
    expect(clearToInstallReminderDue({ requestedAt: req, steps: open, sent: [], now: at(1) })).toBe(1);
    expect(clearToInstallReminderDue({ requestedAt: req, steps: open, sent: [1], now: at(2.5) })).toBeNull();
    expect(clearToInstallReminderDue({ requestedAt: req, steps: open, sent: [1], now: at(3) })).toBe(3);
    expect(clearToInstallReminderDue({ requestedAt: req, steps: open, sent: [], now: at(4) })).toBe(3); // a missed day 1 is skipped, never sent late
    expect(clearToInstallReminderDue({ requestedAt: req, steps: open, sent: [1, 3], now: at(7) })).toBe(7);
    expect(clearToInstallReminderDue({ requestedAt: req, steps: open, sent: [1, 3, 7], now: at(9) })).toBeNull();
    expect(clearToInstallReminderDue({ requestedAt: req, steps: state({ confirmed: true, signed: true, paid: true }), sent: [], now: at(3) })).toBeNull();
    expect(clearToInstallReminderDue({ requestedAt: req, steps: state({ paid: true }), sent: [], now: at(3) })).toBe(3); // paid but unsigned still reminded
    expect(clearToInstallReminderDue({ requestedAt: null, steps: open, sent: [], now: at(3) })).toBeNull();
  });
  test("the deposit sweep's reminder clock takes the same offsets (1, 3, 7) when the new series is on; 3 and 7 otherwise", () => {
    const req = "2026-11-05T00:00:00Z";
    const at = (d: number) => new Date(Date.parse(req) + d * 86_400_000);
    expect(depositReminderDue({ requestedAt: req, paid: false, now: at(1), days: CLEAR_TO_INSTALL_REMINDER_DAYS })).toBe("day1");
    expect(depositReminderDue({ requestedAt: req, paid: false, now: at(3), days: CLEAR_TO_INSTALL_REMINDER_DAYS })).toBe("day3");
    expect(depositReminderDue({ requestedAt: req, paid: false, now: at(7), days: CLEAR_TO_INSTALL_REMINDER_DAYS })).toBe("day7");
    expect(depositReminderDue({ requestedAt: req, paid: false, now: at(1) })).toBeNull();
    expect(depositReminderDue({ requestedAt: req, paid: false, now: at(3) })).toBe("day3");
    expect(depositReminderDue({ requestedAt: req, paid: true, now: at(3), days: CLEAR_TO_INSTALL_REMINDER_DAYS })).toBeNull();
  });
  test("reminder names only what is left, in order", () => {
    const m = renderClearToInstallReminderV2({ ...F, day: 3, steps: state({ confirmed: true }) });
    expect(m.subject).toBe("Reminder: you're clear to install – 12 Sample St, Glen Waverley");
    expect(m.text).toContain("Hi Helen, 2 quick things on one page, then Rapid Insulation will call you to book the install day:");
    expect(m.text).toContain("1. Sign the rebate consent.");
    expect(m.text).toContain("2. Pay your 10% deposit ($183.90).");
    expect(m.text).not.toContain("Confirm the safety check");
    const one = renderClearToInstallReminderV2({ ...F, day: 7, steps: state({ confirmed: true, signed: true }) });
    expect(one.text).toContain("one quick thing on one page");
    expect(one.text).toContain("1. Pay your 10% deposit ($183.90).");
    expect(() => renderClearToInstallReminderV2({ ...F, day: 1, steps: state({ confirmed: true, signed: true, paid: true }) })).toThrow();
  });
  test("the core never imports I/O; the sender reads the flag through its deps and the hub lists the row OFF", () => {
    const core = readFileSync("src/lib/clear-to-install-v2.core.ts", "utf8");
    expect(core).not.toMatch(/supabase|\.server|fetch\(/);
    const srv = readFileSync("src/lib/deposit-request.server.ts", "utf8");
    expect(srv).toContain("CLEAR_TO_INSTALL_V2_APPROVED");
    expect(srv).toContain("renderClearToInstallV2(");
    expect(srv).toContain("renderClearToInstallReminderV2(");
    const hub = readFileSync("src/lib/template-hub.core.ts", "utf8");
    expect(hub).toMatch(/flag: ?['"]CLEAR_TO_INSTALL_V2_APPROVED['"]/);
    // The confirm reminders fold into this series: no second owner copy send on days 1/3 while the series is on.
    const confirm = readFileSync("src/lib/piesa-owner-confirm-send.server.ts", "utf8");
    expect(confirm).toContain("CLEAR_TO_INSTALL_V2_APPROVED");
  });
});
