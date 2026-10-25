// Owner payments against the ONE Xero invoice (decisions 139/140/141). Rules live in payments.core.ts.
// Ledger: append-only `owner_payment_recorded` workflow events (one per Xero PaymentID / Stripe PaymentIntent; old office
// records stay as history) plus `owner_payment_reversed` rows for Xero payments later deleted/voided — the project's
// existing immutable event log, so no new table and no live schema change. Xero is the system of record; the amount
// received is `reconciledPaidCents` (Xero's live payments + card records not yet matched in Xero, audit F01), and
// invoices.total_paid follows it down as well as up.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent, paymentGateActiveForJob } from "./workflow.server";
import {
  HIV_BANK_DETAILS, type BankDetails, type PaymentRecord, type PaymentSource, type PaymentStepFacts, type PaymentStepKey, type XeroPaymentInput,
  cumulativePaidCents, effectiveLedger, isStepCleared, isStepPaid, ledgerRecordFromEvent, ledgerXeroPayments, newXeroPayments, payNowBlock, payableNow, paymentPlan, paymentSteps,
  provisionalBookingDecision, provisionalHoldExpiresAt, reconciledPaidCents, toCents, xeroPaymentFacts, xeroReversals,
} from "./payments.core";

export const PAYMENT_EVENT = "owner_payment_recorded";
/** Audit F01: a recorded Xero payment that Xero later shows DELETED/VOIDED (or no longer lists). One per PaymentID. */
export const PAYMENT_REVERSED_EVENT = "owner_payment_reversed";
/** Owner notice when an unpaid provisional booking is released: approved by Jo 24 Oct 2026 (decision 170; wording in deposit-release-notice.core.ts). */
export { PROVISIONAL_RELEASE_OWNER_NOTICE_APPROVED } from "./deposit-release-notice.core";

/** Bank details for owner pages/emails: Jo's NAB account (decision 152), env vars override. */
export function bankDetails(): BankDetails {
  const bsb = process.env["HIV_BANK_BSB"]?.trim() || HIV_BANK_DETAILS.bsb;
  const accountNumber = process.env["HIV_BANK_ACCOUNT_NUMBER"]?.trim() || HIV_BANK_DETAILS.accountNumber;
  const payId = process.env["HIV_PAYID"]?.trim() || HIV_BANK_DETAILS.payId;
  const accountName = process.env["HIV_BANK_ACCOUNT_NAME"]?.trim() || HIV_BANK_DETAILS.accountName;
  return { accountName, bsb, accountNumber, payId, configured: !!((bsb && accountNumber) || payId) };
}

type LedgerRow = { id: string; event_type: string; created_at: string; actor_id: string | null; details: Record<string, unknown> };
/** Every payment + reversal row for the invoice, as recorded (append-only). Use `paymentLedger` for money received. */
export async function rawPaymentLedger(jobId: string, invoiceId?: string): Promise<(PaymentRecord & { id: string; createdAt: string })[]> {
  const { data } = await admin.from("workflow_events").select("id, event_type, created_at, actor_id, details").eq("job_id", jobId).in("event_type", [PAYMENT_EVENT, PAYMENT_REVERSED_EVENT]).order("created_at");
  return ((data ?? []) as unknown as LedgerRow[])
    .filter((r) => !invoiceId || r.details["invoice_id"] === invoiceId)
    .map((r) => ({ id: r.id, createdAt: r.created_at, ...ledgerRecordFromEvent(r.event_type, r.created_at, r.actor_id, r.details) }));
}
/** Money actually received (audit F01): live Xero payments + card/office records not yet matched in Xero — no reversed
 *  or duplicated rows, so cumulativePaidCents(paymentLedger(...)) is the reconciled amount. */
export async function paymentLedger(jobId: string, invoiceId?: string) {
  return effectiveLedger(await rawPaymentLedger(jobId, invoiceId));
}

/** Xero → ledger, from the invoice's FULL Payments list. One record per PaymentID (with its Reference); a recorded
 *  payment that Xero now shows DELETED/VOIDED or no longer lists gets ONE `owner_payment_reversed` row. Re-running with
 *  the same Xero payments records nothing. Returns how many rows were written; the caller re-applies the paid amount. */
