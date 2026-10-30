// Stripe card payments (Jo 24 Oct 2026, decision 144 – overrides 139/140 for these two payments only). Pure, no network.
// Card = Stripe Checkout for (1) the $349 safety check at acceptance and (2) the electrical fixes at approval; the fee
// is absorbed, no surcharge is ever shown (decision 140). The install deposit and the balance stay bank transfer /
// PayID against the Xero invoice (the 10% install deposit may also be paid by card, Jo 29 Oct 2026). Keys live only in env (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET); TEST (qa_test)
// jobs may only ever use a Stripe TEST key; real jobs need a live key AND the STRIPE_PAYMENTS_ENABLED switch.
import type { PaymentStepKey } from "./payments.core";

export type StripeMode = "test" | "live";
export const STRIPE_CARD_STEPS: PaymentStepKey[] = ["safety_check", "fixes", "repeat_safety_check", "install_deposit"];
export const stripeCardAllowed = (step: PaymentStepKey) => STRIPE_CARD_STEPS.includes(step);
export const stripeModeForJob = (jobSource: string | null | undefined): StripeMode => (jobSource === "qa_test" ? "test" : "live");
export const stripeKeyMode = (secretKey: string | null | undefined): StripeMode | null =>
  !secretKey ? null : /^sk_test_|^rk_test_/.test(secretKey) ? "test" : /^sk_live_|^rk_live_/.test(secretKey) ? "live" : null;

/** Why Stripe may not be used right now (null = allowed). Fails closed on every missing piece. */
export function stripeBlocker(f: { enabled: boolean; secretKey: string | null | undefined; jobSource: string | null | undefined; step: PaymentStepKey; amountCents: number }): string | null {
  if (!stripeCardAllowed(f.step)) return "Card payment is only for the safety check, the electrical fixes and the install deposit – the balance is paid by bank transfer or PayID.";
  if (f.amountCents <= 0) return "Nothing is owing on this step.";
  const keyMode = stripeKeyMode(f.secretKey);
  if (!keyMode) return "Card payments are not set up yet (no Stripe key).";
  const mode = stripeModeForJob(f.jobSource);
  if (mode === "test" && keyMode !== "test") return "TEST jobs may only use Stripe test mode.";
  if (mode === "live" && !f.enabled) return "Card payments are switched off (STRIPE_PAYMENTS_ENABLED).";
  if (mode === "live" && keyMode !== "live") return "Real jobs need the live Stripe key.";
  return null;
}

export type CheckoutIntent = { jobId: string; invoiceId: string; step: PaymentStepKey; amountCents: number; jobNumber: string; description: string; successUrl: string; cancelUrl: string; customerEmail: string | null; jobSource: string | null };
/** Form-encoded Stripe Checkout Session body + idempotency key. Amount is exactly the step's outstanding amount in AUD cents. */
export function checkoutSessionParams(i: CheckoutIntent): { form: Record<string, string>; idempotencyKey: string } {
  const form: Record<string, string> = {
    mode: "payment",
    "payment_method_types[0]": "card",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "aud",
    "line_items[0][price_data][unit_amount]": String(i.amountCents),
    "line_items[0][price_data][product_data][name]": i.description,
    success_url: i.successUrl,
    cancel_url: i.cancelUrl,
    client_reference_id: `${i.jobId}:${i.step}`,
    "metadata[job_id]": i.jobId,
    "metadata[invoice_id]": i.invoiceId,
    "metadata[step]": i.step,
    "metadata[job_number]": i.jobNumber,
    "metadata[job_source]": i.jobSource ?? "",
    "payment_intent_data[metadata][job_id]": i.jobId,
    "payment_intent_data[metadata][invoice_id]": i.invoiceId,
    "payment_intent_data[metadata][step]": i.step,
    "payment_intent_data[description]": i.description,
  };
  if (i.customerEmail) form["customer_email"] = i.customerEmail;
  // Same job + invoice + step + amount → same session (safe double-click); a new amount or another invoice (batch 3b:
  // a replaced fixes invoice, a second repeat safety check) is a new session.
  return { form, idempotencyKey: `hivic-checkout-${i.jobId}-${i.invoiceId}-${i.step}-${i.amountCents}` };
}
export const encodeForm = (form: Record<string, string>) => Object.entries(form).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

// ---------- Webhook (Stripe-Signature: t=<unix>,v1=<hex hmac of "<t>.<raw body>">) ----------
export const STRIPE_SIGNATURE_HEADER = "stripe-signature";
export const STRIPE_SIGNATURE_TOLERANCE_S = 300;

