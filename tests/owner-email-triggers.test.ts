// Decision 325 (25 Oct 2026): the approved owner emails get workflow triggers. Pure due rules (O19 quote reminders,
// O51 review request, O42 install day moved, O22 paid date) and source pins that every trigger calls its sender exactly
// once with its key, through the guarded owner path. Run: bun test tests/owner-email-triggers.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  OWNER_EMAIL_TRIGGER_EVENT, OWNER_REVIEW_SCREEN_READY, QUOTE_OPEN_STAGES, dayMonthLabel, directMoveFrom, installDayMove, ownerEmailKey, quoteReminderDue,
  reviewRequestBlocker, reviewRequestDue, safetyCheckPaidAt, weekdayDayMonthLabel, youreInDue, type QuoteReminderFacts,
} from "../src/lib/owner-email-triggers.core";
import { quoteExpiresAt } from "../src/lib/quote-expiry.core";

const DAY = 86_400_000;
const SENT = "2026-11-02T01:00:00.000Z"; // Sunday 2 Nov, 12pm Melbourne
const at = (days: number) => new Date(Date.parse(SENT) + days * DAY);
const facts = (p: Partial<QuoteReminderFacts> = {}): QuoteReminderFacts => ({
  quote: { kind: "installation", status: "issued", release_state: "released", sent_at: SENT },
  job: { stage: "measured_estimate_ready", deleted_at: null, qa_archived_at: null }, done: [], optedOut: false, ...p,
});

describe("O19 quote reminders (decisions 88/89/134)", () => {
  const expires = quoteExpiresAt(SENT).getTime();
  test("nothing before day 3; day 3 reminder from 3 days after the send", () => {
    expect(quoteReminderDue(facts(), at(2.9))).toBeNull();
    expect(quoteReminderDue(facts(), at(3))).toBe("day3");
    expect(quoteReminderDue(facts({ done: ["day3"] }), at(5))).toBeNull();
  });
  test("expiry reminder 2 days before the price expires; nothing once expired", () => {
    expect(quoteReminderDue(facts({ done: ["day3"] }), new Date(expires - 2 * DAY - 1))).toBeNull();
    expect(quoteReminderDue(facts({ done: ["day3"] }), new Date(expires - 2 * DAY))).toBe("expiry");
    expect(quoteReminderDue(facts({ done: ["day3", "expiry"] }), new Date(expires - DAY))).toBeNull();
    expect(quoteReminderDue(facts(), new Date(expires))).toBeNull();
  });
  test("a missed day 3 reminder is skipped once the expiry one is due (one email, not two)", () => {
    expect(quoteReminderDue(facts(), new Date(expires - DAY))).toBe("expiry");
    expect(quoteReminderDue(facts({ done: ["expiry"] }), new Date(expires - DAY))).toBeNull();
  });
  test("stops when the quote is answered, the job moves on, is cancelled/deleted/archived, or the owner opted out", () => {
    for (const status of ["accepted", "declined", "expired", "draft"]) expect(quoteReminderDue(facts({ quote: { ...facts().quote, status } }), at(4))).toBeNull();
    expect(quoteReminderDue(facts({ quote: { ...facts().quote, release_state: "held" } }), at(4))).toBeNull();
    expect(quoteReminderDue(facts({ quote: { ...facts().quote, kind: "rectification" } }), at(4))).toBeNull();
    for (const stage of ["measured_quote_accepted", "cancelled", "on_hold", "piesa_scheduled"]) expect(quoteReminderDue(facts({ job: { stage, deleted_at: null } }), at(4))).toBeNull();
    expect(quoteReminderDue(facts({ job: { stage: "awaiting_quote_acceptance", deleted_at: null } }), at(4))).toBe("day3");
    expect(quoteReminderDue(facts({ job: { stage: "measured_estimate_ready", deleted_at: "2026-11-03T00:00:00Z" } }), at(4))).toBeNull();
    expect(quoteReminderDue(facts({ job: { stage: "measured_estimate_ready", deleted_at: null, qa_archived_at: "2026-11-03T00:00:00Z" } }), at(4))).toBeNull();
    expect(quoteReminderDue(facts({ optedOut: true }), at(4))).toBeNull();
    expect([...QUOTE_OPEN_STAGES]).toEqual(["measured_estimate_ready", "awaiting_quote_acceptance"]);
  });
});

