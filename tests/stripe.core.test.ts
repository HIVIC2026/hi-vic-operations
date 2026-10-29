// Stripe rules (decision 144): mode guards, checkout params, webhook signature + event parsing. Pure. Run: bun test tests/stripe.core.test.ts
import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  STRIPE_SIGNATURE_HEADER, checkoutSessionParams, encodeForm, parseStripeEvent, parseStripeSignature, stripeBlocker, stripeCardAllowed, stripeKeyMode,
  stripeModeForJob, stripePaymentKey, verifyStripeSignature,
} from "../src/lib/stripe.core";

const SECRET = "whsec_test_not_real";
const sign = (t: number, body: string, secret = SECRET) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex")}`;

describe("who may use card (Stripe) – fails closed", () => {
  test("card only for the safety check, the fixes and the install deposit", () => {
    expect(stripeCardAllowed("safety_check")).toBe(true);
    expect(stripeCardAllowed("fixes")).toBe(true);
    expect(stripeCardAllowed("install_deposit")).toBe(true);
    expect(stripeCardAllowed("balance")).toBe(false);
    expect(stripeBlocker({ enabled: true, secretKey: "sk_live_x", jobSource: null, step: "balance", amountCents: 100 })).toMatch(/bank transfer or PayID/);
  });
  test("TEST jobs need a test key; real jobs need the switch AND a live key; no key = blocked", () => {
    expect(stripeModeForJob("qa_test")).toBe("test");
    expect(stripeModeForJob("website")).toBe("live");
    expect(stripeKeyMode("sk_test_abc")).toBe("test");
    expect(stripeKeyMode("rk_live_abc")).toBe("live");
    expect(stripeKeyMode("garbage")).toBeNull();
    const base = { step: "safety_check" as const, amountCents: 34_900 };
    expect(stripeBlocker({ ...base, enabled: false, secretKey: undefined, jobSource: "qa_test" })).toMatch(/no Stripe key/);
    expect(stripeBlocker({ ...base, enabled: false, secretKey: "sk_test_a", jobSource: "qa_test" })).toBeNull(); // test mode needs no switch
    expect(stripeBlocker({ ...base, enabled: true, secretKey: "sk_live_a", jobSource: "qa_test" })).toMatch(/test mode/);
    expect(stripeBlocker({ ...base, enabled: false, secretKey: "sk_live_a", jobSource: "website" })).toMatch(/switched off/);
    expect(stripeBlocker({ ...base, enabled: true, secretKey: "sk_test_a", jobSource: "website" })).toMatch(/live Stripe key/);
    expect(stripeBlocker({ ...base, enabled: true, secretKey: "sk_live_a", jobSource: "website" })).toBeNull();
    expect(stripeBlocker({ ...base, amountCents: 0, enabled: true, secretKey: "sk_live_a", jobSource: "website" })).toMatch(/Nothing is owing/);
  });
});

describe("checkout session", () => {
  test("exact step amount in AUD cents, our metadata on session and payment intent, stable idempotency key", () => {
    const i = { jobId: "job-1", invoiceId: "inv-1", step: "fixes" as const, amountCents: 45_000, jobNumber: "HV-0042", description: "Home Insulation Victoria HV-0042 – Electrical fixes", successUrl: "https://x/my-job/t?paid=card", cancelUrl: "https://x/my-job/t?paid=cancelled", customerEmail: "o@example.com", jobSource: "qa_test" };
    const { form, idempotencyKey } = checkoutSessionParams(i);
    expect(form["mode"]).toBe("payment");
    expect(form["line_items[0][price_data][currency]"]).toBe("aud");
    expect(form["line_items[0][price_data][unit_amount]"]).toBe("45000");
    expect(form["metadata[step]"]).toBe("fixes");
    expect(form["payment_intent_data[metadata][invoice_id]"]).toBe("inv-1");
    expect(form["customer_email"]).toBe("o@example.com");
    expect(idempotencyKey).toBe("hivic-checkout-job-1-fixes-45000");
    expect(checkoutSessionParams(i).idempotencyKey).toBe(idempotencyKey);
    expect(encodeForm({ "a[b]": "x y", c: "1" })).toBe("a%5Bb%5D=x%20y&c=1");
    expect(Object.keys(form).some((k) => /fee|surcharge/i.test(k))).toBe(false);
  });
});

const EVENT = (over: Record<string, unknown> = {}) => JSON.stringify({
  id: "evt_1", type: "checkout.session.completed", livemode: false, created: 1761300000,
  data: { object: { id: "cs_1", object: "checkout.session", payment_status: "paid", amount_total: 34900, currency: "aud", payment_intent: "pi_1", customer_details: { email: "o@example.com" }, metadata: { job_id: "job-1", invoice_id: "inv-1", step: "safety_check", job_number: "HV-1" }, ...over } },
});

