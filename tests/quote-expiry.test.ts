import { describe, expect, test } from "bun:test";
import {
  QUOTE_30_DAY_FROM_ISO, QUOTE_EXPIRED_CANCEL_REASON, QUOTE_VALID_DAYS, isQuoteExpiredCancelReason, quoteExpiredCancelReason,
  quoteExpiresAt, quoteIsExpired, quoteTimerAction, quoteValidDaysFor, quoteValidLine,
} from "../src/lib/quote-expiry.core";
import { lastValidInstant, renderQuoteReminderEmail, type OwnerQuoteEmailInput } from "../src/lib/owner-quote-email.core";
import { quoteReminderDay3Text, quoteReminderExpiryText } from "../src/lib/approved-texts.core";

const base = { kind: "installation", status: "issued", nudge_day3_at: null, nudge_day10_at: null };
// 1 March 2026 10:00 Melbourne (AEDT, UTC+11) = 23:00 UTC 28 Feb
const sent = "2026-02-28T23:00:00Z";
const at = (iso: string) => new Date(iso);

describe("quote expiry (14 full days, Melbourne calendar)", () => {
  test("sent on the 1st expires at the end of the 15th", () => {
    // midnight 16 March Melbourne (AEDT) = 13:00 UTC 15 March
    expect(quoteExpiresAt(sent).toISOString()).toBe("2026-03-15T13:00:00.000Z");
    expect(quoteIsExpired({ kind: "installation", sent_at: sent }, at("2026-03-15T12:59:00Z"))).toBe(false);
    expect(quoteIsExpired({ kind: "installation", sent_at: sent }, at("2026-03-15T13:00:00Z"))).toBe(true);
  });
  test("rectification quotes and quotes without a sent date never expire", () => {
    expect(quoteIsExpired({ kind: "rectification", sent_at: sent }, at("2027-01-01T00:00:00Z"))).toBe(false);
    expect(quoteIsExpired({ kind: "installation", sent_at: null }, at("2027-01-01T00:00:00Z"))).toBe(false);
  });
});

describe("timer actions", () => {
  test("nothing before day 3", () => {
    expect(quoteTimerAction({ ...base, sent_at: sent }, at("2026-03-03T22:00:00Z"))).toBeNull();
  });
  test("day 3 nudge once", () => {
    expect(quoteTimerAction({ ...base, sent_at: sent }, at("2026-03-03T23:00:00Z"))).toBe("nudge_day3");
    expect(quoteTimerAction({ ...base, sent_at: sent, nudge_day3_at: "x" }, at("2026-03-05T00:00:00Z"))).toBeNull();
  });
  test("expiry reminder point once, 2 days before the quote expires (column nudge_day10_at)", () => {
    expect(quoteTimerAction({ ...base, sent_at: sent, nudge_day3_at: "x" }, at("2026-03-13T12:59:00Z"))).toBeNull();
    expect(quoteTimerAction({ ...base, sent_at: sent, nudge_day3_at: "x" }, at("2026-03-13T13:00:00Z"))).toBe("nudge_expiry");
    expect(quoteTimerAction({ ...base, sent_at: sent, nudge_day3_at: "x", nudge_day10_at: "y" }, at("2026-03-14T00:00:00Z"))).toBeNull();
  });
  test("late timer skips the stale day 3 nudge", () => {
    expect(quoteTimerAction({ ...base, sent_at: sent }, at("2026-03-14T00:00:00Z"))).toBe("nudge_expiry");
  });
  test("expires at 14 full days", () => {
    expect(quoteTimerAction({ ...base, sent_at: sent, nudge_day3_at: "x", nudge_day10_at: "y" }, at("2026-03-15T13:00:00Z"))).toBe("expire");
  });
  test("no action for accepted, declined, superseded, expired, rectification or unsent quotes", () => {
    const late = at("2026-03-20T00:00:00Z");
    for (const status of ["accepted", "declined", "superseded", "expired", "draft"]) expect(quoteTimerAction({ ...base, status, sent_at: sent }, late)).toBeNull();
    expect(quoteTimerAction({ ...base, kind: "rectification", sent_at: sent }, late)).toBeNull();
    expect(quoteTimerAction({ ...base, sent_at: null }, late)).toBeNull();
  });
});

