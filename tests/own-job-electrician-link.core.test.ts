// Part 2 Task 3: the electrician's no-login link — pure rules (refusals, the one next step, the booking time check).
import { describe, expect, test } from "bun:test";
import {
  ELECTRICIAN_LINK_MOVED, LINK_EXPIRED, LINK_INVALID, LINK_NOT_ASSIGNED, CANT_DO_REASONS, cantDoReasonLabel,
  electricianLinkRefusal, electricianStep, piesaBookingProblem, piesaDoneAtStage, electricianLinkText, officeToBookEmail, officeCantDoEmail,
  OWN_JOB_PIESA_TO_BOOK_EMAIL_APPROVED, OWN_JOB_PIESA_CANT_DO_EMAIL_APPROVED, OWN_JOB_PIESA_NOT_BOOKED_EMAIL_APPROVED, melbourneWallToIso, melbourneWallProblem,
} from "../src/lib/own-job-electrician-link.core";
import { SMS_MESSAGE_TYPES, SMS_FRESHNESS } from "../src/lib/sms.core";

const now = new Date("2026-11-04T01:00:00Z"); // Wed 4 Nov 2026, 12pm Melbourne
const day = 86_400_000;

describe("link refusals", () => {
  const base = { found: true, revokedAt: null, expiresAt: new Date(now.getTime() + day).toISOString(), now, stillAssigned: true };
  test("an active link for the active electrician is fine", () => expect(electricianLinkRefusal(base)).toBeNull());
  test("unknown token", () => expect(electricianLinkRefusal({ ...base, found: false })).toBe(LINK_INVALID));
  test("revoked → the job moved", () => {
    expect(electricianLinkRefusal({ ...base, revokedAt: now.toISOString() })).toBe("This job has moved to another electrician");
    expect(ELECTRICIAN_LINK_MOVED).toBe("This job has moved to another electrician");
  });
  test("expired", () => expect(electricianLinkRefusal({ ...base, expiresAt: now.toISOString() })).toBe(LINK_EXPIRED));
  test("no longer the active electrician → refused (even if not revoked)", () => expect(electricianLinkRefusal({ ...base, stillAssigned: false })).toBe(LINK_NOT_ASSIGNED));
  test("revoked wins over expired", () => expect(electricianLinkRefusal({ ...base, revokedAt: now.toISOString(), expiresAt: now.toISOString() })).toBe(ELECTRICIAN_LINK_MOVED));
});

describe("electricianStep", () => {
  test.each([
    [{ booked: false, piesaDone: false }, "book_piesa"],
    [{ booked: true, piesaDone: false }, "do_piesa_in_mitti"],
    [{ booked: true, piesaDone: true }, "done"],
    [{ booked: false, piesaDone: true }, "done"],
  ] as const)("%o → %s", (f, step) => expect(electricianStep(f)).toBe(step));
  test("the safety check is done once the job is past the booked stage", () => {
    expect(piesaDoneAtStage("piesa_and_install_window_pending")).toBe(false);
    expect(piesaDoneAtStage("piesa_scheduled")).toBe(false);
    expect(piesaDoneAtStage("piesa_complete")).toBe(true);
    expect(piesaDoneAtStage("installation_scheduling")).toBe(true);
  });
});

describe("piesaBookingProblem (Review Focus 5)", () => {
  const paidAt = "2026-11-03T01:00:00Z";
  test("a past time is refused", () => expect(piesaBookingProblem(new Date(now.getTime() - 60_000).toISOString(), now, paidAt)).toBe("That time has already passed. Pick a time from now on."));
  test("paidAt + 31 days is refused, with the last day", () =>
    expect(piesaBookingProblem(new Date(Date.parse(paidAt) + 31 * day).toISOString(), now, paidAt)).toBe("That's more than 30 days after the owner paid. Pick a day on or before Thursday 3 December."));
  test("paidAt + 10 days is ok", () => expect(piesaBookingProblem(new Date(Date.parse(paidAt) + 10 * day).toISOString(), now, paidAt)).toBeNull());
  test("paidAt + 30 days (same Melbourne day) is ok", () => expect(piesaBookingProblem(new Date(Date.parse(paidAt) + 30 * day).toISOString(), now, paidAt)).toBeNull());
  test("an unreadable time is refused", () => expect(piesaBookingProblem("not a date", now, paidAt)).toBe("That date and time isn't valid."));
});

