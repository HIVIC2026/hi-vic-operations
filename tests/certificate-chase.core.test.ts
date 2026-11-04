// Part 3 Task 5 (Jo 3 Nov 2026): chasing the upgrades day and the certificate — the pure action tables (Victorian business
// days: a weekend and Melbourne Cup day, Tue 3 Nov 2026), the held wording, the office flags and the Needs rows.
import { describe, expect, test } from "bun:test";
import {
  CERTIFICATE_CHASE_TEXT_APPROVED, UPGRADES_DAY_LINK_TEXT_APPROVED, UPGRADES_DAY_OFFICE_EMAIL_APPROVED,
  certificateChaseAction, certificateChaseText, certificateNotInLine, chaseOfficeFlags, upgradesDayChaseAction, upgradesDayLinkText,
  upgradesDayNotSetLine, upgradesDayOfficeEmail, UPGRADES_DAY_RED_LINE, CHASE_ROUND,
} from "../src/lib/certificate-chase.core";
import { SMS_FRESHNESS, SMS_MESSAGE_TYPES } from "../src/lib/sms.core";
import { buildNeedsRows, needsCandidates, type NeedsFacts } from "../src/lib/office-needs.core";
import { cardOf } from "../src/lib/needs-cards.core";

const none = { text1: false, email2: false, flag7: false };
// Fri 30 Oct 2026, 2pm Melbourne (AEDT). 1 business day = end of Mon 2 Nov; 2 business days = end of Wed 4 Nov (Tue 3 Nov is Cup day).
const FRI = "2026-10-30T03:00:00.000Z";
const up = (now: string, o: Partial<{ dayEntered: boolean; sent: typeof none; piesaAt: string; upgradesNeededAt: string }> = {}) =>
  upgradesDayChaseAction({ upgradesNeededAt: o.upgradesNeededAt ?? FRI, dayEntered: o.dayEntered ?? false, piesaAt: o.piesaAt ?? "2026-10-30", now: new Date(now), sent: o.sent ?? none });

describe("upgradesDayChaseAction — business days across a weekend and Melbourne Cup day", () => {
  test.each([
    ["Mon 2 Nov 11pm (still day 1)", "2026-11-02T12:00:00.000Z", []],
    ["Tue 3 Nov 10am (Cup day; day 1 is over)", "2026-11-02T23:00:00.000Z", ["text_electrician"]],
    ["Wed 4 Nov 3pm (day 2 not over)", "2026-11-04T04:00:00.000Z", ["text_electrician"]],
    ["Thu 5 Nov 9am (day 2 over)", "2026-11-04T22:00:00.000Z", ["text_electrician", "email_office"]],
  ] as const)("%s", (_n, now, want) => expect(up(now)).toEqual([...want]));
  test("what was already sent is never asked for again", () => {
    expect(up("2026-11-04T22:00:00.000Z", { sent: { ...none, text1: true } })).toEqual(["email_office"]);
    expect(up("2026-11-04T22:00:00.000Z", { sent: { ...none, text1: true, email2: true } })).toEqual([]);
  });
  test("a day entered stops all three", () => {
    expect(up("2026-11-04T22:00:00.000Z", { dayEntered: true })).toEqual([]);
    expect(up("2026-11-28T00:00:00.000Z", { dayEntered: true })).toEqual([]);
  });
  test("red flag when 7 days or fewer are left on the 30-day clock (30 days from the official PIESA date)", () => {
    // PIESA 30 Oct → the last day is Sun 29 Nov (ends 2026-11-29T12:59:59.999Z). 7 days left from 2026-11-22T12:59:59.999Z.
    const sent = { text1: true, email2: true, flag7: false };
    expect(up("2026-11-22T12:00:00.000Z", { sent })).toEqual([]);
    expect(up("2026-11-22T14:00:00.000Z", { sent })).toEqual(["red_flag"]);
    expect(up("2026-11-22T14:00:00.000Z", { sent: { ...sent, flag7: true } })).toEqual([]);
    // A job first seen late: all three at once.
    expect(up("2026-11-22T14:00:00.000Z")).toEqual(["text_electrician", "email_office", "red_flag"]);
  });
  test("fails closed on a bad date", () => {
    expect(up("2026-11-22T14:00:00.000Z", { upgradesNeededAt: "nope", piesaAt: "nope" })).toEqual([]);
  });
});