export async function recordXeroPayments(invoiceId: string, jobId: string, xeroPayments: XeroPaymentInput[], actorId: string | null, opts: { fullList?: boolean } = {}) {
  const raw = await rawPaymentLedger(jobId, invoiceId);
  const known = raw.filter((r) => r.kind !== "reversal").map((r) => r.xeroPaymentId).filter((x): x is string => !!x);
  const fresh = newXeroPayments(known, xeroPayments);
  for (const p of fresh) {
    await logEvent(jobId, actorId, PAYMENT_EVENT, `Payment of $${(p.amountCents / 100).toFixed(2)} received in Xero`, { invoice_id: invoiceId, amount_cents: p.amountCents, source: "xero", paid_at: p.paidAt, xero_payment_id: p.xeroPaymentId, xero_reference: p.reference }, { internal: true });
  }
  const gone = opts.fullList === false ? [] : xeroReversals(raw, xeroPayments);
  for (const p of gone) {
    await logEvent(jobId, actorId, PAYMENT_REVERSED_EVENT, `Xero payment of $${(p.amountCents / 100).toFixed(2)} was deleted or voided in Xero – no longer counted`, { invoice_id: invoiceId, amount_cents: p.amountCents, source: "xero", paid_at: p.paidAt, xero_payment_id: p.xeroPaymentId }, { internal: true });
  }
  return fresh.length + gone.length;
}

/** The reconciled amount for an invoice in cents (audit F01; replaces max(total_paid, ledger)). With `xeroPayments` (the
 *  invoice's Payments list from Xero) the card/office rows are matched against that; without, against the ledger's own
 *  Xero rows. When the ledger holds no Xero rows at all (an invoice paid before the ledger existed), Xero's mirrored
 *  total_paid still counts — once, never added on top. */
export async function reconciledInvoicePaidCents(jobId: string, invoiceId: string, opts: { xeroPayments?: XeroPaymentInput[] | null; xeroAmountPaid?: number | null; totalPaid?: number | string | null } = {}) {
  const raw = await rawPaymentLedger(jobId, invoiceId);
  if (opts.xeroPayments) {
    const facts = xeroPaymentFacts(opts.xeroPayments);
    // Xero reports money paid but listed no payments: count Xero's own total once.
    if (reconciledPaidCents([], facts) === 0 && toCents(opts.xeroAmountPaid ?? 0) > 0)
      facts.push({ paymentId: null, amountCents: toCents(opts.xeroAmountPaid ?? 0), paidAt: new Date().toISOString(), reference: null, status: null });
    return reconciledPaidCents(raw, facts);
  }
  const fromLedger = reconciledPaidCents(raw, ledgerXeroPayments(raw));
  return raw.some((r) => r.source === "xero") ? fromLedger : Math.max(fromLedger, toCents(opts.totalPaid ?? 0));
}

/** Office "Record payment": a bank transfer / card payment the office has confirmed (statement or Xero) before the sync shows it. */
export async function recordManualPayment(i: { invoiceId: string; amountCents: number; source: Exclude<PaymentSource, "xero">; paidAt: string; note: string | null; actorId: string }) {
  if (!Number.isInteger(i.amountCents) || i.amountCents <= 0) throw new Error("Amount must be a positive amount.");
  const { data: inv } = await admin.from("invoices").select("id, job_id, total_inc_gst, total_paid").eq("id", i.invoiceId).single();
  if (!inv) throw new Error("Invoice not found");
  await logEvent(inv.job_id, i.actorId, PAYMENT_EVENT, `Office recorded a ${i.source} payment of $${(i.amountCents / 100).toFixed(2)}${i.note ? ` – ${i.note}` : ""}`, { invoice_id: inv.id, amount_cents: i.amountCents, source: i.source, paid_at: i.paidAt, note: i.note }, { internal: true });
  // Gates read invoices.total_paid: lift it to the ledger total so the recorded transfer counts now; Xero reconciles on the next sync.
  const paid = await reconciledInvoicePaidCents(inv.job_id, inv.id, { totalPaid: inv.total_paid });
  if (paid !== toCents(inv.total_paid)) {
    const { applyPaidAmount } = await import("./xero.server");
    await applyPaidAmount(inv.id, paid / 100, i.actorId);
  }
  await afterPaymentsChanged(inv.job_id, inv.id, i.actorId);
}

