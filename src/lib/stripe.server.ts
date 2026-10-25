// Stripe Checkout for the $349 safety check and the electrical fixes (decision 144). Rules in stripe.core.ts.
// Keys are env only (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET); switch STRIPE_PAYMENTS_ENABLED=true for real jobs; TEST
// jobs only ever use a test key. Webhook payments are recorded once per PaymentIntent in the append-only ledger and
// then flow through the same payment-step effects as a bank transfer. Xero reconciliation of Stripe payouts is manual
// (Xero's Stripe feed / bank rules) – this never writes payments into Xero. When that reconciled payment reaches the
// invoice it is matched back to the card row (`reconcilePayments`: Stripe id in the Xero Reference, else same amount
// within 10 days), so the money counts once (audit F01).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { checkoutSessionParams, encodeForm, parseStripeEvent, stripeBlocker, stripePaymentKey, verifyStripeSignature, type StripePaymentFact } from "./stripe.core";
import { PAYMENT_EVENT, afterPaymentsChanged, jobPaymentView, rawPaymentLedger, reconciledInvoicePaidCents } from "./payments.server";
import { toCents } from "./payments.core";
import { timeoutSignal } from "./network-timeout.core";

const STRIPE_API = "https://api.stripe.com/v1";
const STRIPE_TIMEOUT_MS = 15_000;

/** Owner "Pay now by card": a Stripe Checkout session for exactly the outstanding amount of the step that is due. */
export async function createStepCheckout(jobId: string, returnUrl: string, actorId: string | null): Promise<{ url: string } | { blocker: string }> {
  const v = await jobPaymentView(jobId);
  if (!v || !v.due.step) return { blocker: "Nothing is due right now." };
  const step = v.due.step;
  const key = process.env["STRIPE_SECRET_KEY"] ?? null;
  const blocker = stripeBlocker({ enabled: process.env["STRIPE_PAYMENTS_ENABLED"] === "true", secretKey: key, jobSource: v.jobSource, step: step.key, amountCents: step.outstandingCents });
  if (blocker) return { blocker };
  const { data: job } = await admin.from("jobs").select("job_number, owners(email)").eq("id", jobId).single();
  const email = (job?.owners as { email: string | null } | null)?.email ?? null;
  const sep = returnUrl.includes("?") ? "&" : "?";
  const { form, idempotencyKey } = checkoutSessionParams({
    jobId, invoiceId: v.invoiceId, step: step.key, amountCents: step.outstandingCents, jobNumber: job?.job_number ?? "", jobSource: v.jobSource,
    description: `Home Insulation Victoria ${job?.job_number ?? ""} – ${step.label}`.trim(),
    successUrl: `${returnUrl}${sep}paid=card`, cancelUrl: `${returnUrl}${sep}paid=cancelled`, customerEmail: email,
  });
  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST", body: encodeForm(form), signal: timeoutSignal(STRIPE_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": idempotencyKey },
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    await logEvent(jobId, actorId, "stripe_checkout_failed", `Card payment page could not be started (Stripe ${res.status})`, { step: step.key, amount_cents: step.outstandingCents, error: text }, { internal: true });
    return { blocker: "The card payment page could not be started. Please try again or pay by bank transfer." };
  }
  const session = (await res.json()) as { id?: string; url?: string };
  if (!session.url) return { blocker: "The card payment page could not be started. Please pay by bank transfer." };
  await logEvent(jobId, actorId, "stripe_checkout_started", `Card payment page opened for ${step.label} (${(step.outstandingCents / 100).toFixed(2)})`, { step: step.key, amount_cents: step.outstandingCents, session_id: session.id ?? null, invoice_id: v.invoiceId }, { internal: true });
  return { url: session.url };
}

/** Webhook body → ledger. Verified, idempotent on the PaymentIntent / event id, mode-checked against the job. */
export async function handleStripeWebhook(rawBody: string, signatureHeader: string | null): Promise<{ status: number; outcome: string }> {
  const ok = await verifyStripeSignature(rawBody, signatureHeader, process.env["STRIPE_WEBHOOK_SECRET"]);
  if (!ok) return { status: 401, outcome: "bad_signature" };
  const ev = parseStripeEvent(rawBody);
  if (!ev) return { status: 400, outcome: "unreadable" };
  if (!ev.fact) return { status: 200, outcome: `ignored:${ev.type}` };
  return { status: 200, outcome: await recordStripePayment(ev.fact) };
}

export async function recordStripePayment(f: StripePaymentFact): Promise<string> {
  const { data: inv } = await admin.from("invoices").select("id, job_id, total_paid, jobs(source, business_unit)").eq("id", f.invoiceId).eq("job_id", f.jobId).maybeSingle();
  if (!inv) return "unknown_invoice";
  const job = inv.jobs as unknown as { source: string | null; business_unit: string | null } | null;
  // A live-mode payment on a TEST job (or vice versa) is never recorded – wrong Stripe account for the job.
  if ((job?.source === "qa_test") !== !f.livemode) {
    await logEvent(inv.job_id, null, "stripe_payment_mode_mismatch", `Stripe ${f.livemode ? "live" : "test"} payment ignored for a ${job?.source === "qa_test" ? "TEST" : "real"} job`, { stripe_event_id: f.eventId, payment_intent: f.paymentIntentId }, { internal: true });
    return "mode_mismatch";
  }
  const key = stripePaymentKey(f);
  // The RAW ledger: a card row already matched to its Xero payment drops out of the reconciled view, but is still recorded.
  const ledger = await rawPaymentLedger(inv.job_id, inv.id);
  if (ledger.some((r) => r.note?.includes(`stripe:${key}`))) return "duplicate";
  await logEvent(inv.job_id, null, PAYMENT_EVENT, `Card payment of $${(f.amountCents / 100).toFixed(2)} received (Stripe, ${f.step.replace("_", " ")})`,
    { invoice_id: inv.id, amount_cents: f.amountCents, source: "card", paid_at: f.paidAt, step: f.step, note: `stripe:${key}`, stripe_event_id: f.eventId, stripe_payment_intent: f.paymentIntentId, stripe_session: f.sessionId }, { internal: true });
  // Gates read invoices.total_paid; Stripe money is real money, so it counts now — until Xero shows the same money
  // (matched by the Stripe id in the Xero payment Reference, else same amount within 10 days; audit F01), never twice.
  const total = await reconciledInvoicePaidCents(inv.job_id, inv.id, { totalPaid: inv.total_paid });
  if (total !== toCents(inv.total_paid)) {
    const { applyPaidAmount } = await import("./xero.server");
    await applyPaidAmount(inv.id, total / 100, null).catch((e) => console.error("stripe paid amount apply skipped", (e as Error).message));
  }
  await afterPaymentsChanged(inv.job_id, inv.id, null);
  return "recorded";
}
