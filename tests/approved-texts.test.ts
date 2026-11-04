// Decision 326: approved texts and trade messages wired through the existing guarded senders.
import { describe, expect, test } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { dirname, resolve } from "path";
import {
  APPROVED_TEXT_SMS_TYPE, approvedTextKey, installMovedFrom, installMovedText,
  quoteHeldUntil, quoteReminderDay3Text, quoteReminderDue, quoteReminderExpiryText,
  visitTomorrowDue, wholeDollars,
} from "../src/lib/approved-texts.core";
import { SMS_FRESHNESS, SMS_MESSAGE_TYPES, brandSmsBody, smsStaleReason } from "../src/lib/sms.core";
import { applicationReceivedFacts, splitDeclineReason } from "../src/lib/trade-messages.core";
import { declineReasonText } from "../src/lib/quote-decline.core";
import { sendLabel } from "../src/lib/send-failed.core";

const src = (p: string) => readFileSync(p, "utf8");
const START = "2026-10-28T00:00:00.000Z"; // Wednesday 28 October, 11am Melbourne (AEDT)

describe("wording is the decisions-log sentence, verbatim (the sender adds the brand)", () => {
  test("89 quote reminders: 3-day (B) and expiry (A)", () => {
    expect(quoteReminderDay3Text({ firstName: "Helen", rebate: 1610, link: "https://x/q" })).toBe("Hi Helen, your quote with $1,610 off is waiting: https://x/q Reply STOP to opt out.");
    expect(quoteReminderExpiryText({ firstName: "Helen", rebate: 1610, heldUntilIso: "2026-11-07T01:00:00.000Z", link: "https://x/q" }))
      .toBe("Hi Helen, your quote price is held until Saturday 7 November. Accept by then to keep your $1,610 rebate price: https://x/q Reply STOP to opt out.");
    expect(quoteReminderDay3Text({ firstName: "Helen", rebate: null, link: "https://x/q" })).toBeNull();
  });
  test("135 install moved", () => {
    expect(installMovedText({ startIso: START, link: "https://x/j" })).toBe("Your install has moved to Wednesday 28 October, 11am. Details: https://x/j");
  });
  test("the brand prefix is added once by the sender", () => {
    expect(brandSmsBody(installMovedText({ startIso: START, link: "https://x/j" }))).toStartWith("Home Insulation Victoria: Your install has moved");
  });
  test("whole dollars never invent an amount", () => {
    expect(wholeDollars(1610.4)).toBe("$1,610");
    expect(wholeDollars(0)).toBeNull();
    expect(wholeDollars(null)).toBeNull();
  });
});