const nc = { text2: false, flag4: false };
// Part C recorded Mon 2 Nov. 2 business days = end of Thu 5 Nov (Cup day skipped); 4 business days = end of Mon 9 Nov (weekend skipped).
const cert = (now: string, o: Partial<{ fileAt: string | null; sent: typeof nc }> = {}) =>
  certificateChaseAction({ upgradesDoneAt: "2026-11-02", fileAt: o.fileAt ?? null, now: new Date(now), sent: o.sent ?? nc });

describe("certificateChaseAction", () => {
  test.each([
    ["Thu 5 Nov 8pm", "2026-11-05T09:00:00.000Z", []],
    ["Fri 6 Nov 8am", "2026-11-05T21:00:00.000Z", ["text_electrician"]],
    ["Mon 9 Nov 5pm", "2026-11-09T06:00:00.000Z", ["text_electrician"]],
    ["Tue 10 Nov 8am", "2026-11-09T21:00:00.000Z", ["text_electrician", "office_flag"]],
  ] as const)("%s", (_n, now, want) => expect(cert(now)).toEqual([...want]));
  test("nothing twice; a file stops it", () => {
    expect(cert("2026-11-09T21:00:00.000Z", { sent: { text2: true, flag4: false } })).toEqual(["office_flag"]);
    expect(cert("2026-11-09T21:00:00.000Z", { sent: { text2: true, flag4: true } })).toEqual([]);
    expect(cert("2026-11-09T21:00:00.000Z", { fileAt: "2026-11-06T00:00:00.000Z" })).toEqual([]);
  });
});

describe("held wording", () => {
  test("all three new messages are held until Jo approves them", () => {
    expect(UPGRADES_DAY_LINK_TEXT_APPROVED).toBe(false);
    expect(CERTIFICATE_CHASE_TEXT_APPROVED).toBe(false);
    expect(UPGRADES_DAY_OFFICE_EMAIL_APPROVED).toBe(false);
    expect(SMS_MESSAGE_TYPES.electrician_upgrades_day_link).toMatchObject({ audience: "partner", wordingApproved: false, quietHours: true });
    expect(SMS_FRESHNESS.electrician_upgrades_day_link).toEqual({ kind: "window" });
    expect(SMS_MESSAGE_TYPES.electrician_certificate_link.wordingApproved).toBe(false);
  });
  test("texts are short and plain", () => {
    expect(upgradesDayLinkText({ first: "Sam", address: "1 Example St, Clayton", url: "https://x/e/t" })).toBe("Hi Sam, the upgrades day for 1 Example St, Clayton isn't booked yet. Add it here: https://x/e/t");
    expect(certificateChaseText({ first: null, address: "1 Example St, Clayton", url: "https://x/e/t" })).toBe("Hi there, we still need the Certificate of Electrical Safety for 1 Example St, Clayton. Add it here: https://x/e/t");
    for (const t of [upgradesDayLinkText({ first: "Sam", address: "a", url: "u" }), certificateChaseText({ first: "Sam", address: "a", url: "u" })]) expect(t).not.toMatch(/fixes|repair/i);
  });
  test("office email", () => {
    const m = upgradesDayOfficeEmail({ address: "1 Example St, Clayton", electrician: "Sparky Co", jobUrl: "https://x/field/j" });
    expect(m.subject).toBe("Upgrades day not set — 1 Example St, Clayton");
    expect(m.text).toContain("Sparky Co");
    expect(m.text).toContain("https://x/field/j");
    expect(m.text.split("\n").filter(Boolean).length).toBeLessThanOrEqual(3);
    expect(m.text).not.toMatch(/fixes|repair/i);
  });
});

