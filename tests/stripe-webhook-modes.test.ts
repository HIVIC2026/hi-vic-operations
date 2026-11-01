// B2 (#131): real signature verifier → real webhook → real recordStripePayment.
// Only persistence/downstream boundaries are mocked; no network, settings or configured secrets are used.
import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { createHmac } from "node:crypto";

const LIVE = "whsec_fixture_live_only", TEST = "whsec_fixture_test_only";
const ledger: Record<string, unknown>[] = [];
const effects: string[] = [];
let source = "qa_test", reads = 0;
const envNames = ["STRIPE_WEBHOOK_SECRET", "STRIPE_TEST_WEBHOOK_SECRET"] as const;
const savedEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
const savedFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw new Error("Network forbidden in webhook tests"); }) as typeof fetch;
afterAll(() => {
  globalThis.fetch = savedFetch;
  for (const name of envNames) {
    const value = savedEnv[name];
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from: () => {
    reads++;
    const query = {
      select: () => query, eq: () => query,
      maybeSingle: async () => ({ data: { id: "inv-b2", job_id: "job-b2", kind: "installation", total_paid: 349, jobs: { source, business_unit: "hivic" } } }),
    };
    return query;
  },
} }));
mock.module("../src/lib/workflow.server", () => ({ logEvent: async () => undefined }));
mock.module("../src/lib/payments.server", () => ({
  PAYMENT_EVENT: "owner_payment_recorded", PAYMENT_REVERSED_EVENT: "owner_payment_reversed",
  rawPaymentLedger: async () => ledger,
  insertLedgerEvent: async (jobId: string, _actor: unknown, eventType: string, _summary: string, details: Record<string, unknown>) => {
    ledger.push({ jobId, eventType, ...details }); return "recorded";
  },
  flagUnclearPaymentMatches: async () => undefined,
  reconciledInvoicePaidCents: async () => 34_900,
  afterPaymentsChanged: async (jobId: string) => { effects.push(jobId); },
  jobPaymentView: async () => null, stepInvoice: () => null,
}));
const { handleStripeWebhook } = await import("../src/lib/stripe.server");
const body = (livemode: unknown = false, type = "payment_intent.succeeded") => JSON.stringify({
  id: "evt_b2", type, livemode, created: Math.floor(Date.now() / 1000),
  data: { object: { id: "pi_b2", amount_received: 34_900, latest_charge: "ch_b2", metadata: { job_id: "job-b2", invoice_id: "inv-b2", step: "safety_check" } } },
});
const sign = (raw: string, secret: string, age = 0) => {
  const t = Math.floor(Date.now() / 1000) - age;
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`;
};
beforeEach(() => {
  ledger.length = 0; effects.length = 0; reads = 0; source = "qa_test";
  process.env["STRIPE_WEBHOOK_SECRET"] = LIVE;
  process.env["STRIPE_TEST_WEBHOOK_SECRET"] = TEST;
});
const nothingRecorded = () => { expect(ledger).toHaveLength(0); expect(effects).toHaveLength(0); expect(reads).toBe(0); };

test("TEST-secret signed livemode=false records $349 through recordStripePayment", async () => {
  const raw = body();
  expect(await handleStripeWebhook(raw, sign(raw, TEST))).toEqual({ status: 200, outcome: "recorded" });
  expect(ledger).toEqual([expect.objectContaining({ jobId: "job-b2", eventType: "owner_payment_recorded", invoice_id: "inv-b2", amount_cents: 34_900, receipt_key: "stripe:pi_b2" })]);
  expect(effects).toEqual(["job-b2"]);
});
test("live-mode is accepted with the live secret", async () => {
  source = "website";
  const raw = body(true);
  expect(await handleStripeWebhook(raw, sign(raw, LIVE))).toEqual({ status: 200, outcome: "recorded" });
  expect(ledger).toHaveLength(1);
});
test("live-mode signed only by TEST secret is rejected without any reads or records", async () => {
  source = "website";
  const raw = body(true);
  expect(await handleStripeWebhook(raw, sign(raw, TEST))).toEqual({ status: 400, outcome: "bad_signature" });
  nothingRecorded();
});
test("bad signature returns 400 and records nothing", async () => {
  const raw = body();
  expect(await handleStripeWebhook(raw, sign(raw, "untrusted-fixture"))).toEqual({ status: 400, outcome: "bad_signature" });
  nothingRecorded();
});
test("optional TEST secret unset still rejects the test-endpoint signature", async () => {
  delete process.env["STRIPE_TEST_WEBHOOK_SECRET"];
  const raw = body();
  expect(await handleStripeWebhook(raw, sign(raw, TEST))).toEqual({ status: 400, outcome: "bad_signature" });
  nothingRecorded();
});
test("live-secret verification retains existing acceptance of test-mode events", async () => {
  delete process.env["STRIPE_TEST_WEBHOOK_SECRET"];
  const raw = body();
  expect(await handleStripeWebhook(raw, sign(raw, LIVE))).toEqual({ status: 200, outcome: "recorded" });
  expect(ledger).toHaveLength(1);
});
test("TEST secret never authorises missing or non-boolean livemode, including ignored events", async () => {
  for (const mode of [undefined, null, "false", 0, true]) {
    const event = JSON.parse(body(mode, "unhandled.event"));
    if (mode === undefined) delete event.livemode;
    const raw = JSON.stringify(event);
    expect(await handleStripeWebhook(raw, sign(raw, TEST))).toEqual({ status: 400, outcome: "bad_signature" });
    nothingRecorded();
  }
});
test("tampered body, stale signature and missing header all reject before persistence", async () => {
  const raw = body();
  for (const [payload, header] of [[raw + " ", sign(raw, TEST)], [raw, sign(raw, TEST, 301)], [raw, null]] as const) {
    expect(await handleStripeWebhook(payload, header)).toEqual({ status: 400, outcome: "bad_signature" });
    nothingRecorded();
  }
});
test("TEST-secret payment still refuses a real job at the existing mode guard", async () => {
  source = "website";
  const raw = body();
  expect(await handleStripeWebhook(raw, sign(raw, TEST))).toEqual({ status: 200, outcome: "mode_mismatch" });
  expect(ledger).toHaveLength(0); expect(effects).toHaveLength(0);
});