describe("due rules", () => {
  test("see you tomorrow: the afternoon before (from 4pm Melbourne), never on the day or two days out", () => {
    expect(visitTomorrowDue(new Date("2026-10-27T06:00:00Z"), START)).toBe(true); // 5pm the day before
    expect(visitTomorrowDue(new Date("2026-10-27T04:00:00Z"), START)).toBe(false); // 3pm the day before
    expect(visitTomorrowDue(new Date("2026-10-26T06:00:00Z"), START)).toBe(false); // two days before
    expect(visitTomorrowDue(new Date("2026-10-27T23:00:00Z"), START)).toBe(false); // the day itself
  });
  const q = { kind: "installation", status: "issued", release_state: "released", sent_at: "2026-10-01T00:00:00.000Z" };
  test("quote reminders: day 3, then 2 days before the price expires, only while released and open (decision 88)", () => {
    expect(quoteReminderDue(q, new Date("2026-10-03T23:00:00Z"))).toBeNull();
    expect(quoteReminderDue(q, new Date("2026-10-04T01:00:00Z"))).toBe("day3");
    expect(quoteReminderDue(q, new Date("2026-10-13T12:00:00Z"))).toBe("day3");
    expect(quoteReminderDue(q, new Date("2026-10-13T14:00:00Z"))).toBe("expiry"); // expires 16 Oct 00:00 Melbourne = 15 Oct 13:00Z
    expect(quoteReminderDue(q, new Date("2026-10-15T13:00:00Z"))).toBeNull(); // expired
    for (const bad of [{ status: "accepted" }, { status: "declined" }, { release_state: "held" }, { kind: "rectification" }, { sent_at: null }])
      expect(quoteReminderDue({ ...q, ...bad }, new Date("2026-10-05T00:00:00Z"))).toBeNull();
  });
  test("held-until is the last instant of the 14th full day", () => {
    expect(quoteHeldUntil(q.sent_at)).toBe("2026-10-15T12:59:59.999Z");
  });
  test("install moved: only a confirmed booking that replaced a cancelled one at a different start", () => {
    const first = { id: "a", scheduled_start: "2026-11-01T22:00:00Z", status: "cancelled", created_at: "2026-10-20T00:00:00Z" };
    const now = { id: "b", scheduled_start: "2026-11-03T22:00:00Z", status: "confirmed", created_at: "2026-10-22T00:00:00Z" };
    expect(installMovedFrom(now, [first, now])).toBe(first.scheduled_start);
    expect(installMovedFrom(now, [now])).toBeNull(); // first booking
    expect(installMovedFrom(now, [{ ...first, scheduled_start: now.scheduled_start }, now])).toBeNull(); // same start rebooked
    expect(installMovedFrom(now, [{ ...first, status: "completed" }, now])).toBeNull();
    expect(installMovedFrom({ ...now, status: "cancelled" }, [first, now])).toBeNull();
  });
  test("one key per trigger", () => {
    expect(approvedTextKey.quoteReminder("q1", "day3")).not.toBe(approvedTextKey.quoteReminder("q1", "expiry"));
    expect(approvedTextKey.visitTomorrowOwner("assessment", "j", "b", START)).toBe("visit-tomorrow-owner:v1:assessment:j:b:2026-10-28");
  });
});

describe("SMS types: approved, own switch, freshness declared", () => {
  test("every decision-326 kind maps to an approved type with a freshness rule", () => {
    for (const type of new Set(Object.values(APPROVED_TEXT_SMS_TYPE))) {
      expect(SMS_MESSAGE_TYPES[type].wordingApproved).toBe(true);
      expect(SMS_MESSAGE_TYPES[type].quietHours).toBe(true);
      expect(SMS_FRESHNESS[type]).toBeDefined();
    }
    // Part 4 Task 14: the electrician offer text and the owner "safety check booked" text are retired (kept as history, unapproved).
    for (const t of ["piesa_offer", "safety_check_booked_owner"] as const) expect(SMS_MESSAGE_TYPES[t].wordingApproved).toBe(false);
  });
  test("one-off types never go late (24h use-by), window types are recomputed", () => {
    expect(smsStaleReason("spot_saved", { at: "2026-10-26T00:00:00Z" }, "2026-10-27T01:00:00Z")).toMatch(/Too late/);
    expect(smsStaleReason("install_moved", { at: "2026-10-27T00:00:00Z", current: false }, "2026-10-27T01:00:00Z")).toMatch(/no longer current/);
    expect(smsStaleReason("quote_reminder", null, "2026-10-27T01:00:00Z")).toBeNull();
  });
  test("failed sends get a plain Needs me label", () => {
    expect(sendLabel("quote_reminder", "sms")).toBe("Quote reminder text");
  });
});

describe("trade messages", () => {
  test("I24: the stored decline reason splits back into label + the owner's words", () => {
    expect(splitDeclineReason(declineReasonText("price", "Too dear"))).toEqual({ label: "The price", note: "Too dear" });
    expect(splitDeclineReason(declineReasonText("timing", null))).toEqual({ label: "Not the right time", note: null });
    expect(splitDeclineReason("just because")).toEqual({ label: null, note: "just because" });
    expect(splitDeclineReason(null)).toEqual({ label: null, note: null });
  });
  test("I53: recipient and names from the signed application", () => {
    expect(applicationReceivedFacts({ business_email: "jo@biz.com.au", primary_contact_name: "Jo Smith", trading_name: "Warm Co", legal_entity_name: "Warm Pty Ltd" }, null, null))
      .toEqual({ to: "jo@biz.com.au", contactName: "Jo Smith", businessName: "Warm Co" });
    expect(applicationReceivedFacts({ legal_entity_name: "Warm Pty Ltd" }, "signer@biz.com.au", "Sam")).toEqual({ to: "signer@biz.com.au", contactName: "Sam", businessName: "Warm Pty Ltd" });
    expect(applicationReceivedFacts({ business_email: "not an email" }, null, null).to).toBeNull();
  });
});

