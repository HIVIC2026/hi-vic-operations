import { beforeEach, expect, mock, test } from "bun:test";
let quote: any, channel = "installer_sourced", blockers: string[] = [], notifications = 0, writes = 0, consent = true;
mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: { from(table: string) {
  let update: any = null;
  const q: any = { select() { return q; }, eq() { return q; }, is() { return q; }, in() { return q; }, order() { return q; }, limit() { return q; }, update(p: any) { update = p; return q; },
    single() { return Promise.resolve(result()); }, maybeSingle() { return Promise.resolve(result()); }, then(a: any, b: any) { return Promise.resolve(result()).then(a, b); } };
  function result() {
    if (table === "quotes") { if (update) { writes++; Object.assign(quote, update); } return { data: quote, error: null }; }
    if (table === "jobs") return { data: { channel, stage: "ready_check_complete", deleted_at: null, qa_archived_at: null }, error: null };
    if (table === "ceiling_measurements") return { data: { status: "complete", measured_area_m2: 100 }, error: null };
    if (table === "workflow_events") return { data: [], error: null };
    return { data: null, error: null };
  }
  return q;
} } }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: Error, logEvent: async () => {} }));
mock.module("../src/lib/installer-intake.server", () => ({ intakeSendBlockers: async () => blockers }));
mock.module("../src/lib/installer-quote.server", () => ({ quoteBillingBlocker: async () => null }));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => { if (!consent) throw Error("No contact consent"); } }));
mock.module("../src/lib/pilot.server", () => ({ applyCobrand: async () => {} }));
mock.module("../src/lib/quote-ready-notify.server", () => ({ notifyOwnerQuoteReady: async () => { notifications++; return { email: "test accepted", sms: "test accepted" }; } }));
const { sendOfficeReviewedQuote } = await import("../src/lib/office-quote-review.server");
const { releaseQueuedQuotes } = await import("../src/lib/quotes.server");
beforeEach(() => { channel = "installer_sourced"; blockers = []; notifications = 0; writes = 0; consent = true; quote = { id: "q", job_id: "j", kind: "installation", status: "draft", release_state: "held", release_hold_reason: "Waiting for office review before sending", sent_at: null, option_code: "INSTALLER_A1", created_at: "2026-10-23T00:00:00Z" }; });
test.each(["INSTALLER_A1", "R5_BATTS"])("timer/tick never writes or sends %s", async code => {
  quote.option_code = code;
  expect(await releaseQueuedQuotes()).toEqual({ released: 0 });
  expect(writes).toBe(0); expect(notifications).toBe(0);
});
test("audit 23 Oct: old held-quote Approve can never release a quote", async () => {
  const { approveHeldQuote } = await import("../src/lib/quotes.server");
  await expect(approveHeldQuote("q", "a")).rejects.toThrow(/Send quote/);
  expect(writes).toBe(0); expect(notifications).toBe(0);
});
test.each(["INSTALLER_A1", "R5_BATTS"])("only explicit office send calls both-channel notifier for %s once", async code => {
  quote.option_code = code; channel = code === "INSTALLER_A1" ? "installer_sourced" : "hivic_sourced";
  expect((await sendOfficeReviewedQuote("j", "q", "office")).notification).toEqual({ email: "test accepted", sms: "test accepted" });
  expect(quote.office_reviewed_by).toBe("office"); expect(notifications).toBe(1);
  await expect(sendOfficeReviewedQuote("j", "q", "office")).rejects.toThrow(); expect(notifications).toBe(1);
});
test("held quote cannot be sent until fixed", async () => {
  blockers = ["Owner eligibility needs checking"];
  await expect(sendOfficeReviewedQuote("j", "q", "office")).rejects.toThrow("Owner eligibility needs checking");
  expect(writes).toBe(0); expect(notifications).toBe(0);
});
test("manual action cannot bypass contact consent", async () => {
  consent = false;
  await expect(sendOfficeReviewedQuote("j", "q", "office")).rejects.toThrow("No contact consent");
  expect(writes).toBe(0); expect(notifications).toBe(0);
});