describe("O51 review request (decision 105)", () => {
  const done = "2026-11-01T00:00:00.000Z";
  const f = (p: Partial<Parameters<typeof reviewRequestDue>[0]> = {}) => ({ installationCompletedAt: done, stage: "ap_review", deletedAt: null, qaArchivedAt: null, done: false, optedOut: false, ...p });
  const day = (n: number) => new Date(Date.parse(done) + n * DAY);
  test("one week after the install; no backlog after day 21", () => {
    expect(reviewRequestDue(f(), day(6.9))).toBe(false);
    expect(reviewRequestDue(f(), day(7))).toBe(true);
    expect(reviewRequestDue(f(), day(20.9))).toBe(true);
    expect(reviewRequestDue(f(), day(21))).toBe(false);
  });
  test("stops once sent, cancelled/on hold, deleted/archived or opted out", () => {
    for (const p of [{ done: true }, { stage: "cancelled" }, { stage: "on_hold" }, { deletedAt: "x" }, { qaArchivedAt: "x" }, { optedOut: true }, { installationCompletedAt: null }]) expect(reviewRequestDue(f(p), day(8))).toBe(false);
  });
  test("held until the My job review screen exists and a Google review link is set", () => {
    expect(OWNER_REVIEW_SCREEN_READY).toBe(false);
    expect(reviewRequestBlocker({ googleReviewUrl: "https://g.page/r/abc/review", reviewScreenReady: false })).toMatch(/review screen/);
    expect(reviewRequestBlocker({ googleReviewUrl: null, reviewScreenReady: true })).toMatch(/HIV_GOOGLE_REVIEW_URL/);
    expect(reviewRequestBlocker({ googleReviewUrl: "http://insecure", reviewScreenReady: true })).toMatch(/HIV_GOOGLE_REVIEW_URL/);
    expect(reviewRequestBlocker({ googleReviewUrl: "https://g.page/r/abc/review", reviewScreenReady: true })).toBeNull();
    // The screen really is missing today: My job only accepts these screens.
    expect(readFileSync("src/routes/my-job.$token.tsx", "utf8")).toContain('const SCREENS = ["home", "spot", "quote", "book", "done"]');
  });
});

describe("O42 install day moved (decision 135)", () => {
  const was = "2026-11-20T20:30:00.000Z", next = "2026-11-24T20:30:00.000Z";
  const change = { at: "2026-11-18T00:00:00.000Z", was, who: "installer" };
  test("the booking that follows an installer's change is a move", () => {
    expect(installDayMove({ newStart: next, change, previousBookingAt: "2026-11-10T00:00:00Z" })).toEqual({ was });
    expect(installDayMove({ newStart: next, change: { ...change, who: null }, previousBookingAt: null })).toEqual({ was });
  });
  test("not a move: owner changed it, no change, a booking already followed the change, or the same start", () => {
    expect(installDayMove({ newStart: next, change: { ...change, who: "owner" }, previousBookingAt: null })).toBeNull();
    expect(installDayMove({ newStart: next, change: null, previousBookingAt: null })).toBeNull();
    expect(installDayMove({ newStart: next, change: { ...change, was: null }, previousBookingAt: null })).toBeNull();
    expect(installDayMove({ newStart: next, change, previousBookingAt: "2026-11-19T00:00:00Z" })).toBeNull();
    expect(installDayMove({ newStart: was, change, previousBookingAt: null })).toBeNull();
  });
  test("direct reschedule: only a different confirmed start", () => {
    expect(directMoveFrom(was, next)).toBe(was);
    expect(directMoveFrom(was, was)).toBeNull();
    expect(directMoveFrom(null, next)).toBeNull();
  });
});

describe("O22 receipt date and labels", () => {
  test("the payment that reached the safety check threshold", () => {
    const ledger = [{ amountCents: 20_000, paidAt: "2026-11-03T00:00:00Z" }, { amountCents: 14_900, paidAt: "2026-11-05T00:00:00Z" }, { amountCents: 50_000, paidAt: "2026-11-09T00:00:00Z" }];
    expect(safetyCheckPaidAt(ledger, 34_900)).toBe("2026-11-05T00:00:00Z");
    expect(safetyCheckPaidAt(ledger.slice(0, 1), 34_900)).toBeNull();
  });
  test("O22 only for a recent safety check payment, never an old one on a later deposit/balance payment", () => {
    const now = new Date("2026-11-10T00:00:00Z");
    expect(youreInDue({ paidAt: "2026-11-09T00:00:00Z", stage: "measured_quote_accepted", deletedAt: null }, now)).toBe(true);
    expect(youreInDue({ paidAt: "2026-11-02T00:00:00Z", stage: "installation_scheduling", deletedAt: null }, now)).toBe(false);
    expect(youreInDue({ paidAt: null, stage: "measured_quote_accepted", deletedAt: null }, now)).toBe(false);
    expect(youreInDue({ paidAt: "2026-11-09T00:00:00Z", stage: "cancelled", deletedAt: null }, now)).toBe(false);
    expect(youreInDue({ paidAt: "2026-11-09T00:00:00Z", stage: "measured_quote_accepted", deletedAt: "x" }, now)).toBe(false);
  });
  test("labels", () => {
    expect(dayMonthLabel("2026-12-05")).toBe("5 December");
    expect(dayMonthLabel(null)).toBeNull();
    expect(weekdayDayMonthLabel("2026-11-05")).toBe("Thursday 5 November");
    expect(weekdayDayMonthLabel("2026-11-04T23:00:00Z")).toBe("Thursday 5 November"); // Melbourne day
  });
  test("keys are per quote / job / start set", () => {
    expect(ownerEmailKey.quoteReminder("q1", "day3")).toBe("quote-reminder:v1:q1:day3");
    expect(ownerEmailKey.youreIn("q1")).toBe("youre-in:v1:q1");
    expect(ownerEmailKey.safetyCheckTimes("j", ["b", "a"])).toBe("safety-check-times:v1:j:a,b");
    expect(ownerEmailKey.installDays("j", ["b", "a"])).toBe("install-days:v1:j:a,b");
    expect(ownerEmailKey.reviewRequest("j")).toBe("review-request:v1:j");
  });
});

