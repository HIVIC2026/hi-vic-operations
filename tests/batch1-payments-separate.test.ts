// Batch 1 task 4 fix: "Two separate payments" writes ONE append-only event, both payments count, the unclear row clears.
import { beforeEach, expect, mock, test } from "bun:test";

const T0 = "2026-10-24T03:00:00.000Z";
let events: { event_type: string; created_at: string; details: Record<string, unknown> }[] = [];
const logged: { type: string; details: Record<string, unknown> }[] = [];
const applied: number[] = [];
const seed = () => { events = [
  { event_type: "owner_payment_recorded", created_at: T0, details: { invoice_id: "inv-1", amount_cents: 34_900, source: "card", paid_at: T0, note: "stripe:pi_3Abc123456", stripe_payment_intent: "pi_3Abc123456" } },
  { event_type: "owner_payment_recorded", created_at: "2026-10-26T03:00:00.000Z", details: { invoice_id: "inv-1", amount_cents: 34_900, source: "xero", paid_at: "2026-10-26T03:00:00.000Z", xero_payment_id: "x1" } },
  { event_type: "owner_payment_match_unclear", created_at: "2026-10-26T04:00:00.000Z", details: { invoice_id: "inv-1", pair_key: "pi_3Abc123456|x1" } },
]; };
mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: { from() {
  let types: string[] = [];
  const q: any = { select() { return q; }, eq(_c: string, v: string) { if (_c === "event_type") types = [v]; return q; }, in(_c: string, v: string[]) { types = v; return q; }, order() { return q; }, update() { return q; },
    then(res: (v: unknown) => void) { return res({ data: events.filter((e) => types.includes(e.event_type)).map((e, i) => ({ id: `e${i}`, actor_id: null, ...e })), error: null }); } };
  return q;
} } }));
mock.module("../src/lib/workflow.server", () => ({ paymentGateActiveForJob: async () => false, logEvent: async (_j: string, _a: unknown, type: string, _s: string, details: Record<string, unknown>) => { logged.push({ type, details }); events.push({ event_type: type, created_at: new Date().toISOString(), details }); } }));
mock.module("../src/lib/xero.server", () => ({ applyPaidAmount: async (_i: string, paid: number) => { applied.push(paid); } }));
const { markPaymentsSeparate, unclearPaymentPairs, reconciledInvoicePaidCents } = await import("../src/lib/payments.server");

beforeEach(() => { seed(); logged.length = 0; applied.length = 0; });

test("unmarked pair counts once and is waiting for the office", async () => {
  expect(await reconciledInvoicePaidCents("job-1", "inv-1")).toBe(34_900);
  expect((await unclearPaymentPairs("job-1", "inv-1")).map((p) => p.pairKey)).toEqual(["pi_3Abc123456|x1"]);
});

test("Two separate payments: one event, both count, row resolved; second press adds nothing", async () => {
  expect(await markPaymentsSeparate("job-1", "inv-1", "pi_3Abc123456|x1", "u1")).toBe(true);
  expect(logged.map((l) => l.type)).toEqual(["payment_match_separate", "owner_payment_match_resolved"]);
  expect(applied).toEqual([698]);
  expect(await reconciledInvoicePaidCents("job-1", "inv-1")).toBe(69_800);
  expect(await unclearPaymentPairs("job-1", "inv-1")).toEqual([]);
  logged.length = 0;
  expect(await markPaymentsSeparate("job-1", "inv-1", "pi_3Abc123456|x1", "u1")).toBe(false);
  expect(logged).toEqual([]);
});

test("a pair that is not waiting is refused", async () => {
  await expect(markPaymentsSeparate("job-1", "inv-1", "pi_nope|x9", "u1")).rejects.toThrow("no longer waiting");
});