describe("source pins", () => {
  test("the 15-minute tick runs both sweeps and no longer queues visit reminders", () => {
    const tick = src("src/routes/api/public/hooks/allocation-tick.ts");
    expect(tick).toContain("sweepApprovedTexts");
    expect(tick).toContain("sweepTradeMessages");
    expect(tick).not.toContain("sweepVisitReminders");
  });
  test("messages without approved wording are no longer queued in the outbox", () => {
    expect(src("src/lib/daily-brief.server.ts")).not.toContain("enqueue_external_action");
    expect(src("src/lib/prestart.server.ts")).not.toContain("enqueue_external_action");
    const rect = src("src/lib/rectification.server.ts").split("export async function sweepRectQuotes")[1]!.split("\nexport async function")[0]!;
    expect(rect).not.toContain("enqueue_external_action");
    const noTaker = src("src/lib/allocation.server.ts").split("async function windowsNoTaker")[1]!.split("\nasync function")[0]!;
    expect(noTaker).not.toContain("enqueue_external_action");
  });
  test("each sender records its one event BEFORE sending, and TEST goes to test-send", () => {
    const s = src("src/lib/approved-texts.server.ts");
    const deliver = s.split("async function deliver")[1]!.split("\n}\n")[0]!;
    expect(deliver.indexOf("logEvent(")).toBeGreaterThanOrEqual(0);
    expect(deliver.indexOf("logEvent(")).toBeLessThan(deliver.indexOf("sendTestSms"));
    expect(deliver.indexOf("sendTestSms")).toBeLessThan(deliver.indexOf("sendRealSms"));
    const t = src("src/lib/trade-messages.server.ts");
    expect(t).not.toContain("textElectricianAboutOffer"); // retired 2 Nov 2026 (Part 4 Task 14)
    const app = t.split("export async function emailApplicationReceived")[1]!.split("\nexport async function")[0]!;
    expect(app.indexOf('from("admin_config_events").insert')).toBeLessThan(app.indexOf("sendOfficeEmail"));
  });
  test("quiet hours are checked before the event is recorded (a text due overnight goes after 7am)", () => {
    const s = src("src/lib/approved-texts.server.ts");
    for (const fn of ["textOwnerVisitTomorrow", "textOwnerQuoteReminder", "textOwnerInstallMoved"]) {
      const body = s.split(`export async function ${fn}`)[1]!.split("\nexport async function")[0]!;
      expect(body.indexOf("quietNow(")).toBeGreaterThan(0);
      expect(body.indexOf("quietNow(")).toBeLessThan(body.indexOf("deliver("));
    }
  });
  test("I24 and I53 have live triggers in the off-graph handlers", () => {
    expect(src("src/lib/portal.functions.ts")).toMatch(/"quote_declined"[\s\S]{0,400}tellInstallerOwnerDeclined/);
    expect(src("src/lib/installer-onboarding.functions.ts")).toContain("emailApplicationReceived(");
  });
  test("no sender module joins the autoAdvanceJob import graph", () => {
    const seen = new Set<string>();
    const walk = (entry: string) => {
      if (seen.has(entry)) return;
      seen.add(entry);
      const code = readFileSync(entry, "utf8").replace(/^import type [^;]+;/gm, "").replace(/import\(["'][^"']+["']\)\.[A-Z]\w*/g, "");
      for (const m of code.matchAll(/(?:from|import\()\s*["'](\.\/[^"']+|@\/lib\/[^"']+)["']/g)) {
        const spec = m[1]!.startsWith("@/") ? resolve("src", m[1]!.slice(2)) : resolve(dirname(entry), m[1]!);
        const file = [".ts", ".tsx"].map((e) => spec + e).find(existsSync);
        if (file) walk(file);
      }
    };
    walk(resolve("src/lib/autoadvance.server.ts"));
    expect([...seen].filter((f) => /approved-texts\.server|trade-messages\.server/.test(f))).toEqual([]);
  });
});
