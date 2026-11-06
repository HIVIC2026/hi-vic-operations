// Launch blocker Task 1 (QA 7 Nov (a)/(b1)/(b2)): the Stripe webhook never loses or strands a payment.
// A read error or a half-applied payment answers 500 so Stripe retries; a retry finishes the unfinished steps once.
// Only persistence/downstream boundaries are mocked; no network.
import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { createHmac } from "node:crypto";

const SECRET = "whsec_fixture_recovery";
const savedSecret = process.env["STRIPE_WEBHOOK_SECRET"];
const savedFetch = globalThis.fetch;
process.env["STRIPE_WEBHOOK_SECRET"] = SECRET;
globalThis.fetch = (async () => { throw new Error("Network forbidden in webhook tests"); }) as typeof fetch;
afterAll(() => {
  globalThis.fetch = savedFetch;
  if (savedSecret === undefined) delete process.env["STRIPE_WEBHOOK_SECRET"]; else process.env["STRIPE_WEBHOOK_SECRET"] = savedSecret;
});

type Row = Record<string, unknown>;
const ledger: Row[] = [];
const effects: string[] = [];
const configLog: Row[] = [];
const invoice: Row = {};
let invoiceRead: { data: unknown; error: unknown } | null = null;
let refundLookup: { data: unknown; error: unknown } = { data: [], error: null };
let failEffectsOnce = false;
let loseInsertRace = false;

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from: (table: string) => {
    const filters: Row = {};
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order"]) q[m] = () => q;
    q["contains"] = (_c: string, v: Row) => { Object.assign(filters, v); return q; };
    q["maybeSingle"] = async () => (table === "invoices" ? (invoiceRead ?? { data: { ...invoice }, error: null }) : { data: null, error: null });
    q["limit"] = async () => {
      if (table === "workflow_events") return refundLookup;
      if (table === "admin_config_events") return { data: configLog.filter((r) => (r["details"] as Row)["stripe_event_id"] === filters["stripe_event_id"]), error: null };
      return { data: [], error: null };
    };
    q["insert"] = async (row: Row) => { if (table === "admin_config_events") configLog.push(row); return { error: null }; };
    return q;
  },
} }));
mock.module("../src/lib/workflow.server", () => ({ logEvent: async () => undefined }));
mock.module("../src/lib/veec-refund-flag.server", () => ({ flagRefundAfterVeecCreation: async () => undefined }));
mock.module("../src/lib/xero.server", () => ({ applyPaidAmount: async (_id: string, amount: number) => { invoice["total_paid"] = amount; effects.push("applyPaidAmount"); } }));
mock.module("../src/lib/payments.server", () => ({
  PAYMENT_EVENT: "owner_payment_recorded", PAYMENT_REVERSED_EVENT: "owner_payment_reversed",
  rawPaymentLedger: async () => ledger.map((r) => ({ ...r })),
  insertLedgerEvent: async (_j: string, _a: unknown, eventType: string, _s: string, details: Row) => {
    if (loseInsertRace || ledger.some((r) => r["receipt_key"] === details["receipt_key"])) return "duplicate";
    ledger.push({ eventType, ...details }); return "recorded";
  },
  flagUnclearPaymentMatches: async () => 0,
  reconciledInvoicePaidCents: async () => 34_900,
  afterPaymentsChanged: async (jobId: string) => {
    if (failEffectsOnce) { failEffectsOnce = false; throw new Error("statement timeout after the receipt was saved"); }
    effects.push(`afterPaymentsChanged:${jobId}`);
  },
  jobPaymentView: async () => null, stepInvoice: () => null,
}));
const { handleStripeWebhook } = await import("../src/lib/stripe.server");

