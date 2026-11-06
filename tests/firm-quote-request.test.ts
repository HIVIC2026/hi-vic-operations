import { beforeEach, expect, mock, test } from "bun:test";
const token = "a".repeat(43);
let live: string | null;
let source: string;
let stage: string;
let opted: boolean;
let quoted: boolean;
let validToken: boolean;
let saved: string | null;
let events: unknown[];
let queue: unknown[];
let sends = 0;
let rpcCalls = 0;
let rpcError = false;
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from(table: string) {
    let tokenFilter: string | null = null;
    const q = { select: () => q, eq: (key: string, value: string) => { if (key === "token") tokenFilter = value; return q; }, order: () => q, limit: () => q, maybeSingle: () => q,
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null, data:
        table === "workflow_settings" ? { firm_quote_flow_live_at: live } :
        table === "documents" ? [{ kind: "intake_media", mime_type: "image/jpeg", storage_path: "job/photo.jpg" }] :
        table === "jobs" ? { id: "job", source, created_at: "2026-11-06T06:00:00Z", stage, owners: { full_name: "Alex Example" } } :
        table === "customer_estimate_links" ? (validToken && (!tokenFilter || tokenFilter === token) ? { id: "link", job_id: "job", status: "active", expires_at: "9999-12-31" } : null) : null }).then(resolve) };
    return q;
  },
  async rpc(name: string, input: Record<string, unknown>) {
    rpcCalls++;
    expect(name).toBe("request_firm_quote_atomic");
    if (rpcError) return { data: null, error: { message: "missing RPC" } };
    if (["cancelled", "complete", "on_hold"].includes(stage)) return { data: { ok: false, reason: "closed" }, error: null };
    if (opted) return { data: { ok: false, reason: "opted_out" }, error: null };
    if (quoted) return { data: { ok: false, reason: "quoted" }, error: null };
    const already = saved !== null;
    if (!saved) { saved = String(input.p_due_by); events.push({ event_type: "firm_quote_requested", details: { due_by: saved, firm_quote: true } }); }
    return { data: { ok: true, dueBy: saved, already }, error: null };
  },
} }));
mock.module("../src/lib/sms.server", () => ({ sendRealSms: () => { sends++; throw new Error("forbidden"); } }));
mock.module("../src/lib/spot-saved-send.server", () => ({ sendSpotSavedConfirmation: () => { sends++; throw new Error("forbidden"); } }));
const { requestFirmQuote, requestFirmQuoteToken, firmQuoteRequestPage } = await import("../src/lib/firm-quote.server");
beforeEach(() => { live = "2026-11-06T06:00:00Z"; source = "base44"; stage = "new_enquiry"; opted = quoted = rpcError = false; validToken = true; saved = null; events = []; queue = []; sends = rpcCalls = 0; });
test("first tap records one request with seven-business-day due date and nothing queued", async () => {
  expect(await requestFirmQuote("job", "link", "2026-11-06T06:00:00Z")).toEqual({ ok: true, dueBy: "2026-11-17", already: false });
  expect(events).toEqual([{ event_type: "firm_quote_requested", details: { due_by: "2026-11-17", firm_quote: true } }]); expect(queue).toHaveLength(0);
});
test("second tap keeps saved due date without another event or queue item", async () => {
  await requestFirmQuote("job", "link", "2026-11-06T06:00:00Z");
  expect(await requestFirmQuote("job", "link", "2026-11-10T06:00:00Z")).toEqual({ ok: true, dueBy: "2026-11-17", already: true }); expect(events).toHaveLength(1); expect(queue).toHaveLength(0);
});
test("two devices use one atomic request, not application-level writes", async () => {
  const results = await Promise.all([requestFirmQuoteToken(token, false), requestFirmQuoteToken(token, false)]);
  expect(results.filter(r => r.ok && !r.already)).toHaveLength(1); expect(events).toHaveLength(1); expect(queue).toHaveLength(0);
});
for (const closed of ["cancelled", "complete", "on_hold"]) test(`${closed} job records nothing`, async () => {
  stage = closed; expect(await requestFirmQuote("job", "link")).toEqual({ ok: false, reason: "closed" }); expect(events).toHaveLength(0); expect(queue).toHaveLength(0);
});
test("opt-out records nothing", async () => { opted = true; expect(await requestFirmQuote("job", "link")).toEqual({ ok: false, reason: "opted_out" }); expect(events).toHaveLength(0); expect(queue).toHaveLength(0); });
test("already quoted records nothing", async () => { quoted = true; expect(await requestFirmQuote("job", "link")).toEqual({ ok: false, reason: "quoted" }); expect(events).toHaveLength(0); expect(queue).toHaveLength(0); });
test("null switch records nothing, including no RPC", async () => { live = null; expect(await requestFirmQuoteToken(token, false)).toEqual({ ok: false, reason: "not_firm_quote", firstName: null }); expect(rpcCalls).toBe(0); expect(queue).toHaveLength(0); });
test("no owner message is sent on tap", async () => { await requestFirmQuoteToken(token, false); expect(sends).toBe(0); });
test("invalid or revoked token cannot request another job", async () => { validToken = false; expect((await requestFirmQuoteToken(token, false)).ok).toBe(false); expect(rpcCalls).toBe(0); expect((await requestFirmQuoteToken("bad", false)).ok).toBe(false); });
test("preview cannot write real website jobs", async () => { expect((await requestFirmQuoteToken(token, true)).ok).toBe(false); expect(rpcCalls).toBe(0); });
test("preview qa_test request saves once and replays without messages", async () => {
  source = "qa_test";
  expect(await firmQuoteRequestPage(token)).toEqual({ available: true, firstName: "Alex" });
  const first = await requestFirmQuoteToken(token, true);
  expect(first.ok).toBe(true);
  expect(first.ok && first.already).toBe(false);
  expect(await requestFirmQuoteToken(token, true)).toEqual({ ...first, already: true });
  expect(events).toHaveLength(1); expect(queue).toHaveLength(0); expect(sends).toBe(0);
});
test("reading the page does not request, enqueue or send", async () => { expect(await firmQuoteRequestPage(token)).toEqual({ available: true, firstName: "Alex" }); expect(rpcCalls).toBe(0); expect(queue).toHaveLength(0); expect(sends).toBe(0); });
test("missing atomic writer fails closed without separate fallback writes", async () => { rpcError = true; await expect(requestFirmQuote("job", "link")).rejects.toThrow("couldn't save"); expect(events).toHaveLength(0); expect(queue).toHaveLength(0); });