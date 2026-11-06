// Firm-quote plan Task 9: firm quotes are always held for Jo; Jo's Send uses the firm-quote-ready email.
import { describe, expect, mock, test } from "bun:test";
import { autoSendDecision, FIRM_QUOTE_HOLD_REASON } from "../src/lib/auto-quote-send.core";

let firm = false;
const events: { type: string; details: Record<string, unknown> }[] = [];
const released: string[] = [];
const quotes = [{ id: "q1", status: "draft", sent_at: null, release_state: null, release_hold_reason: null, created_at: "2026-11-06T00:00:00Z", option_code: "R5_BATTS" }];
function chain(table: string) {
  const c: Record<string, unknown> = {};
  for (const k of ["select", "eq", "order", "contains", "in", "limit"]) c[k] = () => c;
  c.then = (r: (v: unknown) => unknown) => r(table === "quotes" ? { data: quotes, error: null } : { data: [], count: 0, error: null });
  return c;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: chain } }));
mock.module("../src/lib/workflow.server", () => ({ logEvent: async (_j: string, _a: unknown, type: string, _s: string, details: Record<string, unknown>) => { events.push({ type, details }); } }));
mock.module("../src/lib/installer-quote.server", () => ({ INSTALLER_QUOTE_CODE: "INSTALLER_A1" }));
mock.module("../src/lib/office-quote-review.server", () => ({ officeQuoteBlockers: async () => [], releaseQuoteToOwner: async (_j: string, id: string) => { released.push(id); } }));
mock.module("../src/lib/firm-quote.server", () => ({ isFirmQuoteJobId: async () => firm, firmQuoteReadyFacts: async () => { throw new Error("unused"); } }));

describe("Task 9 hold", () => {
  test("firm-quote job with every check passing is still held with the reason", () => {
    expect(autoSendDecision({ enabled: true, formCompleted: true, quoteReady: true, blockers: [], sentBefore: false, firmQuote: true }))
      .toEqual({ send: false, reasons: ["Firm quote: you press Send"] });
    expect(FIRM_QUOTE_HOLD_REASON).toBe("Firm quote: you press Send");
  });
  test("normal job still auto-sends", () => {
    expect(autoSendDecision({ enabled: true, formCompleted: true, quoteReady: true, blockers: [], sentBefore: false })).toEqual({ send: true });
  });
  test("server: firm-quote draft is held on Quotes to check, never released; normal job released", async () => {
    const { maybeAutoSendInstallerQuote } = await import("../src/lib/auto-quote-send.server");
    firm = true;
    const r = await maybeAutoSendInstallerQuote("j1", { formCompleted: true, formModifiedAt: null, enabled: true });
    expect(r).toEqual({ sent: false, reasons: [FIRM_QUOTE_HOLD_REASON] });
    expect(released).toEqual([]);
    expect(events.find((e) => e.type === "quote_auto_send_held")?.details.reasons).toEqual([FIRM_QUOTE_HOLD_REASON]);
    firm = false;
    const n = await maybeAutoSendInstallerQuote("j1", { formCompleted: true, formModifiedAt: null, enabled: true });
    expect(n).toEqual({ sent: true, reasons: [] });
    expect(released).toEqual(["q1"]);
  });
});

describe("Task 9 email 3", () => {
  const input = { firstName: "Sam", address: "1 Test St", totalIncGst: 1500, rebateIncGst: 900, subtotalIncGst: 2400, lines: [], quoteUrl: "https://example.test/my-job/abc",
    validUntil: new Date("2026-12-06T02:00:00Z"), officePhone: null, unsubscribeUrl: null };
  test("Jo's Send uses email 3 with told/confirmed and the removal line from the quote", async () => {
    const { renderFirmQuoteReady } = await import("../src/lib/quote-ready-notify.server");
    const m = renderFirmQuoteReady(input, { ownerM2: 120, confirmedM2: 110, removalM2: 40, removalRatePerM2: 11 });
    expect(m.subject).toBe("Your firm quote is ready: $1,500 after rebate");
    expect(m.text).toContain("You told us 120 m². We confirmed 110 m².");
    expect(m.text).toContain("40 m² × $11 = $440");
    expect(m.text).toContain("https://example.test/my-job/abc");
    expect(m.text).toContain("until Sunday 6 December");
  });
  test("ownerM2 null drops 'You told us'; no removal = no removal line", async () => {
    const { renderFirmQuoteReady } = await import("../src/lib/quote-ready-notify.server");
    const m = renderFirmQuoteReady(input, { ownerM2: null, confirmedM2: 110, removalM2: 0, removalRatePerM2: 11 });
    expect(m.text).not.toContain("You told us");
    expect(m.text).toContain("We confirmed 110 m².");
    expect(m.text).not.toContain("Removal of old insulation");
  });
});
