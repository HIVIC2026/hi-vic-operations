import { describe, expect, test } from "bun:test";
import { INSTALL_TIMES, allowedInstallDays, dayOfferBlockers, formatInstallDay, installDayBounds, installStartAt, installTimeLabel, installDayOutsideWindow, installDayTurn, installWindowDeadline, shouldFlagTenDaysLeft } from "../src/lib/install-days.core";
import { buildNeedsHivic } from "../src/lib/allocation.core";

const now = new Date("2026-10-05T00:00:00Z"); // Mon 5 Oct, 11am Melbourne

describe("install days", () => {
  test("30-day window from clearance; earlier stored deadline wins", () => {
    expect(installWindowDeadline("2026-10-01", null)).toBe("2026-10-31");
    expect(installWindowDeadline("2026-10-01", "2026-10-20")).toBe("2026-10-20");
    expect(installWindowDeadline(null, null)).toBeNull();
  });
  test("only business days 24h+ away, inside the window", () => {
    const d = allowedInstallDays({ now, deadline: "2026-10-16" });
    expect(d[0]).toBe("2026-10-07"); // Tue 6 Oct 8am is under 24h away
    expect(d).not.toContain("2026-10-10"); // Saturday
    expect(d.at(-1)).toBe("2026-10-16");
    expect(allowedInstallDays({ now, deadline: null })).toEqual([]);
  });
  test("no capacity check: every allowed day stays", () => {
    expect(allowedInstallDays({ now, deadline: "2026-10-09" })).toEqual(["2026-10-07", "2026-10-08", "2026-10-09"]);
  });
  test("installer offers exactly 3 days, or every day left when fewer remain", () => {
    const ok = ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12"];
    expect(dayOfferBlockers(ok.slice(0, 3), ok, "installer")).toEqual([]);
    expect(dayOfferBlockers(ok.slice(0, 2), ok, "installer")).toEqual(["Please choose 3 days."]);
    expect(dayOfferBlockers(ok, ok, "installer")).toEqual(["Please choose 3 days."]);
    expect(dayOfferBlockers(["2026-10-07"], ["2026-10-07"], "installer")).toEqual([]);
    expect(dayOfferBlockers([], [], "installer")).toEqual(["There are no days left inside the 30-day window."]);
    expect(dayOfferBlockers(["2026-10-07", "2026-10-08", "2026-12-01"], ok, "installer").length).toBeGreaterThan(0);
  });
  test("owner suggests 1–5 allowed distinct days", () => {
    const ok = ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14"];
    expect(dayOfferBlockers(["2026-10-07"], ok, "owner")).toEqual([]);
    expect(dayOfferBlockers([], ok, "owner").length).toBeGreaterThan(0);
    expect(dayOfferBlockers(ok, ok, "owner")).toEqual(["Please choose no more than 5 days."]);
    expect(dayOfferBlockers(["2026-10-07", "2026-10-07"], ok, "owner")).toEqual(["Each day can only be chosen once."]);
  });
  test("whose move: installer first, then back and forth until booked (Jo 24 Oct)", () => {
    const at = (role: string, iso: string, status = "proposed") => ({ id: `${role}${iso}`, proposer_role: role, status, starts_at: iso });
    const base = { ready: true, booked: false, expired: false, now };
    expect(installDayTurn({ ...base, rows: [] }).turn).toBe("installer_to_offer");
    expect(installDayTurn({ ...base, rows: [at("installer", "2026-10-08T21:00:00Z")] }).turn).toBe("owner_to_answer");
    expect(installDayTurn({ ...base, rows: [at("installer", "2026-10-08T21:00:00Z", "superseded"), at("owner", "2026-10-09T21:00:00Z")] }).turn).toBe("installer_to_answer");
    expect(installDayTurn({ ...base, rows: [at("owner", "2026-10-01T21:00:00Z")] }).turn).toBe("installer_to_offer"); // passed days don't count
    expect(installDayTurn({ ...base, booked: true, rows: [] }).turn).toBe("booked");
    expect(installDayTurn({ ...base, expired: true, rows: [] }).turn).toBe("expired");
    expect(installDayTurn({ ...base, ready: false, rows: [] }).turn).toBe("not_ready");
  });
  test("either side can change a booked day; installer then offers new days (Jo 24 Oct)", async () => {
    const { readFileSync } = await import("node:fs");
    const srv = readFileSync("src/lib/install-days.server.ts", "utf8");
    expect(srv).toContain('transition(jobId, "installation_scheduling"');
    expect(srv).toMatch(/update\(\{ status: "confirmed" \}\)/); // booking restored if the stage can't move back
    expect(readFileSync("src/components/portal/install-days.tsx", "utf8")).toContain("Change day");
    expect(readFileSync("src/routes/my-job.$token.tsx", "utf8")).toContain("ownerChangeInstallDayFn");
  });
  test("installer selects an exact arrival time; owner sees day and time (Jo 24 Oct)", () => {
    expect(installStartAt("2026-10-27", "07:30").toISOString()).toBe("2026-10-26T20:30:00.000Z"); // 7:30am AEDT
    expect(installDayBounds("2026-10-27", "07:30").starts_at).toBe("2026-10-26T20:30:00.000Z");
    expect(installDayBounds("2026-10-27").starts_at).toBe("2026-10-26T21:00:00.000Z"); // owner-suggested day: 8am placeholder
    expect(formatInstallDay("2026-10-26T20:30:00.000Z")).toBe("Tuesday 27 October at 7:30am");
    expect(formatInstallDay("2026-10-27T02:00:00.000Z")).toBe("Tuesday 27 October at 1pm");
    expect(formatInstallDay("2026-10-26T20:30:00.000Z", false)).toBe("Tuesday 27 October");
    expect(installTimeLabel("06:30")).toBe("6:30am");
    expect(installTimeLabel("12:00")).toBe("12pm");
    expect(INSTALL_TIMES[0]).toBe("06:30");
  });
  test("no office step: the decline/none-suit office paths are gone", async () => {
    const { readFileSync } = await import("node:fs");
    const srv = readFileSync("src/lib/install-days.server.ts", "utf8");
    const ui = readFileSync("src/components/portal/install-days.tsx", "utf8");
    expect(srv).not.toMatch(/installerDeclineDays|ownerNoInstallDays|Needs Home Insulation Victoria: installer could not/);
    expect(ui).not.toMatch(/Home Insulation Victoria has been told|Your installer will contact you/);
    expect(readFileSync("src/routes/_authenticated/field.$jobId.tsx", "utf8")).not.toContain('<BookingPanel jobId={jobId} kind="installation"');
  });
  test("hard gate: a day after the deadline can never be booked", () => {
    expect(installDayOutsideWindow("2026-10-31T23:00:00Z", "2026-10-31")).toBe(true); // 1 Nov Melbourne
    expect(installDayOutsideWindow("2026-10-30T22:00:00Z", "2026-10-31")).toBe(false);
    expect(installDayOutsideWindow("2026-10-20T00:00:00Z", null)).toBe(true);
  });
  test("10-days-left flag once, only when nothing booked and not expired", () => {
    expect(shouldFlagTenDaysLeft({ deadline: "2026-10-15", booked: false, flaggedAt: null, now })).toBe(true);
    expect(shouldFlagTenDaysLeft({ deadline: "2026-10-16", booked: false, flaggedAt: null, now })).toBe(false);
    expect(shouldFlagTenDaysLeft({ deadline: "2026-10-15", booked: true, flaggedAt: null, now })).toBe(false);
    expect(shouldFlagTenDaysLeft({ deadline: "2026-10-15", booked: false, flaggedAt: "x", now })).toBe(false);
    expect(shouldFlagTenDaysLeft({ deadline: "2026-10-01", booked: false, flaggedAt: null, now })).toBe(false);
  });
  test("needs-attention: 10 days left and installer declined, only while scheduling", () => {
    const base = { now, coverageExhausted: [], releases: [], failedComms: [], rectDeclined: [], rectPricing: [], installerUnavailable: [], piesaTiming: [], escTiming: [], evidenceRejected: [], registryQueries: [], officeOverdue: [] };
    const jobs = [{ id: "a", job_number: "A", stage: "installation_scheduling", suburb: null }, { id: "b", job_number: "B", stage: "installation_booked", suburb: null }];
    const items = buildNeedsHivic({ ...base, jobs, installFlags: [
      { job_id: "a", code: "install_ten_days_left", created_at: "x" }, { job_id: "a", code: "install_days_declined", created_at: "x" }, { job_id: "b", code: "install_days_declined", created_at: "x" },
    ] } as never);
    expect(items.map((i) => `${i.jobId}:${i.code}`).sort()).toEqual(["a:install_days_declined", "a:install_ten_days_left"]);
  });
});
