// Stripe Checkout for the card steps (decision 144). Rules in stripe.core.ts. Batch 3b: each checkout carries the due
// step's OWN invoice (installation, fixes or repeat safety check), so the card money lands on that invoice only.
// Keys are env only (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET); switch STRIPE_PAYMENTS_ENABLED=true for real jobs; TEST
// jobs only ever use a test key. Webhook payments are recorded once per PaymentIntent in the append-only ledger and
// then flow through the same payment-step effects as a bank transfer. Xero reconciliation of Stripe payouts is manual
// (Xero's Stripe feed / bank rules) – this never writes payments into Xero. When that reconciled payment reaches the
// invoice it is matched back to the card row by the Stripe id (PaymentIntent / charge) in the Xero Reference, so the money
// counts once (audit F01); a same-amount Xero payment WITHOUT that id is never assumed to be the card money — both count
// and the office is asked (audit R02). One receipt = one ledger row even under concurrent deliveries: the row's
// `receipt_key` is unique in the database (audit R06, pending payment-receipt-once.sql) and a 23505 reads as "duplicate".
// A `charge.refunded` lowers the card row by Stripe's cumulative refunded amount, once per refund state.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { checkoutSessionParams, encodeForm, parseStripeEvent, stripeBlocker, stripePaymentKey, verifyStripeSignature, type StripePaymentFact } from "./stripe.core";
import { PAYMENT_EVENT, PAYMENT_REVERSED_EVENT, afterPaymentsChanged, flagUnclearPaymentMatches, insertLedgerEvent, jobPaymentView, rawPaymentLedger, reconciledInvoicePaidCents, stepInvoice } from "./payments.server";
import { stripeReceiptKey, stripeRefundReceiptKey, stripeRefundedSoFarCents, toCents } from "./payments.core";
import type { StripeRefundFact } from "./stripe.core";
import { timeoutSignal } from "./network-timeout.core";

const STRIPE_API = "https://api.stripe.com/v1";
const STRIPE_TIMEOUT_MS = 15_000;

/** Jo 28 Oct: TEST jobs use only STRIPE_TEST_SECRET_KEY (must be an sk_test_ key); real jobs only STRIPE_SECRET_KEY. */
export function stripeKeyFor(jobSource: string | null | undefined): string | null {
  if (jobSource === "qa_test") { const k = process.env["STRIPE_TEST_SECRET_KEY"] ?? null; return k && k.startsWith("sk_test_") ? k : null; }
  return process.env["STRIPE_SECRET_KEY"] ?? null;
}

/** Owner "Pay now by card": a Stripe Checkout session for exactly the outstanding amount of the step that is due, on that
 *  step's own invoice. */
