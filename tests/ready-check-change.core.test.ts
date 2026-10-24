// Jo 24 Oct 2026 (decision 80): a booked our-lead Ready Check can be changed by either side, like install days.
// Pure rules + the held "You're booked" email.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { installerRebookBlockers, readyCheckChangeBlockers, readyCheckStartAt } from "../src/lib/ready-check-times.core";
import { READY_CHECK_BOOKED_EMAIL_APPROVED, READY_CHECK_BOOKED_TEXT_APPROVED, renderReadyCheckBookedEmail } from "../src/lib/ready-check-booked-email.core";

const NOW = new Date("2026-10-26T00:00:00Z"); // Mon 26 Oct, 11am Melbourne
const booked = readyCheckStartAt("2026-10-29", "09:00").toISOString();
const ok = { channel: "hivic_sourced", stage: "ready_check_scheduled", deleted: false, bookedAt: booked };

describe("who can change a booked Ready Check", () => {
  test("our lead, booked, not started = can change", () => expect(readyCheckChangeBlockers(ok, NOW)).toEqual([]));
  test("installer's own customers: never (no portal booking)", () => expect(readyCheckChangeBlockers({ ...ok, channel: "installer_sourced" }, NOW).join(" ")).toMatch(/directly with their own customers/));
  test("nothing booked / wrong stage", () => {
    expect(readyCheckChangeBlockers({ ...ok, bookedAt: null }, NOW).join(" ")).toMatch(/no booked Ready Check/);
    expect(readyCheckChangeBlockers({ ...ok, stage: "ready_check_complete" }, NOW).join(" ")).toMatch(/no booked Ready Check/);
    expect(readyCheckChangeBlockers({ ...ok, stage: "ready_check_ready_to_schedule" }, NOW).join(" ")).toMatch(/no booked Ready Check/);
  });
  test("already started", () => expect(readyCheckChangeBlockers(ok, new Date(Date.parse(booked) + 60_000)).join(" ")).toMatch(/already started/));
  test("deleted job", () => expect(readyCheckChangeBlockers({ ...ok, deleted: true }, NOW).join(" ")).toMatch(/no longer available/));
});

describe("installer's new day + time (same rules as offers)", () => {
  test("allowed day + time, 24h+ away = fine", () => expect(installerRebookBlockers({ day: "2026-10-30", time: "07:30" }, booked, NOW)).toEqual([]));
  test("odd or missing time", () => {
    expect(installerRebookBlockers({ day: "2026-10-30", time: "07:15" }, booked, NOW)).toEqual(["Please choose a time."]);
    expect(installerRebookBlockers({ day: "2026-10-30", time: "18:00" }, booked, NOW)).toEqual(["Please choose a time."]);
  });
  test("weekend or past 21 days", () => {
    expect(installerRebookBlockers({ day: "2026-10-31", time: "09:00" }, booked, NOW).join(" ")).toMatch(/not available/);
    expect(installerRebookBlockers({ day: "2026-12-30", time: "09:00" }, booked, NOW).join(" ")).toMatch(/not available/);
  });
  test("under 24 hours away", () => expect(installerRebookBlockers({ day: "2026-10-27", time: "08:00" }, booked, NOW)).toEqual(["The time must be at least 24 hours away."]));
  test("the same time as booked", () => expect(installerRebookBlockers({ day: "2026-10-29", time: "09:00" }, booked, NOW)).toEqual(["That is already the booked time."]));
});

describe("You're booked email (our leads)", () => {
  const base = { firstName: "Helen", when: "Thursday 29 October at 9:00am", installerName: "Reinsulate", changed: false, myJobUrl: "https://example.test/my-job/t" };
  test("first booking", () => {
    const m = renderReadyCheckBookedEmail(base);
    expect(m.subject).toBe("You're booked: free Ready Check – Thursday 29 October at 9:00am");
    expect(m.text).toContain("When: Thursday 29 October at 9:00am");
    expect(m.text).toContain("Installer: Reinsulate");
    expect(m.text).toContain("Change time on your job page");
    expect(m.text).toContain("Open my job: https://example.test/my-job/t");
  });
  test("after a change", () => {
    const m = renderReadyCheckBookedEmail({ ...base, changed: true });
    expect(m.subject).toBe("Your Ready Check time has changed – Thursday 29 October at 9:00am");
    expect(m.text).toContain("has a new time");
  });
  test("held until Jo approves; real jobs only log not-sent; TEST via test-send; no new sender", () => {
    expect(READY_CHECK_BOOKED_EMAIL_APPROVED).toBe(false);
    expect(READY_CHECK_BOOKED_TEXT_APPROVED).toBe(false);
    const srv = readFileSync("src/lib/ready-check-booked-email.server.ts", "utf8");
    expect(srv).toContain("ready_check_booked_email_not_sent");
    expect(srv).toContain("sendTestEmail");
    expect(srv).toContain("assertCustomerDeliveryAllowed");
    expect(srv).toContain('channel !== "hivic_sourced"');
    expect(srv).not.toMatch(/sendRealSms|sendTestSms|resend|fetch\(/i);
    expect(srv).toContain("ready-check-booked:v1:${jobId}:${startIso}");
  });
});