// Part 3 Task 9 (decision #30, Jo 2 Nov 2026): quotes valid for 30 days. Review Focus 5: a quote sent before the change
// ships keeps the 14-day date it was sent with; QUOTE_30_DAY_FROM_ISO stays null until the release commit sets it.
describe("30-day quotes from the cutover", () => {
  const CUT = "2026-11-05T00:00:00Z";
  // 10 Nov 2026 10:00 Melbourne (AEDT) = 23:00 UTC 9 Nov
  const sent30 = "2026-11-09T23:00:00Z";
  // 1 Nov 2026 10:00 Melbourne, before the cutover
  const sent14 = "2026-10-31T23:00:00Z";

  test("nothing changes live until the cutover is set", () => {
    expect(QUOTE_VALID_DAYS).toBe(30);
    expect(QUOTE_30_DAY_FROM_ISO).toBeNull();
    expect(quoteValidDaysFor(sent30)).toBe(14);
    expect(quoteExpiresAt(sent30).toISOString()).toBe(quoteExpiresAt(sent30, null).toISOString());
  });
  test("sent 10 Nov after the cutover: last valid day 10 December 2026", () => {
    expect(quoteValidDaysFor(sent30, CUT)).toBe(30);
    expect(quoteValidDaysFor(CUT, CUT)).toBe(30);
    // midnight 11 Dec Melbourne (AEDT) = 13:00 UTC 10 Dec
    expect(quoteExpiresAt(sent30, CUT).toISOString()).toBe("2026-12-10T13:00:00.000Z");
    expect(quoteValidLine(lastValidInstant(quoteExpiresAt(sent30, CUT)))).toBe("Your quote is valid for 30 days, until 10 December 2026.");
    expect(quoteIsExpired({ kind: "installation", sent_at: sent30 }, at("2026-12-10T12:59:00Z"), CUT)).toBe(false);
    expect(quoteIsExpired({ kind: "installation", sent_at: sent30 }, at("2026-12-10T13:00:00Z"), CUT)).toBe(true);
  });
  test("timer: day 3, then 2 days before expiry, then expire at the end of day 30", () => {
    const q = { ...base, sent_at: sent30 };
    expect(quoteTimerAction(q, at("2026-11-12T22:59:00Z"), CUT)).toBeNull();
    expect(quoteTimerAction(q, at("2026-11-12T23:00:00Z"), CUT)).toBe("nudge_day3");
    expect(quoteTimerAction({ ...q, nudge_day3_at: "x" }, at("2026-11-20T00:00:00Z"), CUT)).toBeNull(); // old day 10: nothing now
    expect(quoteTimerAction({ ...q, nudge_day3_at: "x" }, at("2026-12-08T12:59:00Z"), CUT)).toBeNull();
    expect(quoteTimerAction({ ...q, nudge_day3_at: "x" }, at("2026-12-08T13:00:00Z"), CUT)).toBe("nudge_expiry");
    expect(quoteTimerAction({ ...q, nudge_day3_at: "x", nudge_day10_at: "y" }, at("2026-12-10T12:59:00Z"), CUT)).toBeNull();
    expect(quoteTimerAction({ ...q, nudge_day3_at: "x", nudge_day10_at: "y" }, at("2026-12-10T13:00:00Z"), CUT)).toBe("expire");
  });
  test("sent before the cutover: keeps its 14-day expiry; expiry reminder 2 days before its own expiry", () => {
    expect(quoteValidDaysFor(sent14, CUT)).toBe(14);
    expect(quoteExpiresAt(sent14, CUT).toISOString()).toBe("2026-11-15T13:00:00.000Z");
    const q = { ...base, sent_at: sent14, nudge_day3_at: "x" };
    expect(quoteTimerAction(q, at("2026-11-13T12:59:00Z"), CUT)).toBeNull();
    expect(quoteTimerAction(q, at("2026-11-13T13:00:00Z"), CUT)).toBe("nudge_expiry");
    expect(quoteTimerAction({ ...q, nudge_day10_at: "y" }, at("2026-11-15T13:00:00Z"), CUT)).toBe("expire");
  });
  test("close reason: 30-day quotes say 30 days; the old 14-day reason is still recognised", () => {
    expect(QUOTE_EXPIRED_CANCEL_REASON).toBe("Quote expired (30 days)");
    expect(quoteExpiredCancelReason(30)).toBe("Quote expired (30 days)");
    expect(quoteExpiredCancelReason(14)).toBe("Quote expired (14 days)");
    expect(isQuoteExpiredCancelReason("Quote expired (30 days)")).toBe(true);
    expect(isQuoteExpiredCancelReason("Quote expired (14 days)")).toBe(true);
    expect(isQuoteExpiredCancelReason("Owner declined")).toBe(false);
    expect(isQuoteExpiredCancelReason(null)).toBe(false);
  });
});

