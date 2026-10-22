// Stage 6 (Jo 22 Oct 2026): the 15-minute quote hold and the 8pm text rule. Pure module, run with `bun test`.
import { describe, expect, test } from "bun:test";
import { QUOTE_HOLD_MINUTES, melbourneHour, quoteHoldDecision, quoteHoldUntil, smsQuietReason } from "../src/lib/quote-hold.core";

describe("quoteHoldDecision", () => {
  test("the hold is 15 minutes", () => {
    expect(QUOTE_HOLD_MINUTES).toBe(15);
    expect(quoteHoldUntil("2026-10-23T01:00:00.000Z")).toBe("2026-10-23T01:15:00.000Z");
  });

  test("inside the window the quote waits; at or after the window it releases", () => {
    const arm = "2026-10-23T01:00:00.000Z";
    const until = quoteHoldUntil(arm);
    expect(quoteHoldDecision({ nowIso: "2026-10-23T01:14:59.000Z", autoSendAtIso: until, stoppedAtIso: null })).toBe("wait");
    expect(quoteHoldDecision({ nowIso: until, autoSendAtIso: until, stoppedAtIso: null })).toBe("release");
    expect(quoteHoldDecision({ nowIso: "2026-10-23T01:16:00.000Z", autoSendAtIso: until, stoppedAtIso: null })).toBe("release");
  });

  test("the office 'Stop this quote' decision outranks the clock forever", () => {
    expect(quoteHoldDecision({ nowIso: "2026-10-23T09:00:00.000Z", autoSendAtIso: "2026-10-23T01:15:00.000Z", stoppedAtIso: "2026-10-23T01:05:00.000Z" })).toBe("stopped");
  });

  test("a quote never armed is never sent", () => {
    expect(quoteHoldDecision({ nowIso: "2026-10-23T09:00:00.000Z", autoSendAtIso: null, stoppedAtIso: null })).toBe("not_armed");
  });

  test("an unreadable arm time fails closed", () => {
    expect(quoteHoldDecision({ nowIso: "2026-10-23T09:00:00.000Z", autoSendAtIso: "not-a-date", stoppedAtIso: null })).toBe("stopped");
  });
});

describe("smsQuietReason (Melbourne)", () => {
  test("2:30pm Melbourne is fine to text", () => {
    // 2:30pm AEDT = 03:30 UTC (October 2026 is daylight saving, UTC+11)
    expect(smsQuietReason("2026-10-23T03:30:00.000Z")).toBeNull();
    expect(melbourneHour("2026-10-23T03:30:00.000Z")).toBe(14);
  });

  test("8:00pm Melbourne and later is quiet", () => {
    expect(melbourneHour("2026-10-23T09:00:00.000Z")).toBe(20);
    expect(smsQuietReason("2026-10-23T09:00:00.000Z")).toBe("It's after 8pm in Melbourne — the text waits until 7am");
    expect(smsQuietReason("2026-10-23T13:00:00.000Z")).not.toBeNull(); // 12:00am
  });

  test("early morning Melbourne is quiet; 7:00am is fine", () => {
    expect(smsQuietReason("2026-10-23T19:30:00.000Z")).not.toBeNull(); // 6:30am next day
    expect(smsQuietReason("2026-10-23T20:00:00.000Z")).toBeNull(); // 7:00am
    expect(smsQuietReason("2026-10-23T20:30:00.000Z")).toBeNull(); // 7:30am
  });

  test("a bad instant fails closed as quiet", () => {
    expect(smsQuietReason("not-a-date")).not.toBeNull();
  });
});