describe("office flags (Needs me)", () => {
  const ev = (round: string, at: string, details: Record<string, unknown> = {}) => ({ created_at: at, details: { round, anchor: "a1", ...details } });
  const pending = { state: "upgrades_pending" as const, upgradesDaySet: false, upgradesToday: false, upgradesDoneAt: null, upgradesAnchor: "a1" };
  test("upgrades day: the email round → week row; the 7-days-left round → red row; a day entered clears both", () => {
    const events = [ev(CHASE_ROUND.upgradesText, "2026-11-03T00:00:00Z"), ev(CHASE_ROUND.upgradesEmail, "2026-11-05T00:00:00Z", { electrician: "Sparky Co", address: "1 Example St" })];
    expect(chaseOfficeFlags(events, pending)).toEqual({ upgradesDayNotSet: { at: "2026-11-05T00:00:00Z", electrician: "Sparky Co", address: "1 Example St" } });
    const red = [...events, ev(CHASE_ROUND.upgradesRed, "2026-11-23T00:00:00Z")];
    expect(chaseOfficeFlags(red, pending)).toMatchObject({ upgradesDayRed: { at: "2026-11-23T00:00:00Z" } });
    expect(chaseOfficeFlags(red, { ...pending, upgradesDaySet: true })).toEqual({});
    expect(chaseOfficeFlags(red, { ...pending, state: "waiting_for_certificate" })).toEqual({});
  });
  test("fix 1 minor 2: upgrades rows count only for the current PIESA record — a reassessment clears the old rows", () => {
    const red = [ev(CHASE_ROUND.upgradesEmail, "2026-11-05T00:00:00Z", { electrician: "Sparky Co", address: "1 Example St" }), ev(CHASE_ROUND.upgradesRed, "2026-11-23T00:00:00Z")];
    expect(chaseOfficeFlags(red, { ...pending, upgradesAnchor: "a2" })).toEqual({});
    expect(chaseOfficeFlags(red, { ...pending, upgradesAnchor: null })).toEqual({});
  });
  test("certificate: the 4-business-day round → row with the phone; a file (state moved on) clears it; another Part C date doesn't count", () => {
    const events = [ev(CHASE_ROUND.certificateFlag, "2026-11-10T00:00:00Z", { anchor: "2026-11-02", electrician: "Sparky Sam", phone: "0411111111" })];
    const waiting = { state: "waiting_for_certificate" as const, upgradesDaySet: true, upgradesToday: false, upgradesDoneAt: "2026-11-02", upgradesAnchor: null };
    expect(chaseOfficeFlags(events, waiting)).toEqual({ certificateNotIn: { at: "2026-11-10T00:00:00Z", electrician: "Sparky Sam", phone: "0411111111" } });
    expect(chaseOfficeFlags(events, { ...waiting, state: "certificate_in" })).toEqual({});
    expect(chaseOfficeFlags(events, { ...waiting, upgradesDoneAt: "2026-11-20" })).toEqual({});
  });
  test("lines", () => {
    expect(upgradesDayNotSetLine("Sparky Co", "1 Example St")).toBe("Upgrades day not set — Sparky Co on 1 Example St");
    expect(upgradesDayNotSetLine(null, "1 Example St")).toBe("Upgrades day not set — the electrician on 1 Example St");
    expect(UPGRADES_DAY_RED_LINE).toBe("Upgrades day not set — 7 days left on the 30-day clock");
    expect(certificateNotInLine("Sparky Sam", "0411111111")).toBe("Certificate not in — call Sparky Sam (0411111111)");
    expect(certificateNotInLine(null, null)).toBe("Certificate not in — call the electrician");
  });
  const job: NeedsFacts = { jobId: "j1", jobNumber: "HV-1", surname: "Owner", suburb: "Clayton" };
  test("Needs rows: week row, red today row, certificate row today; red wins over the week row", () => {
    const now = Date.parse("2026-11-23T00:00:00Z");
    const week = buildNeedsRows({ now, jobs: [{ ...job, upgradesDayNotSet: { at: "2026-11-05T00:00:00Z", electrician: "Sparky Co", address: "1 Example St" } }] });
    expect(week.week.map((r) => [r.kind, r.line])).toEqual([["upgrades_day_not_set", "Upgrades day not set — Sparky Co on 1 Example St"]]);
    const red = buildNeedsRows({ now, jobs: [{ ...job, upgradesDayNotSet: { at: "2026-11-05T00:00:00Z", electrician: "Sparky Co", address: "1 Example St" }, upgradesDayRed: { at: "2026-11-23T00:00:00Z" } }] });
    expect(red.today.map((r) => [r.kind, r.line])).toEqual([["upgrades_day_red", UPGRADES_DAY_RED_LINE]]);
    expect(red.week).toEqual([]);
    const c = needsCandidates({ ...job, certificateNotIn: { at: "2026-11-10T00:00:00Z", electrician: "Sparky Sam", phone: "0411111111" } }, now);
    expect(c[0]).toMatchObject({ kind: "certificate_not_in", group: "today", line: "Certificate not in — call Sparky Sam (0411111111)", button: { to: "job", section: "piesa" } });
    expect(cardOf("upgrades_day_not_set")).toBe("electrician");
    expect(cardOf("upgrades_day_red")).toBe("clock");
    expect(cardOf("certificate_not_in")).toBe("electrician");
  });
});