/** Everything a page needs: plan, steps, what is due now, ledger, bank details and the Pay now (card) link. */
export async function jobPaymentView(jobId: string, now = new Date()) {
  const [{ data: inv }, { data: ws }, { data: rect }, { data: installBooking }, { data: installDone }, { data: job }] = await Promise.all([
    admin.from("invoices").select("id, quote_id, total_inc_gst, total_paid, deposit_amount, xero_invoice_number, xero_reference, xero_online_url, xero_invoice_id, balance_due_date, quotes(accepted_at, customer_total_inc_gst)").eq("job_id", jobId).eq("kind", "installation").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("workflow_settings").select("safety_check_payment_inc_gst").eq("id", 1).maybeSingle(),
    admin.from("quotes").select("customer_total_inc_gst, accepted_at").eq("job_id", jobId).eq("kind", "rectification").eq("status", "accepted").order("accepted_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("bookings").select("id, created_at, scheduled_start").eq("job_id", jobId).eq("kind", "installation").eq("status", "confirmed").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("bookings").select("id, scheduled_start").eq("job_id", jobId).eq("kind", "installation").eq("status", "completed").order("scheduled_start", { ascending: false }).limit(1).maybeSingle(),
    admin.from("jobs").select("job_number, stage, source").eq("id", jobId).maybeSingle(),
  ]);
  if (!inv) return null;
  const [{ count: overrides }, { data: piesaLines }] = await Promise.all([
    admin.from("payment_overrides").select("id", { count: "exact", head: true }).eq("invoice_id", inv.id).eq("gate", "deposit"),
    inv.quote_id ? admin.from("quote_items").select("code, line_total_inc_gst").eq("quote_id", inv.quote_id).eq("code", "PIESA") : Promise.resolve({ data: [] as { code: string | null; line_total_inc_gst: number | string | null }[] }),
  ]);
  const quote = inv.quotes as unknown as { accepted_at: string | null; customer_total_inc_gst: number } | null;
  // Decision 302: the upfront safety check = the accepted quote's PIESA line ($349 for our electrician, the REC's onboarded
  // rate otherwise); the setting is only the fallback when the quote carries no PIESA line.
  const { safetyCheckCentsFor } = await import("./safety-check-amount.core");
  const safety = safetyCheckCentsFor({ lines: piesaLines ?? [], settingIncGst: ws?.safety_check_payment_inc_gst ?? null });
  const plan = paymentPlan({ quoteTotalCents: toCents(inv.total_inc_gst), safetyCheckCents: safety.cents, fixesCents: rect ? toCents(rect.customer_total_inc_gst) : 0 });
  // Audit F01: reconciled (Xero live payments + card records not yet in Xero), never max(total_paid, ledger sum).
  const raw = await rawPaymentLedger(jobId, inv.id);
  const ledger = effectiveLedger(raw);
  const paidCents = raw.some((r) => r.source === "xero") ? cumulativePaidCents(ledger) : Math.max(cumulativePaidCents(ledger), toCents(inv.total_paid));
  const bookedAt = installBooking?.created_at ?? null;
  const facts: Partial<Record<PaymentStepKey, PaymentStepFacts>> = {
    safety_check: { requestedAt: quote?.accepted_at ?? null, waived: (overrides ?? 0) > 0 },
    fixes: { requestedAt: rect?.accepted_at ?? null },
    install_deposit: { requestedAt: bookedAt, dueAt: bookedAt ? provisionalHoldExpiresAt(bookedAt) : null },
    balance: { requestedAt: installDone?.scheduled_start ?? (job?.stage === "complete" ? now.toISOString() : null), dueAt: inv.balance_due_date ? `${inv.balance_due_date}T23:59:59+11:00` : null },
  };
  const steps = paymentSteps(plan, paidCents, facts, now.toISOString());
  const due = payableNow(plan, steps, paidCents);
  const reference = inv.xero_invoice_number ?? inv.xero_reference ?? (job?.job_number ? `Home Insulation Victoria ${job.job_number}` : null);
  const bank = bankDetails();
  const gateEnabled = await paymentGateActiveForJob(jobId);
  const provisional = provisionalBookingDecision({ bookedAt, now: now.toISOString(), depositCleared: isStepCleared(steps, "install_deposit"), gateEnabled, hasInvoice: true });
  // Decision 144: card = Stripe Checkout, only for the $349 / fixes, only when the key + switch allow it for this job's mode.
  const { stripeBlocker } = await import("./stripe.core");
  const stripeBlock = due.step ? stripeBlocker({ enabled: process.env["STRIPE_PAYMENTS_ENABLED"] === "true", secretKey: process.env["STRIPE_SECRET_KEY"], jobSource: job?.source ?? null, step: due.step.key, amountCents: due.step.outstandingCents }) : "Nothing is due.";
  return {
    invoiceId: inv.id, plan, steps, paidCents, due, reference, bank, onlineInvoiceUrl: inv.xero_online_url ?? null, jobSource: job?.source ?? null, safetyCheckSource: safety.source,
    stripe: { available: stripeBlock === null, blocker: stripeBlock },
    payNow: payNowBlock({ step: due.step, cardAvailable: stripeBlock === null, bank, reference, remainingCents: due.remainingCents }),
    provisional: { decision: provisional, bookedAt, expiresAt: bookedAt ? provisionalHoldExpiresAt(bookedAt) : null },
    ledger,
  };
}

/** Downstream of any new payment: confirm a provisional booking, note fixes/balance paid once, then the usual auto-advance. */
export async function afterPaymentsChanged(jobId: string, invoiceId: string, actorId: string | null) {
  const v = await jobPaymentView(jobId);
  if (!v) return;
  const once = async (eventType: string, summary: string, details: Record<string, unknown>) => {
    const { data: prior } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", eventType).contains("details", { invoice_id: invoiceId }).limit(1).maybeSingle();
    if (!prior) await logEvent(jobId, actorId, eventType, summary, { invoice_id: invoiceId, ...details }, { internal: true });
    return !prior;
  };
  if (v.provisional.decision === "confirmed" && v.provisional.bookedAt && await once("install_booking_confirmed", "Install deposit received – the provisional install booking is confirmed", { booked_at: v.provisional.bookedAt })) {
    // Jo 24 Oct 2026 (decision 151): the "Deposit received ✓ Your day is locked in" version of Your install is booked.
    const { data: book } = await admin.from("bookings").select("scheduled_start").eq("job_id", jobId).eq("kind", "installation").in("status", ["confirmed", "completed"]).order("scheduled_start", { ascending: false }).limit(1).maybeSingle();
    if (book?.scheduled_start) await (await import("./install-booked-email.server")).emailOwnerInstallBooked(jobId, book.scheduled_start, { depositReceived: true }).catch((e) => console.error("deposit-received email skipped", (e as Error).message));
  }
  // Decision 325: O22 "You're in!" + safety check receipt once that payment is in (one per accepted quote; best-effort).
  if (isStepPaid(v.steps, "safety_check")) await (await import("./owner-email-triggers.server")).onSafetyCheckPaid(jobId, invoiceId).catch((e) => console.error("you're in email skipped", (e as Error).message));
  if (v.plan.fixesCents > 0 && isStepCleared(v.steps, "fixes")) await once("fixes_payment_received", "Electrical fixes paid – the fixes can be scheduled", { amount_cents: v.plan.fixesCents });
  if (v.paidCents >= v.plan.grandTotalCents && v.plan.grandTotalCents > 0) await once("completion_pack_due", "Invoice fully paid – completion pack can be sent once the install is complete", { paid_cents: v.paidCents });
  const { autoAdvanceJob } = await import("./autoadvance.server");
  await autoAdvanceJob(jobId, actorId, "payment update").catch((e) => console.error("auto-advance after payment skipped", (e as Error).message));
}

/** Install day agreed: record whether the booking is provisional (deposit unpaid, 48h hold). Called best-effort from the booking path. */
export async function noteProvisionalBooking(jobId: string, actorId: string | null) {
  const v = await jobPaymentView(jobId);
  if (!v || v.provisional.decision !== "provisional") return;
  await logEvent(jobId, actorId, "install_booking_provisional", `Install day booked provisionally – ${v.plan.installDepositCents / 100} install deposit due by bank transfer within 48 hours (until ${v.provisional.expiresAt})`, { invoice_id: v.invoiceId, deposit_cents: v.plan.installDepositCents, expires_at: v.provisional.expiresAt }, { internal: true });
}

/** 15-minute tick: release install bookings whose 10% deposit is still unpaid 48h after booking (decision 139).
 *  Only jobs under the payment rule with an invoice. The office is alerted and the owner is told once per released
 *  booking (decision 170, deposit-release-notice.server.ts: text + email, TEST → test-send). With the booking cancelled
 *  and the job back in installation_scheduling, `installDayTurn` is the installer's move again (installer_to_offer), so
 *  the installer's job screen asks for 3 new days; the owner wording says that happens once the deposit is paid. */
export async function sweepProvisionalBookings(now = new Date()) {
  const cutoff = new Date(now.getTime() - 48 * 3_600_000).toISOString();
  const { data: bookings } = await admin.from("bookings").select("id, job_id, created_at, scheduled_start").eq("kind", "installation").eq("status", "confirmed").lt("created_at", cutoff).gt("scheduled_start", now.toISOString()).limit(200);
  let released = 0, checked = 0;
  for (const b of bookings ?? []) {
    const v = await jobPaymentView(b.job_id, now).catch(() => null);
    if (!v) continue;
    checked++;
    if (v.provisional.decision !== "release") continue;
    const { data: rows, error } = await admin.from("bookings").update({ status: "cancelled" }).eq("id", b.id).eq("status", "confirmed").select("id");
    if (error || !rows?.length) continue;
    try {
      const { transition } = await import("./workflow.server");
      await transition(b.job_id, "installation_scheduling", null, "Install booking released – 10% deposit not received within 48 hours; the installer offers new days", { booking_ids: [b.id] });
    } catch (e) {
      await admin.from("bookings").update({ status: "confirmed" }).eq("id", b.id);
      console.error("provisional booking release failed", b.job_id, (e as Error).message);
      continue;
    }
    const { clearInstallDueDate } = await import("./install-balance.server");
    await clearInstallDueDate(b.job_id, null).catch(() => undefined);
    await logEvent(b.job_id, null, "install_booking_released_unpaid", `Install booking released: the ${v.plan.installDepositCents / 100} install deposit was not received within 48 hours. Needs Home Insulation Victoria`, { invoice_id: v.invoiceId, booking_id: b.id, was: b.scheduled_start }, { internal: true });
    // Decision 170: owner told by text + email, once per released booking (best-effort; never undoes the release).
    try {
      const { sendDepositReleaseNotice } = await import("./deposit-release-notice.server");
      const r = await sendDepositReleaseNotice({ jobId: b.job_id, bookingId: b.id, wasStart: b.scheduled_start, depositCents: v.plan.installDepositCents, bank: v.bank, reference: v.reference, releasedAt: now.toISOString() });
      await logEvent(b.job_id, null, "install_booking_released_owner_notice_result", `Owner notice about the released install day: ${r}`, { booking_id: b.id }, { internal: true });
    } catch (e) {
      await logEvent(b.job_id, null, "install_booking_released_owner_notice_result", `Owner notice about the released install day failed: ${(e as Error).message}`, { booking_id: b.id }, { internal: true });
    }
    await admin.from("jobs").update({ next_action: "Install day released (deposit unpaid after 48h) – owner told; the installer offers 3 new days once the deposit is paid" }).eq("id", b.job_id);
    released++;
  }
  return { checked, released };
}