describe("quote reminder emails (decision #30) and texts (decision #32, approved as is)", () => {
  const sample: OwnerQuoteEmailInput = {
    firstName: "Courtney", address: "2A Chatfield Street, Kingsville VIC 3012", totalIncGst: 2347, rebateIncGst: 1850, subtotalIncGst: 4197,
    lines: [{ description: "R5.0 ceiling insulation, supplied and installed", lineTotalIncGst: 3000 }],
    quoteUrl: "https://estimate.homeinsulationvictoria.com.au/my-job/tok?screen=quote", validUntil: new Date("2026-12-10T12:59:59.999Z"),
    officePhone: null, unsubscribeUrl: "https://estimate.homeinsulationvictoria.com.au/unsubscribe/abc",
  };
  const valid = "Your quote is valid for 30 days, until 10 December 2026.";
  test("\"Your VEU rebate\" never appears; \"Your rebate\" does (every kind, 14- or 30-day)", () => {
    for (const kind of ["day3", "expiry"] as const) for (const validDays of [14, 30] as const) {
      const m = renderQuoteReminderEmail({ ...sample, kind, validDays });
      for (const body of [m.html, m.text, m.subject]) expect(body).not.toContain("VEU rebate");
      expect(m.text).toContain("Your rebate");
    }
  });
  test("30-day quotes: both reminders carry the valid line", () => {
    const expiry = renderQuoteReminderEmail({ ...sample, kind: "expiry", validDays: 30 });
    expect(expiry.text).toContain(valid);
    expect(expiry.html).toContain("Your quote is valid for 30 days, until <strong>10 December 2026</strong>.");
    expect(expiry.text).toContain("Accept by then to keep your price with $1,850 off.");
    expect(expiry.text).not.toContain("held until");
    const day3 = renderQuoteReminderEmail({ ...sample, kind: "day3", validDays: 30 });
    expect(day3.text).toContain(`Just checking you saw it. Your $1,850 rebate is ready to go. ${valid}`);
    expect(day3.text).not.toContain("held until");
  });
  test("quotes sent before the change (14 days) keep the held-until wording they were sent with", () => {
    const old = { ...sample, validUntil: new Date("2026-11-15T12:59:59.999Z") };
    const expiry = renderQuoteReminderEmail({ ...old, kind: "expiry" });
    expect(expiry.text).toContain("Your price is held until 15 November. Accept by then to keep your price with $1,850 off.");
    expect(expiry.text).not.toContain("30 days");
    expect(renderQuoteReminderEmail({ ...old, kind: "day3", validDays: 14 }).text).toContain("Your $1,850 rebate is ready to go, and your price is held until 15 November.");
  });
  test("reminder texts unchanged", () => {
    expect(quoteReminderDay3Text({ firstName: "Courtney", rebate: 1850, link: "L" })).toBe("Hi Courtney, your quote with $1,850 off is waiting: L Reply STOP to opt out.");
    expect(quoteReminderExpiryText({ firstName: "Courtney", rebate: 1850, heldUntilIso: "2026-12-10T12:59:59.999Z", link: "L" })).toBe("Hi Courtney, your quote price is held until Thursday 10 December. Accept by then to keep your $1,850 rebate price: L Reply STOP to opt out.");
  });
});