export function parseStripeSignature(header: string | null | undefined): { t: number; v1: string[] } | null {
  if (!header) return null;
  let t = NaN; const v1: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === "t" && v) t = Number(v);
    if (k === "v1" && v) v1.push(v);
  }
  return Number.isFinite(t) && v1.length ? { t, v1 } : null;
}
async function hmacHex(secret: string, payload: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(payload)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const constantTimeEqual = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

/** True only with a configured secret, a well-formed header, a fresh timestamp (±5 min) and a matching v1 signature. */
export async function verifyStripeSignature(rawBody: string, header: string | null | undefined, secret: string | null | undefined, nowMs = Date.now()): Promise<boolean> {
  if (!secret) return false;
  const p = parseStripeSignature(header);
  if (!p) return false;
  if (Math.abs(nowMs / 1000 - p.t) > STRIPE_SIGNATURE_TOLERANCE_S) return false;
  const expected = await hmacHex(secret, `${p.t}.${rawBody}`);
  return p.v1.some((s) => constantTimeEqual(s.toLowerCase(), expected));
}

export type StripePaymentFact = { eventId: string; livemode: boolean; jobId: string; invoiceId: string; step: PaymentStepKey; amountCents: number; paidAt: string; paymentIntentId: string | null; sessionId: string | null; email: string | null;
  /** The charge (`latest_charge`) when the event carries it — Xero's Stripe feed may reference the charge, not the PaymentIntent (audit R02). */
  chargeId?: string | null };
/** `charge.refunded` (audit R02): Stripe's CUMULATIVE refunded amount for one PaymentIntent. The charge carries no job
 *  metadata, so the card row is found by its PaymentIntent. */
export type StripeRefundFact = { eventId: string; livemode: boolean; paymentIntentId: string; chargeId: string | null; refundedCents: number; refundedAt: string };

/** A succeeded payment with our metadata → one payment fact; a refunded charge → one refund fact. Other events (or
 *  missing metadata) → null. */
export function parseStripeEvent(rawBody: string): { eventId: string; type: string; fact: StripePaymentFact | null; refund?: StripeRefundFact | null } | null {
  let ev: Record<string, unknown>;
  try { ev = JSON.parse(rawBody); } catch { return null; }
  const eventId = typeof ev?.["id"] === "string" ? (ev["id"] as string) : null;
  const type = typeof ev?.["type"] === "string" ? (ev["type"] as string) : "";
  if (!eventId) return null;
  const obj = ((ev["data"] as { object?: Record<string, unknown> } | undefined)?.object ?? {}) as Record<string, unknown>;
  const meta = (obj["metadata"] ?? {}) as Record<string, unknown>;
  const livemode = ev["livemode"] === true;
  const created = typeof ev["created"] === "number" ? new Date((ev["created"] as number) * 1000).toISOString() : new Date(0).toISOString();
  const s = (v: unknown) => (typeof v === "string" && v ? v : null);
  const step = s(meta["step"]) as PaymentStepKey | null;
  let fact: StripePaymentFact | null = null;
  if (type === "checkout.session.completed" && obj["payment_status"] === "paid") {
    const amountCents = Number(obj["amount_total"] ?? 0);
    const jobId = s(meta["job_id"]), invoiceId = s(meta["invoice_id"]);
    if (jobId && invoiceId && step && stripeCardAllowed(step) && amountCents > 0)
      fact = { eventId, livemode, jobId, invoiceId, step, amountCents, paidAt: created, paymentIntentId: s(obj["payment_intent"]), sessionId: s(obj["id"]), email: s((obj["customer_details"] as Record<string, unknown> | undefined)?.["email"]) ?? s(obj["customer_email"]) };
  } else if (type === "payment_intent.succeeded") {
    const amountCents = Number(obj["amount_received"] ?? 0);
    const jobId = s(meta["job_id"]), invoiceId = s(meta["invoice_id"]);
    if (jobId && invoiceId && step && stripeCardAllowed(step) && amountCents > 0)
      fact = { eventId, livemode, jobId, invoiceId, step, amountCents, paidAt: created, paymentIntentId: s(obj["id"]), sessionId: null, email: s(obj["receipt_email"]), chargeId: s(obj["latest_charge"]) };
  } else if (type === "charge.refunded") {
    const pi = s(obj["payment_intent"]);
    const refundedCents = Math.round(Number(obj["amount_refunded"] ?? 0));
    if (pi && Number.isFinite(refundedCents) && refundedCents > 0)
      return { eventId, type, fact: null, refund: { eventId, livemode, paymentIntentId: pi, chargeId: s(obj["id"]), refundedCents, refundedAt: created } };
  }
  return { eventId, type, fact };
}

/** Dedupe key: the PaymentIntent (both event types describe the same money), else the event id. */
export const stripePaymentKey = (f: StripePaymentFact) => f.paymentIntentId ?? f.eventId;