const src = (p: string) => readFileSync(p, "utf8");
const count = (s: string, needle: string) => s.split(needle).length - 1;

describe("source pins: each trigger calls its sender exactly once with its key", () => {
  const t = src("src/lib/owner-email-triggers.server.ts");
  test("every trigger goes through fireOwnerEmailOnce (event recorded before the send) and one approved sender", () => {
    const pairs: [string, string, string][] = [
      ["onSafetyCheckTimesOffered", "emailOwnerSafetyCheckTimes(", "ownerEmailKey.safetyCheckTimes("],
      ["onSafetyCheckBooked", "emailOwnerSafetyCheckBooked(", "ownerEmailKey.safetyCheckBooked("],
      ["onFixesQuoteIssued", "emailOwnerFixesQuote(", "ownerEmailKey.fixesQuote("],
      ["onInstallDaysOffered", "emailOwnerInstallDays(", "ownerEmailKey.installDays("],
      ["onInstallDayMoved", "emailOwnerInstallDayChanged(", "ownerEmailKey.installDayChanged("],
      ["onSafetyCheckPaid", "emailOwnerYoureIn(", "ownerEmailKey.youreIn("],
      ["sweepQuoteReminders", "emailOwnerQuoteReminder(", "ownerEmailKey.quoteReminder(q.id, kind)"],
      ["sweepReviewRequests", "emailOwnerReviewRequest(", "ownerEmailKey.reviewRequest(j.id)"],
    ];
    for (const [fn, sender, key] of pairs) {
      expect(count(t, `export async function ${fn}(`)).toBe(1);
      expect(count(t, sender)).toBe(1);
      expect(t).toContain(key);
    }
    expect(t).toContain("OWNER_EMAIL_TRIGGER_EVENT");
    expect(t).not.toMatch(/resend|fetch\(|sendRealSms|sendTestEmail|sendGuardedOwnerEmail/i);
    expect(OWNER_EMAIL_TRIGGER_EVENT).toBe("owner_email_triggered");
  });
  test("the guarded sender reserves the same keys", () => {
    const a = src("src/lib/approved-owner-emails.server.ts");
    for (const k of ["quoteReminder(quoteId, kind)", "youreIn(quoteId)", "safetyCheckTimes(jobId, startsAt)", "safetyCheckBooked(jobId, startIso)", "fixesQuote(quoteId)", "installDays(jobId, startsAt)", "installDayChanged(jobId, startIso)", "reviewRequest(jobId)"])
      expect(a).toContain(`key: ownerEmailKey.${k}`);
    expect(src("src/lib/owner-template-send.server.ts")).toContain("sendGuardedOwnerEmail");
  });
  test("workflow call sites: each fires once, best-effort (.catch) so the action never breaks", () => {
    const sites: [string, string][] = [
      ["src/lib/allocation.functions.ts", "onFixesQuoteIssued(q.job_id, q.id)"],
      ["src/lib/pilot.functions.ts", "onSafetyCheckTimesOffered(data.jobId, [data.start])"],
      ["src/lib/booking.server.ts", "onSafetyCheckBooked(jobId, start, stage === target)"],
      ["src/lib/booking.server.ts", "onInstallBookingRescheduled(jobId, start, priorInstallStart)"],
      ["src/lib/install-days.server.ts", "onInstallDaysOffered(jobId, starts, c.deadline)"],
      ["src/lib/install-days.server.ts", "onInstallDayMoved(jobId, startsAt, movedFrom)"],
      ["src/lib/payments.server.ts", "onSafetyCheckPaid(jobId, invoiceId)"],
    ];
    for (const [file, call] of sites) {
      const s = src(file);
      expect(count(s, call)).toBe(1);
      const line = s.split("\n").find((l) => l.includes(call))!;
      expect(line).toMatch(/\.catch\(/);
    }
    const tick = src("src/routes/api/public/hooks/allocation-tick.ts");
    expect(count(tick, "sweepQuoteReminders()")).toBe(1);
    expect(count(tick, "sweepReviewRequests()")).toBe(1);
  });
  test("O45 final invoice stays unwired: its approved wording offers card payment for the balance (decisions 140/141 say bank transfer only)", () => {
    expect(src("src/lib/completion-emails.core.ts")).toContain("Secure card payment by Stripe");
    const wired = ["src/lib/owner-email-triggers.server.ts", "src/lib/install-complete.server.ts", "src/lib/payments.server.ts", "src/lib/booking.server.ts"].map(src).join("\n");
    expect(wired).not.toContain("emailOwnerFinalInvoice(");
  });
});
