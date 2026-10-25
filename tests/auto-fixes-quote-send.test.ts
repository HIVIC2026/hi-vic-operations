// Decision 354 (Jo 25 Oct 2026): the electrician-priced (A3) fixes quote goes to the owner automatically when the A3 is
// complete and every existing check passes; no office "Fixes quote to check" step unless a check fails.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AUTO_FIXES_HOLD, AUTO_FIXES_QUOTE_HELD_EVENT, AUTO_FIXES_QUOTE_SEND_ENABLED, autoFixesSendDecision, type AutoFixesFacts } from "../src/lib/auto-fixes-quote-send.core";

const ok: AutoFixesFacts = { enabled: true, a4Completed: true, a4Priced: true, quote: { status: "draft", sent_at: null }, isTestJob: false, commsEnabled: true, sendBlocker: null, waitingForTimes: false };
const read = (f: string) => readFileSync(f, "utf8");

describe("decision 354: automatic fixes quote send (pure rule)", () => {
  test("the code switch is on; one held event type", () => {
    expect(AUTO_FIXES_QUOTE_SEND_ENABLED).toBe(true);
    expect(AUTO_FIXES_QUOTE_HELD_EVENT).toBe("fixes_quote_auto_send_held");
  });
  test("A3 complete + electrician-priced draft + every check passes + comms on → send", () => {
    expect(autoFixesSendDecision(ok)).toEqual({ action: "send" });
  });
  test("TEST jobs send (test-send downstream) even with the master switch off; real owners wait for customer_comms_enabled", () => {
    expect(autoFixesSendDecision({ ...ok, isTestJob: true, commsEnabled: false })).toEqual({ action: "send" });
    expect(autoFixesSendDecision({ ...ok, commsEnabled: false })).toEqual({ action: "hold", reason: AUTO_FIXES_HOLD.commsOff });
  });
  test("idempotent: an issued / accepted / already-sent quote is never sent again", () => {
    for (const quote of [{ status: "issued", sent_at: "2026-10-25T01:00:00Z" }, { status: "accepted", sent_at: "2026-10-25T01:00:00Z" }, { status: "draft", sent_at: "2026-10-25T01:00:00Z" }, { status: "declined", sent_at: null }])
      expect(autoFixesSendDecision({ ...ok, quote }).action).toBe("wait");
    expect(autoFixesSendDecision({ ...ok, quote: null }).action).toBe("wait");
  });
  test("not yet: switch off, A3 not Complete, waiting for the electrician's fixes times (no office item)", () => {
    expect(autoFixesSendDecision({ ...ok, enabled: false }).action).toBe("wait");
    expect(autoFixesSendDecision({ ...ok, a4Completed: false }).action).toBe("wait");
    expect(autoFixesSendDecision({ ...ok, waitingForTimes: true }).action).toBe("wait");
  });
  test("a failed check keeps the office row, with the reason", () => {
    expect(autoFixesSendDecision({ ...ok, sendBlocker: "Some electrical fixes items still need office pricing." })).toEqual({ action: "hold", reason: "Some electrical fixes items still need office pricing." });
    expect(autoFixesSendDecision({ ...ok, a4Priced: false })).toEqual({ action: "hold", reason: AUTO_FIXES_HOLD.notA4Priced });
  });
});

describe("decision 354: wiring", () => {
  test("office Send and the automatic send share ONE release (same checks, same O29 owner email + link)", () => {
    const rel = read("src/lib/fixes-quote-release.server.ts");
    expect(rel).toContain("rectificationSendBlocker({");
    expect(rel).toContain(".eq(\"status\", \"draft\").select(\"id\").maybeSingle()"); // flips only from draft → once per quote
    expect(rel).toContain("onFixesQuoteIssued(q.job_id, q.id)");
    expect(read("src/lib/allocation.functions.ts")).toContain('releaseFixesQuote(data.quoteId, context.userId, "office")');
    const auto = read("src/lib/auto-fixes-quote-send.server.ts");
    expect(auto).toContain('rel.releaseFixesQuote(quote.id, opts.actorId ?? null, "auto")');
    expect(auto).toContain("customerCommsEnabled()");
    expect(auto).not.toMatch(/sendGuardedOwnerEmail|sendTestEmail|resendSend/); // no sender of its own
  });
  test("triggered at the A3 completion, when the electrician gives the fixes times, and on the 15-minute tick", () => {
    const m = read("src/lib/mitti.server.ts");
    expect(m).toMatch(/if \(completed\) await \(await import\("\.\/auto-fixes-quote-send\.server"\)\)\.maybeAutoSendFixesQuote\(jobId, \{ actorId, generate: true \}\)/);
    expect(read("src/lib/trade-view.functions.ts")).toContain("maybeAutoSendFixesQuote(data.jobId");
    expect(read("src/routes/api/public/hooks/allocation-tick.ts")).toContain("sweepAutoFixesQuotes()");
  });
  test("Needs me keeps the 'fixes quote to check' row with the held reason", () => {
    const n = read("src/lib/office-needs.server.ts");
    expect(n).toContain("AUTO_FIXES_QUOTE_HELD_EVENT");
    expect(n).toContain("x.fixesQuoteToCheck = { at: String(h[\"created_at\"]), reason:");
  });
  test("the quote builder and the stage engine never send: only the triggers above call the automatic send", () => {
    for (const f of ["src/lib/quotes.server.ts", "src/lib/autoadvance.server.ts", "src/lib/requirements.server.ts", "src/lib/rectification.server.ts"])
      expect(read(f), f).not.toMatch(/auto-fixes-quote-send\.server|fixes-quote-release\.server/);
  });
});