export async function createStepCheckout(jobId: string, returnUrl: string, actorId: string | null): Promise<{ url: string } | { blocker: string }> {
  const v = await jobPaymentView(jobId);
  if (!v || !v.due.step) return { blocker: "Nothing is due right now." };
  const step = v.due.step;
  const invoiceId = stepInvoice(v, step.key)?.id ?? null;
  if (!invoiceId) return { blocker: "The card payment page could not be started. Please pay by bank transfer." };
  const key = stripeKeyFor(v.jobSource);
  const blocker = stripeBlocker({ enabled: process.env["STRIPE_PAYMENTS_ENABLED"] === "true", secretKey: key, jobSource: v.jobSource, step: step.key, amountCents: step.outstandingCents });
  if (blocker) return { blocker };
  const { data: job } = await admin.from("jobs").select("job_number, owners(email)").eq("id", jobId).single();
  const email = (job?.owners as { email: string | null } | null)?.email ?? null;
  const sep = returnUrl.includes("?") ? "&" : "?";
  const { form, idempotencyKey } = checkoutSessionParams({
    jobId, invoiceId, step: step.key, amountCents: step.outstandingCents, jobNumber: job?.job_number ?? "", jobSource: v.jobSource,
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
  await logEvent(jobId, actorId, "stripe_checkout_started", `Card payment page opened for ${step.label} (${(step.outstandingCents / 100).toFixed(2)})`, { step: step.key, amount_cents: step.outstandingCents, session_id: session.id ?? null, invoice_id: invoiceId }, { internal: true });
  return { url: session.url };
}

/** Webhook body → ledger. Verified, idempotent on the PaymentIntent / event id, mode-checked against the job. */
export async function handleStripeWebhook(rawBody: string, signatureHeader: string | null): Promise<{ status: number; outcome: string }> {
  let ok = await verifyStripeSignature(rawBody, signatureHeader, process.env["STRIPE_WEBHOOK_SECRET"]);
  if (!ok && await verifyStripeSignature(rawBody, signatureHeader, process.env["STRIPE_TEST_WEBHOOK_SECRET"])) {
    // Trust mode only after authenticating the unchanged raw body. The optional TEST secret
    // must never authorise live events (or absent/non-boolean modes, even on ignored events).
    try { ok = (JSON.parse(rawBody) as { livemode?: unknown } | null)?.livemode === false; }
    catch { return { status: 400, outcome: "unreadable" }; }
  }
  if (!ok) return { status: 400, outcome: "bad_signature" };
  const ev = parseStripeEvent(rawBody);
  if (!ev) return { status: 400, outcome: "unreadable" };
  if (!ev.refund && !ev.fact) return { status: 200, outcome: `ignored:${ev.type}` };
  // Launch fix (QA 7 Nov): a read error or a half-applied payment answers 500 so Stripe retries; never 200 and lost.
  try {
    const outcome = ev.refund ? await recordStripeRefund(ev.refund) : await recordStripePayment(ev.fact!);
    return RETRYABLE_OUTCOMES.has(outcome) ? { status: 500, outcome: `retry:${outcome}` } : { status: 200, outcome };
  } catch (e) {
    // The detail (it can be database error text) goes to the server log only, never into the outcome.
    console.error("stripe webhook will be retried", (e as Error).message);
    return { status: 500, outcome: "retry:error" };
  }
}

/** A refund whose card payment is not recorded yet: Stripe retries it (for about 3 days) until the payment lands. */
const RETRYABLE_OUTCOMES = new Set(["unknown_payment"]);

/** Audit R02: the charge id of a PaymentIntent (Xero's Stripe feed may reference the charge). Read-only, best-effort:
 *  no key, a mode mismatch or any failure → null (the PaymentIntent id still identifies the receipt). */
async function stripeChargeFor(paymentIntentId: string, livemode: boolean): Promise<string | null> {
  const key = livemode ? process.env["STRIPE_SECRET_KEY"] ?? null : process.env["STRIPE_TEST_SECRET_KEY"] ?? process.env["STRIPE_SECRET_KEY"] ?? null;
  const { stripeKeyMode } = await import("./stripe.core");
  if (!key || stripeKeyMode(key) !== (livemode ? "live" : "test")) return null;
  try {
    const res = await fetch(`${STRIPE_API}/payment_intents/${encodeURIComponent(paymentIntentId)}`, { headers: { Authorization: `Bearer ${key}` }, signal: timeoutSignal(STRIPE_TIMEOUT_MS) });
    if (!res.ok) return null;
    const pi = (await res.json()) as { latest_charge?: unknown };
    return typeof pi.latest_charge === "string" && pi.latest_charge ? pi.latest_charge : null;
  } catch { return null; }
}

export async function recordStripePayment(f: StripePaymentFact): Promise<string> {
  const { data: inv, error: invError } = await admin.from("invoices").select("id, job_id, kind, total_paid, jobs(source, business_unit)").eq("id", f.invoiceId).eq("job_id", f.jobId).maybeSingle();
  if (invError) throw new Error(`invoice read failed: ${invError.message}`);
  if (!inv) return "unknown_invoice";
  const job = inv.jobs as unknown as { source: string | null; business_unit: string | null } | null;
  // A live-mode payment on a TEST job (or vice versa) is never recorded – wrong Stripe account for the job.
  if ((job?.source === "qa_test") !== !f.livemode) {
    await logEvent(inv.job_id, null, "stripe_payment_mode_mismatch", `Stripe ${f.livemode ? "live" : "test"} payment ignored for a ${job?.source === "qa_test" ? "TEST" : "real"} job`, { stripe_event_id: f.eventId, payment_intent: f.paymentIntentId }, { internal: true });
    return "mode_mismatch";
  }
  const key = stripePaymentKey(f);
  // The RAW ledger: a card row already matched to its Xero payment drops out of the reconciled view, but is still recorded.
  // Fast path only — the unique receipt_key below is what makes two concurrent deliveries record ONE row (audit R06).
  const ledger = await rawPaymentLedger(inv.job_id, inv.id);
  // Already recorded: still finish the follow-up steps (safe to repeat — it reads the reconciled total), so a delivery
  // that failed after saving the receipt is completed by Stripe's retry instead of being skipped.
  if (ledger.some((r) => r.note?.includes(`stripe:${key}`))) { await applyAfterStripeChange(inv); return "duplicate"; }
  const charge = f.chargeId ?? (f.paymentIntentId ? await stripeChargeFor(f.paymentIntentId, f.livemode) : null);
  const outcome = await insertLedgerEvent(inv.job_id, null, PAYMENT_EVENT, `Card payment of $${(f.amountCents / 100).toFixed(2)} received (Stripe, ${f.step.replace("_", " ")})`,
    { invoice_id: inv.id, amount_cents: f.amountCents, source: "card", paid_at: f.paidAt, step: f.step, note: `stripe:${key}`, stripe_event_id: f.eventId, stripe_payment_intent: f.paymentIntentId, stripe_session: f.sessionId, stripe_charge: charge, receipt_key: stripeReceiptKey(key) });
  // Lost the race to a concurrent delivery of the same receipt: the row is recorded once and the winner is running the
  // follow-up right now — running it again at the same moment would race its once-only emails. If the winner fails, its
  // 500 makes Stripe retry it, and that retry finishes the follow-up through the fast path above.
  if (outcome === "duplicate") return "duplicate";
  // Gates read invoices.total_paid; Stripe money is real money, so it counts now — until Xero shows the same money
  // (matched by the Stripe id in the Xero payment Reference; audit F01/R02), never twice.
  await flagUnclearPaymentMatches(inv.job_id, inv.id).catch((e) => console.error("payment match check skipped", (e as Error).message));
  return applyAfterStripeChange(inv);
}

async function applyAfterStripeChange(inv: { id: string; job_id: string; kind: string; total_paid: number | string | null }): Promise<"recorded"> {
  const total = await reconciledInvoicePaidCents(inv.job_id, inv.id, { totalPaid: inv.total_paid });
  if (total !== toCents(inv.total_paid)) {
    const { applyPaidAmount } = await import("./xero.server");
    await applyPaidAmount(inv.id, total / 100, null).catch((e) => console.error("stripe paid amount apply skipped", (e as Error).message));
  }
  // Batch 3b: a card payment on the repeat safety check's own invoice → that invoice's paid amount decides it.
  if (inv.kind === "repeat_safety_check") await (await import("./repeat-piesa.server")).repeatPaidByCard(inv.job_id, inv.id, total)
    .catch((e) => console.error("repeat PIESA card check skipped", (e as Error).message));
  await afterPaymentsChanged(inv.job_id, inv.id, null);
  return "recorded";
}

/** Audit R02: `charge.refunded` → ONE `owner_payment_reversed` row (source card) per cumulative refunded amount of the
 *  PaymentIntent, for the part not yet recorded. Repeat or concurrent deliveries of the same refund state write nothing
 *  (unique receipt_key). The card row is found by its PaymentIntent; an unknown one is ignored. */
export async function recordStripeRefund(r: StripeRefundFact): Promise<string> {
  const { data: rows, error: rowsError } = await admin.from("workflow_events").select("job_id, details").eq("event_type", PAYMENT_EVENT).contains("details", { stripe_payment_intent: r.paymentIntentId }).limit(1);
  if (rowsError) throw new Error(`card payment lookup failed: ${rowsError.message}`);
  const row = ((rows ?? []) as { job_id: string | null; details: Record<string, unknown> | null }[])[0];
  const invoiceId = typeof row?.details?.["invoice_id"] === "string" ? (row.details["invoice_id"] as string) : null;
  if (!row?.job_id || !invoiceId) { await noteUnknownRefund(r); return "unknown_payment"; }
  const { data: inv, error: invError } = await admin.from("invoices").select("id, job_id, kind, total_paid, jobs(source)").eq("id", invoiceId).eq("job_id", row.job_id).maybeSingle();
  if (invError) throw new Error(`invoice read failed: ${invError.message}`);
  if (!inv) return "unknown_invoice";
  const job = inv.jobs as unknown as { source: string | null } | null;
  if ((job?.source === "qa_test") !== !r.livemode) return "mode_mismatch";
  const paid = Number(row.details?.["amount_cents"] ?? 0);
  const target = Math.min(r.refundedCents, Math.max(0, paid));
  const ledger = await rawPaymentLedger(inv.job_id, inv.id);
  const delta = target - stripeRefundedSoFarCents(ledger, r.paymentIntentId);
  if (delta <= 0) return "duplicate";
  const outcome = await insertLedgerEvent(inv.job_id, null, PAYMENT_REVERSED_EVENT, `Card payment refunded in Stripe: $${(delta / 100).toFixed(2)} no longer counted`,
    { invoice_id: inv.id, amount_cents: delta, source: "card", paid_at: r.refundedAt, note: `stripe-refund:${r.paymentIntentId}`, stripe_payment_intent: r.paymentIntentId, stripe_charge: r.chargeId, stripe_event_id: r.eventId, refunded_total_cents: target, receipt_key: stripeRefundReceiptKey(r.paymentIntentId, target) });
  if (outcome === "duplicate") return "duplicate";
  // Part 9 Task 11 (Review Focus 4): a refund that lands after VEECs were created can't be stopped — tell the office at
  // once (one event per recorded reversal; a duplicate delivery returned above and raises nothing).
  // G6 S9: the shared flag (veec-refund-flag.server) — a failed VEEC read raises the check-failed office line, never silence.
  await import("./veec-refund-flag.server").then((m) => m.flagRefundAfterVeecCreation(inv.job_id, { refundedCents: delta, source: "card", paymentIntentId: r.paymentIntentId, stripeEventId: r.eventId }));
  return applyAfterStripeChange(inv);
}

/** A refund for a card payment not recorded (yet): one internal, job-less note per Stripe event (admin_config_events,
 *  because workflow_events needs a job), however often Stripe retries it. Best-effort: a failed note never hides the retry. */
async function noteUnknownRefund(r: StripeRefundFact): Promise<void> {
  try {
    const { data: prior, error } = await admin.from("admin_config_events").select("id").eq("event_type", "stripe_refund_unmatched").contains("details", { stripe_event_id: r.eventId }).limit(1);
    if (error || (prior ?? []).length > 0) return;
    await admin.from("admin_config_events").insert({ actor_id: null, event_type: "stripe_refund_unmatched", summary: `Stripe refund for ${r.paymentIntentId} has no recorded card payment yet – Stripe will retry`,
      details: { stripe_event_id: r.eventId, stripe_payment_intent: r.paymentIntentId, stripe_charge: r.chargeId, refunded_cents: r.refundedCents } });
  } catch (e) { console.error("unmatched Stripe refund note skipped", (e as Error).message); }
}