describe("webhook signature", () => {
  const body = EVENT();
  const now = 1761300000_000;
  test("valid v1 within tolerance passes; wrong secret, stale timestamp, tampered body, missing header/secret fail", async () => {
    expect(STRIPE_SIGNATURE_HEADER).toBe("stripe-signature");
    expect(await verifyStripeSignature(body, sign(1761300000, body), SECRET, now)).toBe(true);
    expect(await verifyStripeSignature(body, sign(1761300000, body, "other"), SECRET, now)).toBe(false);
    expect(await verifyStripeSignature(body, sign(1761300000 - 301, body), SECRET, now)).toBe(false);
    expect(await verifyStripeSignature(body + " ", sign(1761300000, body), SECRET, now)).toBe(false);
    expect(await verifyStripeSignature(body, null, SECRET, now)).toBe(false);
    expect(await verifyStripeSignature(body, sign(1761300000, body), undefined, now)).toBe(false);
    expect(await verifyStripeSignature(body, "t=abc,v1=zz", SECRET, now)).toBe(false);
  });
  test("multiple v1 signatures (secret rotation) – any match passes", async () => {
    const h = `${sign(1761300000, body, "old")},v1=${createHmac("sha256", SECRET).update(`1761300000.${body}`).digest("hex")}`;
    expect(parseStripeSignature(h)?.v1.length).toBe(2);
    expect(await verifyStripeSignature(body, h, SECRET, now)).toBe(true);
  });
});

describe("webhook events → payment facts (idempotent)", () => {
  test("checkout.session.completed (paid) with our metadata → fact keyed by the PaymentIntent", () => {
    const r = parseStripeEvent(EVENT());
    expect(r?.fact).toMatchObject({ eventId: "evt_1", livemode: false, jobId: "job-1", invoiceId: "inv-1", step: "safety_check", amountCents: 34_900, paymentIntentId: "pi_1", sessionId: "cs_1", email: "o@example.com" });
    expect(r!.fact!.paidAt).toBe(new Date(1761300000 * 1000).toISOString());
    expect(stripePaymentKey(r!.fact!)).toBe("pi_1");
  });
  test("payment_intent.succeeded is the same money (same key); unpaid, other types, missing metadata and disallowed steps are ignored", () => {
    const pi = JSON.stringify({ id: "evt_2", type: "payment_intent.succeeded", livemode: false, created: 1761300001, data: { object: { id: "pi_1", amount_received: 34900, receipt_email: "o@example.com", metadata: { job_id: "job-1", invoice_id: "inv-1", step: "safety_check" } } } });
    const f = parseStripeEvent(pi)!.fact!;
    expect(stripePaymentKey(f)).toBe("pi_1");
    expect(parseStripeEvent(EVENT({ payment_status: "unpaid" }))?.fact).toBeNull();
    expect(parseStripeEvent(EVENT({ metadata: { job_id: "job-1" } }))?.fact).toBeNull();
    expect(parseStripeEvent(EVENT({ metadata: { job_id: "job-1", invoice_id: "inv-1", step: "balance" } }))?.fact).toBeNull();
    expect(parseStripeEvent(JSON.stringify({ id: "evt_3", type: "charge.refunded", data: { object: {} } }))).toMatchObject({ eventId: "evt_3", fact: null });
    expect(parseStripeEvent("nope")).toBeNull();
    expect(parseStripeEvent(JSON.stringify({ type: "x" }))).toBeNull();
  });
  test("audit R02: payment_intent.succeeded carries the charge id; charge.refunded → cumulative refund fact by PaymentIntent", () => {
    const pi = JSON.stringify({ id: "evt_2", type: "payment_intent.succeeded", livemode: false, created: 1761300001, data: { object: { id: "pi_1", amount_received: 34900, latest_charge: "ch_1", metadata: { job_id: "job-1", invoice_id: "inv-1", step: "safety_check" } } } });
    expect(parseStripeEvent(pi)!.fact!.chargeId).toBe("ch_1");
    const rf = parseStripeEvent(JSON.stringify({ id: "evt_4", type: "charge.refunded", livemode: true, created: 1761300100, data: { object: { id: "ch_1", payment_intent: "pi_1", amount_refunded: 10000 } } }));
    expect(rf?.fact).toBeNull();
    expect(rf?.refund).toEqual({ eventId: "evt_4", livemode: true, paymentIntentId: "pi_1", chargeId: "ch_1", refundedCents: 10_000, refundedAt: new Date(1761300100 * 1000).toISOString() });
    expect(parseStripeEvent(JSON.stringify({ id: "evt_5", type: "charge.refunded", data: { object: { id: "ch_1", payment_intent: "pi_1", amount_refunded: 0 } } }))?.refund).toBeUndefined();
  });
});