const sign = (raw: string) => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${createHmac("sha256", SECRET).update(`${t}.${raw}`).digest("hex")}`; };
const payEvt = () => JSON.stringify({ id: "evt_pay_1", type: "payment_intent.succeeded", livemode: true, created: Math.floor(Date.now() / 1000),
  data: { object: { id: "pi_1", amount_received: 34_900, latest_charge: "ch_1", metadata: { job_id: "job-1", invoice_id: "inv-1", step: "safety_check" } } } });
const refundEvt = (id = "evt_ref_1") => JSON.stringify({ id, type: "charge.refunded", livemode: true, created: Math.floor(Date.now() / 1000),
  data: { object: { id: "ch_1", payment_intent: "pi_1", amount_refunded: 34_900 } } });
const deliver = (raw: string) => handleStripeWebhook(raw, sign(raw));

beforeEach(() => {
  ledger.length = 0; effects.length = 0; configLog.length = 0; failEffectsOnce = false; loseInsertRace = false; invoiceRead = null;
  refundLookup = { data: [], error: null };
  Object.assign(invoice, { id: "inv-1", job_id: "job-1", kind: "installation", total_paid: 0, jobs: { source: "website", business_unit: "hivic" } });
});

test("invoice read error returns 500 not unknown_invoice", async () => {
  invoiceRead = { data: null, error: { message: "canceling statement due to statement timeout" } };
  const r = await deliver(payEvt());
  expect(r.status).toBe(500);
  expect(r.outcome.startsWith("retry:")).toBe(true);
  expect(ledger).toHaveLength(0);
});

test("retry after partial apply is idempotent", async () => {
  failEffectsOnce = true;
  const first = await deliver(payEvt());
  expect(first.status).toBe(500);
  expect(ledger).toHaveLength(1);
  expect(effects.filter((e) => e.startsWith("afterPaymentsChanged"))).toHaveLength(0);
  const retry = await deliver(payEvt());
  expect(retry.status).toBe(200);
  expect(effects.filter((e) => e.startsWith("afterPaymentsChanged"))).toEqual(["afterPaymentsChanged:job-1"]);
  expect(ledger).toHaveLength(1);
  expect(invoice["total_paid"]).toBe(349);
});

test("refund with no matching payment returns 500 and logs once per event", async () => {
  const a = await deliver(refundEvt());
  const b = await deliver(refundEvt());
  expect(a.status).toBe(500);
  expect(b.status).toBe(500);
  expect(ledger).toHaveLength(0);
  expect(configLog).toHaveLength(1);
  expect((configLog[0]!["details"] as Row)["stripe_event_id"]).toBe("evt_ref_1");
  await deliver(refundEvt("evt_ref_2"));
  expect(configLog).toHaveLength(2);
});

test("refund lookup error returns 500", async () => {
  refundLookup = { data: null, error: { message: "canceling statement due to statement timeout" } };
  const r = await deliver(refundEvt());
  expect(r.status).toBe(500);
  expect(ledger).toHaveLength(0);
});

// Fix round 1 (review of PR A): the database's error text never goes into the webhook outcome (the route can put an
// outcome in the response body); the detail goes to the server log only.
test("a database error is answered with a fixed retry outcome, never the raw error text", async () => {
  invoiceRead = { data: null, error: { message: "relation \"invoices\" secret detail at 10.0.0.5" } };
  const r = await deliver(payEvt());
  expect(r).toEqual({ status: 500, outcome: "retry:error" });
});

// Fix round 1: losing the insert race to a concurrent delivery of the same receipt leaves the follow-up to the winner
// (running it twice at once raced the once-only emails); a LATER duplicate (fast path) still finishes it.
test("insert-race duplicate does not re-run the follow-up; a later fast-path duplicate does", async () => {
  loseInsertRace = true;
  const lost = await deliver(payEvt());
  expect(lost).toEqual({ status: 200, outcome: "duplicate" });
  expect(effects.filter((e) => e.startsWith("afterPaymentsChanged"))).toEqual([]);
  loseInsertRace = false;
  ledger.push({ eventType: "owner_payment_recorded", note: "stripe:pi_1", receipt_key: "stripe:pi_1" });
  expect(await deliver(payEvt())).toEqual({ status: 200, outcome: "duplicate" });
  expect(effects.filter((e) => e.startsWith("afterPaymentsChanged"))).toEqual(["afterPaymentsChanged:job-1"]);
});