describe("can't do this one", () => {
  test("three reasons with plain labels", () => {
    expect(CANT_DO_REASONS).toEqual(["busy", "owner_not_answering", "other"]);
    expect(cantDoReasonLabel("busy")).toBe("Too busy");
    expect(cantDoReasonLabel("owner_not_answering")).toBe("Owner not answering");
    expect(cantDoReasonLabel("other", "  Van broke down ")).toBe("Van broke down");
    expect(cantDoReasonLabel("other", "")).toBe("Other");
  });
});

describe("held wording", () => {
  test("the electrician text names the address and the link", () => {
    const t = electricianLinkText({ installer: "Reinsulate", address: "1 Example St, Clayton 3168", url: "https://x/e/abc" });
    expect(t).toContain("1 Example St, Clayton 3168");
    expect(t).toContain("https://x/e/abc");
    expect(t).toContain("safety check (PIESA)");
  });
  test("office emails: subject and job page link", () => {
    const e = officeToBookEmail({ address: "1 Example St", electrician: "Sparky Co", booker: "electrician", jobUrl: "https://x/field/j" });
    expect(e.subject).toBe("Safety check to book for 1 Example St");
    expect(e.text).toContain("https://x/field/j");
    const c = officeCantDoEmail({ address: "1 Example St", electrician: "Sparky Co", reason: "Too busy", jobUrl: "https://x/field/j" });
    expect(c.subject).toBe("Sparky Co can't do the safety check for 1 Example St");
    expect(c.text).toContain("Too busy");
  });
  test("approved by Jo 3 Nov 2026 (messages 1-4)", () => {
    expect(OWN_JOB_PIESA_TO_BOOK_EMAIL_APPROVED).toBe(true);
    expect(OWN_JOB_PIESA_CANT_DO_EMAIL_APPROVED).toBe(true);
    expect(OWN_JOB_PIESA_NOT_BOOKED_EMAIL_APPROVED).toBe(true);
    expect(SMS_MESSAGE_TYPES.own_job_piesa_link).toMatchObject({ audience: "partner", wordingApproved: true, quietHours: true });
    expect(SMS_FRESHNESS.own_job_piesa_link).toBeDefined();
  });
});

describe("melbourneWallToIso", () => {
  test("summer (AEDT, +11)", () => expect(melbourneWallToIso("2026-11-10", "09:30")).toBe("2026-11-09T22:30:00.000Z"));
  test("winter (AEST, +10)", () => expect(melbourneWallToIso("2026-07-10", "09:30")).toBe("2026-07-09T23:30:00.000Z"));
  test.each([
    ["2026-04-05", "01:59"], ["2026-04-05", "03:00"], ["2026-04-05", "10:00"], ["2026-04-05", "23:30"],
    ["2026-10-04", "01:59"], ["2026-10-04", "03:00"], ["2026-10-04", "10:00"], ["2026-10-04", "23:30"],
  ])("%s %s round-trips to the same Melbourne wall time", (day, time) => {
    const iso = melbourneWallToIso(day!, time!)!;
    expect(iso).not.toBeNull();
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    expect(`${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`).toBe(`${day} ${time}`);
  });
  test("change-day offsets: 10:00 on 5 Apr is +11->+10 day (AEST, +10); 10:00 on 4 Oct is AEDT (+11)", () => {
    expect(melbourneWallToIso("2026-04-05", "10:00")).toBe("2026-04-05T00:00:00.000Z");
    expect(melbourneWallToIso("2026-10-04", "10:00")).toBe("2026-10-03T23:00:00.000Z");
  });
  test("the skipped hour (2:30am on 4 Oct) doesn't exist", () => expect(melbourneWallToIso("2026-10-04", "02:30")).toBeNull());
  test("the skipped hour says why", () => {
    expect(melbourneWallProblem("2026-10-04", "02:30")).toBe("That time doesn't exist on this day because the clocks change — pick another time.");
    expect(melbourneWallProblem("2026-10-04", "03:30")).toBeNull();
    expect(melbourneWallProblem("2026-10-04", "25:00")).toBe("That date and time isn't valid.");
  });
  test("junk is refused", () => { expect(melbourneWallToIso("nope", "09:30")).toBeNull(); expect(melbourneWallToIso("2026-11-10", "25:99")).toBeNull(); });
});
