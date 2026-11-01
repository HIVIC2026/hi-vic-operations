// Owner payments (decisions 139/140/141; batch 3b: each step on its OWN invoice — installation, fixes, repeat safety check).
// Rules live in payments.core.ts.
// Ledger: append-only `owner_payment_recorded` workflow events (one per Xero PaymentID / Stripe PaymentIntent; old office
// records stay as history) plus `owner_payment_reversed` rows for Xero payments later deleted/voided — the project's
// existing immutable event log, so no new table and no live schema change. Xero is the system of record; the amount
// received is `reconciledPaidCents` (Xero's live payments + card records not yet matched in Xero, audit F01), and
// invoices.total_paid follows it down as well as up. Audit R06: every ledger row carries `details.receipt_key` (Stripe
// PaymentIntent / refund state, Xero PaymentID / reversal) and pending migration payment-receipt-once.sql makes that key
// unique, so two concurrent deliveries of one receipt write ONE row; the loser's 23505 reads as "already recorded".
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent, paymentGateActiveForJob } from "./workflow.server";
import { currentFixesQuote, FIXES_ACCEPT_LATEST } from "./fixes-quote-current.server";
import {
  HIV_BANK_DETAILS, type BankDetails, type PaymentStepFacts, type PaymentStepKey, type XeroPaymentInput,
  type InvoiceSlot, type PaidByInvoice,
  cumulativePaidCents, depositSweepAction, paymentPairKey, effectiveLedger, FIXES_NOT_PAID_BLOCKER, fixesInvoicePaid, isStepCleared, isStepPaid, ledgerXeroPayments, newXeroPayments, payNowBlock, payableNow, paymentPlan, paymentSteps, stepInvoiceKind, totalPaidCents,
  provisionalBookingDecision, provisionalHoldExpiresAt, installDepositBlocker, INSTALL_DEPOSIT_DUE_STAGES, installDepositDueNow, reconcilePayments, reconciledPaidCents, toCents, xeroPaymentFacts, xeroReceiptKey, xeroReversalReceiptKey, xeroReversals,
} from "./payments.core";

// Review R08: the ledger reader lives in the lean payment-ledger.server (so read-only gates can count money received
// without this module's senders); re-exported here unchanged.
import { PAYMENT_EVENT, PAYMENT_MATCH_SEPARATE_EVENT, PAYMENT_REVERSED_EVENT, rawPaymentLedger } from "./payment-ledger.server";
import { early } from "./early-read";
import { endOfMelbourneYmd } from "./melbourne-time.core";
export { PAYMENT_EVENT, PAYMENT_MATCH_SEPARATE_EVENT, PAYMENT_REVERSED_EVENT, rawPaymentLedger };
/** Owner notice when an unpaid provisional booking is released: approved by Jo 24 Oct 2026 (decision 170; wording in deposit-release-notice.core.ts). */
export { PROVISIONAL_RELEASE_OWNER_NOTICE_APPROVED } from "./deposit-release-notice.core";
/** Audit R02: a card payment and a same-amount Xero payment with no shared receipt identity — counted ONCE until the office
 *  confirms (Jo 28 Oct) and raised ONCE per pair; "Two separate payments" counts both. Cleared by `PAYMENT_MATCH_RESOLVED_EVENT` once no pair is left. */
export const PAYMENT_MATCH_UNCLEAR_EVENT = "owner_payment_match_unclear";
export const PAYMENT_MATCH_RESOLVED_EVENT = "owner_payment_match_resolved";

/** Audit R06: append one ledger row (`owner_payment_recorded` / `owner_payment_reversed`) carrying its `receipt_key`.
 *  A unique violation (23505, pending migration payment-receipt-once.sql) means a concurrent delivery already recorded
 *  this receipt → "duplicate", and the caller must not apply it again. Any other error throws. */
export async function insertLedgerEvent(jobId: string, actorId: string | null, eventType: typeof PAYMENT_EVENT | typeof PAYMENT_REVERSED_EVENT, summary: string, details: Record<string, unknown> & { receipt_key: string }): Promise<"recorded" | "duplicate"> {
  const { error } = await admin.from("workflow_events").insert({ job_id: jobId, actor_id: actorId, event_type: eventType, summary, details: details as never, internal: true });
  if (error) {
    if ((error as { code?: string }).code === "23505") return "duplicate";
    throw new Error(error.message);
  }
  await admin.from("jobs").update({ last_activity_at: new Date().toISOString() }).eq("id", jobId);
  return "recorded";
}

/** Bank details for owner pages/emails: Jo's NAB account (decision 152), env vars override. */
export function bankDetails(): BankDetails {
  const bsb = process.env["HIV_BANK_BSB"]?.trim() || HIV_BANK_DETAILS.bsb;
  const accountNumber = process.env["HIV_BANK_ACCOUNT_NUMBER"]?.trim() || HIV_BANK_DETAILS.accountNumber;
  const payId = process.env["HIV_PAYID"]?.trim() || HIV_BANK_DETAILS.payId;
  const accountName = process.env["HIV_BANK_ACCOUNT_NAME"]?.trim() || HIV_BANK_DETAILS.accountName;
  return { accountName, bsb, accountNumber, payId, configured: !!((bsb && accountNumber) || payId) };
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
  let written = 0;
  for (const p of fresh) {
    if (await insertLedgerEvent(jobId, actorId, PAYMENT_EVENT, `Payment of $${(p.amountCents / 100).toFixed(2)} received in Xero`, { invoice_id: invoiceId, amount_cents: p.amountCents, source: "xero", paid_at: p.paidAt, xero_payment_id: p.xeroPaymentId, xero_reference: p.reference, receipt_key: xeroReceiptKey(invoiceId, p.xeroPaymentId) }) === "recorded") written++;
  }
  const gone = opts.fullList === false ? [] : xeroReversals(raw, xeroPayments);
  for (const p of gone) {
    if (await insertLedgerEvent(jobId, actorId, PAYMENT_REVERSED_EVENT, `Xero payment of $${(p.amountCents / 100).toFixed(2)} was deleted or voided in Xero – no longer counted`, { invoice_id: invoiceId, amount_cents: p.amountCents, source: "xero", paid_at: p.paidAt, xero_payment_id: p.xeroPaymentId, receipt_key: xeroReversalReceiptKey(invoiceId, p.xeroPaymentId) }) === "recorded") written++;
  }
  return written;
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

// Decision 368 (audit F18): the office "Record payment" entry (recordManualPayment) is removed. Old office rows stay in
// the ledger as history and are reconciled against Xero (amount/date — they never had a receipt identity).

/** Audit R02: raise ONE internal office row per card receipt + Xero payment pair that has the same amount within 10 days
 *  but no shared Stripe id. The pair is counted once meanwhile (Jo 28 Oct) until the office confirms or marks it separate. When no pair is left (the Xero
 *  payment was re-applied with the Stripe id in its Reference, or removed), ONE resolved row clears it. Best-effort:
 *  never changes money; `xeroPayments` = the invoice's live Payments list (else the ledger's own Xero view). */
export async function flagUnclearPaymentMatches(jobId: string, invoiceId: string, xeroPayments?: XeroPaymentInput[] | null): Promise<number> {
  const raw = await rawPaymentLedger(jobId, invoiceId);
  const facts = xeroPayments ? xeroPaymentFacts(xeroPayments) : ledgerXeroPayments(raw);
  const pairs = reconcilePayments(raw, facts).unclear.filter((p) => !!p.xero.paymentId);
  const { data: prior } = await admin.from("workflow_events").select("event_type, created_at, details").eq("job_id", jobId).in("event_type", [PAYMENT_MATCH_UNCLEAR_EVENT, PAYMENT_MATCH_RESOLVED_EVENT]).order("created_at");
  const rows = ((prior ?? []) as { event_type: string; created_at: string; details: Record<string, unknown> | null }[]).filter((r) => r.details?.["invoice_id"] === invoiceId);
  const lastResolved = rows.filter((r) => r.event_type === PAYMENT_MATCH_RESOLVED_EVENT).at(-1)?.created_at ?? "";
  const open = rows.filter((r) => r.event_type === PAYMENT_MATCH_UNCLEAR_EVENT && r.created_at > lastResolved);
  const raisedKeys = new Set(open.map((r) => String(r.details?.["pair_key"] ?? "")));
  let raised = 0;
  for (const { record, xero } of pairs) {
    const card = (record.stripeIds ?? [])[0] ?? record.id;
    const pairKey = paymentPairKey(record, xero.paymentId);
    if (raisedKeys.has(pairKey)) continue;
    await logEvent(jobId, null, PAYMENT_MATCH_UNCLEAR_EVENT,
      "Card payment and a same-amount Xero payment with no Stripe id — counted once until you confirm.",
      { invoice_id: invoiceId, pair_key: pairKey, stripe_ids: record.stripeIds ?? [], xero_payment_id: xero.paymentId, xero_reference: xero.reference ?? null, amount_cents: record.amountCents, needs_office: true }, { internal: true });
    raisedKeys.add(pairKey);
    raised++;
  }
  if (!pairs.length && open.length) await logEvent(jobId, null, PAYMENT_MATCH_RESOLVED_EVENT, "Card and Xero payments are confirmed – nothing left to check", { invoice_id: invoiceId }, { internal: true });
  return raised;
}

/** Card + Xero pairs counted once that the office has not confirmed yet (for the "Two separate payments" button). */
export async function unclearPaymentPairs(jobId: string, invoiceId: string) {
  const raw = await rawPaymentLedger(jobId, invoiceId);
  return reconcilePayments(raw, ledgerXeroPayments(raw)).unclear.filter((p) => !!p.xero.paymentId)
    .map((p) => ({ pairKey: paymentPairKey(p.record, p.xero.paymentId), amountCents: p.record.amountCents, xeroPaymentId: p.xero.paymentId as string, xeroPaidAt: p.xero.paidAt }));
}

/** The office says an unclear card + Xero pair is TWO separate payments: ONE append-only `payment_match_separate` event
 *  per pair (second press = no second event). Both then count, the unclear row clears and the paid amount is re-applied.
 *  Returns false when the pair was already marked. */
export async function markPaymentsSeparate(jobId: string, invoiceId: string, pairKey: string, actorId: string | null): Promise<boolean> {
  const { data: prior } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", PAYMENT_MATCH_SEPARATE_EVENT);
  if (((prior ?? []) as { details: Record<string, unknown> | null }[]).some((r) => r.details?.["invoice_id"] === invoiceId && r.details?.["pair_key"] === pairKey)) return false;
  const pair = (await unclearPaymentPairs(jobId, invoiceId)).find((p) => p.pairKey === pairKey);
  if (!pair) throw new Error("That payment pair is no longer waiting for a decision.");
  await logEvent(jobId, actorId, PAYMENT_MATCH_SEPARATE_EVENT, "Card payment and Xero payment confirmed as two separate payments — both count.",
    { invoice_id: invoiceId, pair_key: pairKey, xero_payment_id: pair.xeroPaymentId, amount_cents: pair.amountCents }, { internal: true });
  await flagUnclearPaymentMatches(jobId, invoiceId);
  const paid = await reconciledInvoicePaidCents(jobId, invoiceId);
  await (await import("./xero.server")).applyPaidAmount(invoiceId, paid / 100, actorId);
  return true;
}

const INVOICE_COLS = "id, kind, quote_id, repeat_key, total_inc_gst, total_paid, deposit_amount, xero_invoice_number, xero_reference, xero_online_url, xero_invoice_id, balance_due_date";
export type InvoiceRow = {
  id: string; kind: string; quote_id: string | null; repeat_key: string | null; total_inc_gst: number | string; total_paid: number | string | null; deposit_amount: number | string | null;
  xero_invoice_number: string | null; xero_reference: string | null; xero_online_url: string | null; xero_invoice_id: string | null; balance_due_date: string | null;
};
/** Batch 3b: the job's invoices a payment step can be paid on — the newest installation invoice, the newest accepted fixes
 *  quote's invoice and the current owner-paid repeat safety check's invoice (null when there is none). */
export type JobInvoices = { install: InvoiceRow | null; fixes: InvoiceRow | null; repeat: InvoiceRow | null };
/** The invoice a step is paid on (card checkout, bank reference). */
export function stepInvoice(view: { invoices: JobInvoices }, step: PaymentStepKey): InvoiceRow | null {
  return view.invoices[stepInvoiceKind(step)];
}
/** The bank-transfer reference for one invoice: its Xero invoice number, else its stored reference. */
const invoiceReference = (inv: InvoiceRow | null) => (inv ? inv.xero_invoice_number ?? inv.xero_reference ?? null : null);

/** The accepted newest fixes quote's own invoice (null when the newest fixes quote isn't accepted or has no invoice yet). */
async function fixesInvoiceFor(fixesQuoteId: string | null): Promise<InvoiceRow | null> {
  if (!fixesQuoteId) return null;
  const { data, error } = await admin.from("invoices").select(INVOICE_COLS).eq("quote_id", fixesQuoteId).eq("kind", "rectification").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("The fixes invoice could not be checked.");
  return (data as InvoiceRow | null) ?? null;
}

/** Money received on one invoice in cents (audit F01: reconciled, never max(total_paid, ledger sum)) + its effective ledger. */
async function invoiceMoney(jobId: string, inv: InvoiceRow | null) {
  if (!inv) return { paidCents: 0, raw: [] as Awaited<ReturnType<typeof rawPaymentLedger>>, ledger: [] as Awaited<ReturnType<typeof rawPaymentLedger>> };
  const raw = await rawPaymentLedger(jobId, inv.id);
  const ledger = effectiveLedger(raw);
  const paidCents = raw.some((r) => r.source === "xero") ? cumulativePaidCents(ledger) : Math.max(cumulativePaidCents(ledger), toCents(inv.total_paid));
  return { paidCents, raw, ledger };
}

/** Everything a page needs: plan, steps, what is due now, ledger, bank details and the Pay now (card) link. Null while the
 *  job has no installation invoice (the fixes gate then reads the fixes invoice itself — `fixesPaymentBlockerFor`). */
export async function jobPaymentView(jobId: string, now = new Date()) {
  // Speed (installer screens, Task 6): the repeat-check context and the payment-gate switch need only the job id, so they
  // are read alongside the invoice (each awaited where it was before; a read that is not needed is simply dropped).
  const repeatCtxP = early(import("./repeat-piesa.server").then((m) => m.repeatPiesaContext(jobId)).catch(() => null));
  const gateEnabledP = early(paymentGateActiveForJob(jobId));
  const [{ data: invRow, error: invoiceError }, { data: ws }, { data: rect }, { data: installBooking }, { data: installDone }, { data: job }, { data: piesaNow }] = await Promise.all([
    admin.from("invoices").select(`${INVOICE_COLS}, quotes(accepted_at, customer_total_inc_gst)`).eq("job_id", jobId).eq("kind", "installation").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("workflow_settings").select("safety_check_payment_inc_gst").eq("id", 1).maybeSingle(),
    currentFixesQuote(jobId).then(q => ({ data: q?.status === "accepted" ? q : null })),
    admin.from("bookings").select("id, created_at, scheduled_start").eq("job_id", jobId).eq("kind", "installation").eq("status", "confirmed").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("bookings").select("id, scheduled_start").eq("job_id", jobId).eq("kind", "installation").eq("status", "completed").order("scheduled_start", { ascending: false }).limit(1).maybeSingle(),
    admin.from("jobs").select("job_number, stage, source").eq("id", jobId).maybeSingle(),
    admin.from("piesa_records").select("outcome, section_c_signed_at").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
  ]);
  if (invoiceError) throw new Error("The invoice could not be checked.");
  if (!invRow) return null;
  const inv = invRow as unknown as InvoiceRow & { quotes: { accepted_at: string | null; customer_total_inc_gst: number } | null };
  // Decision 233: while the owner owes the repeat safety check (PIESA), it is a step of their plan, paid on its own invoice.
  const repeatCtx = await repeatCtxP;
  const repeatState = repeatCtx?.state ?? null;
  const repeatOwed = !!repeatState && repeatState.payer === "owner" && (repeatState.stage === "owner_pay" || repeatState.stage === "offer") && (repeatState.priceIncGst ?? 0) > 0 && !!repeatState.deadline;
  // The installation invoice's money needs only that invoice: read with the follow-up reads, awaited below as before.
  const installMoneyP = early(invoiceMoney(jobId, inv));
  const [{ count: overrides }, { data: piesaLines }, fixesInv, { data: repeatRow }] = await Promise.all([
    admin.from("payment_overrides").select("id", { count: "exact", head: true }).eq("invoice_id", inv.id).eq("gate", "deposit"),
    inv.quote_id ? admin.from("quote_items").select("code, line_total_inc_gst").eq("quote_id", inv.quote_id).eq("code", "PIESA") : Promise.resolve({ data: [] as { code: string | null; line_total_inc_gst: number | string | null }[] }),
    fixesInvoiceFor(rect?.id ?? null),
    repeatOwed ? admin.from("invoices").select(INVOICE_COLS).eq("job_id", jobId).eq("kind", "repeat_safety_check").eq("repeat_key", repeatState!.deadline!).limit(1).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const invoices: JobInvoices = { install: inv, fixes: fixesInv, repeat: (repeatRow as InvoiceRow | null) ?? null };
  const quote = inv.quotes;
  // Decision 302: the upfront safety check = the accepted quote's PIESA line ($349 for our electrician, the REC's onboarded
  // rate otherwise); the setting is only the fallback when the quote carries no PIESA line.
  const { safetyCheckCentsFor } = await import("./safety-check-amount.core");
  const safety = safetyCheckCentsFor({ lines: piesaLines ?? [], settingIncGst: ws?.safety_check_payment_inc_gst ?? null });
  // Batch 3b: the installation invoice never holds the fixes or a repeat check, so its total is the plan's quote part. The
  // newest accepted fixes quote is always its own step (also when it was accepted before the installation quote), paid
  // on its own invoice; the repeat check likewise.
  const fixesCents = fixesInv ? toCents(fixesInv.total_inc_gst) : rect ? toCents(rect.customer_total_inc_gst) : 0;
  const repeatCents = !repeatOwed ? 0 : invoices.repeat ? toCents(invoices.repeat.total_inc_gst) : toCents(repeatState!.priceIncGst);
  const plan = paymentPlan({ quoteTotalCents: toCents(inv.total_inc_gst), safetyCheckCents: safety.cents, fixesCents, repeatCents });
  const [installMoney, fixesMoney, repeatMoney] = await Promise.all([installMoneyP, invoiceMoney(jobId, invoices.fixes), invoiceMoney(jobId, invoices.repeat)]);
  const paid: PaidByInvoice = { install: installMoney.paidCents, fixes: fixesMoney.paidCents, repeat: repeatMoney.paidCents };
  const paidCents = totalPaidCents(paid);
  const ledger = installMoney.ledger;
  const bookedAt = installBooking?.created_at ?? null;
  const installStart = installBooking?.scheduled_start ?? null;
  // Decision 367: the deposit hold ends at min(booked + 48h, noon Melbourne the day before the install).
  const holdExpiresAt = bookedAt ? provisionalHoldExpiresAt(bookedAt, installStart) : null;
  const facts: Partial<Record<PaymentStepKey, PaymentStepFacts>> = {
    safety_check: { requestedAt: quote?.accepted_at ?? null, waived: (overrides ?? 0) > 0 },
    fixes: { requestedAt: fixesCents > 0 ? rect?.accepted_at ?? null : null },
    // Jo 26 Oct 2026: the deposit is due BEFORE the install is booked (once the install is next); no booking hold. Jo 29 Oct:
    // never while fixes are still to be done (installDepositDueNow).
    install_deposit: { requestedAt: bookedAt ?? (installDepositDueNow(job?.stage, piesaNow) ? now.toISOString() : null), dueAt: bookedAt ? holdExpiresAt : null },
    balance: { requestedAt: installDone?.scheduled_start ?? (job?.stage === "complete" ? now.toISOString() : null), dueAt: inv.balance_due_date ? endOfMelbourneYmd(inv.balance_due_date) : null },
    repeat_safety_check: { requestedAt: repeatCents > 0 ? now.toISOString() : null, recordedPaid: repeatState?.stage === "offer" },
  };
  const steps = paymentSteps(plan, paid, facts, now.toISOString());
  const due = payableNow(plan, steps, paid);
  // Bank reference per step: each invoice's own number (the fixes and repeat invoices carry their own references).
  const installReference = invoiceReference(inv) ?? (job?.job_number ? `Home Insulation Victoria ${job.job_number}` : null);
  const references: Record<InvoiceSlot, string | null> = { install: installReference, fixes: invoiceReference(invoices.fixes), repeat: invoiceReference(invoices.repeat) };
  const dueReference = due.step ? references[stepInvoiceKind(due.step.key)] : installReference;
  const bank = bankDetails();
  const gateEnabled = await gateEnabledP;
  const provisional = provisionalBookingDecision({ bookedAt, now: now.toISOString(), depositCleared: isStepCleared(steps, "install_deposit"), gateEnabled, hasInvoice: true, installStart });
  // Decision 144: card = Stripe Checkout, only for the card steps, only when the key + switch allow it for this job's mode,
  // and only when the due step's own invoice exists (the checkout carries that invoice).
  const { stripeBlocker } = await import("./stripe.core");
  const stripeBlock = due.step ? (!stepInvoice({ invoices }, due.step.key) ? "Nothing is due." : stripeBlocker({ enabled: process.env["STRIPE_PAYMENTS_ENABLED"] === "true", secretKey: (await import("./stripe.server")).stripeKeyFor(job?.source ?? null), jobSource: job?.source ?? null, step: due.step.key, amountCents: due.step.outstandingCents })) : "Nothing is due.";
  return {
    invoiceId: inv.id, invoices, plan, steps, paid, paidCents, due, reference: installReference, references, bank, onlineInvoiceUrl: inv.xero_online_url ?? null, jobSource: job?.source ?? null, safetyCheckSource: safety.source,
    stripe: { available: stripeBlock === null, blocker: stripeBlock },
    payNow: payNowBlock({ step: due.step, cardAvailable: stripeBlock === null, bank, reference: dueReference, remainingCents: due.remainingCents }),
    provisional: { decision: provisional, bookedAt, installStart, expiresAt: holdExpiresAt },
    ledger,
    // Batch 3b: unclear card + Xero pairs on EVERY invoice of the job, each with its invoice and that invoice's reference
    // (the office "Two separate payments" acts on that invoice).
    unclearPairs: ([["install", inv, installMoney.raw], ["fixes", invoices.fixes, fixesMoney.raw], ["repeat", invoices.repeat, repeatMoney.raw]] as const).flatMap(([slot, row, r]) => !row ? [] :
      reconcilePayments(r, ledgerXeroPayments(r)).unclear.filter((p) => !!p.xero.paymentId)
        .map((p) => ({ invoiceId: row.id, invoice: slot as InvoiceSlot, reference: references[slot], pairKey: paymentPairKey(p.record, p.xero.paymentId), amountCents: p.record.amountCents, xeroPaymentId: p.xero.paymentId as string, xeroPaidAt: p.xero.paidAt }))),
  };
}

/** Decision 366 / batch 3b: "The electrical fixes must be paid in full…" until the NEWEST fixes quote's own invoice is
 *  paid in full; null when there are no fixes. Reads the fixes invoice directly, so it works before any installation
 *  invoice exists (old model: fixes accepted first). Shared by confirmBooking (kind rectification) and
 *  stageEntryBlockers("rectification_booked"). */
export async function fixesPaymentBlockerFor(jobId: string): Promise<string | null> {
  const current = await currentFixesQuote(jobId);
  if (!current) return null;
  if (current.status !== "accepted") return FIXES_ACCEPT_LATEST;
  if (!(toCents(current.customer_total_inc_gst) > 0)) return null;
  const inv = await fixesInvoiceFor(current.id);
  if (!inv) return "The newest electrical fixes quote must be paid in full before the fixes can be booked — invoice not available.";
  const { paidCents } = await invoiceMoney(jobId, inv);
  return fixesInvoicePaid(toCents(inv.total_inc_gst), paidCents) ? null : FIXES_NOT_PAID_BLOCKER;
}

/** Jo 26 Oct 2026: "The 10% install deposit must be paid…" until paid/waived; null with no invoice. Shared by
 *  confirmBooking (kind installation), stageEntryBlockers("installation_booked") and the install-day offers. */
export async function installDepositBlockerFor(jobId: string): Promise<string | null> {
  const v = await jobPaymentView(jobId);
  return v ? installDepositBlocker(v.plan, v.steps) : null;
}

/** Downstream of any new payment (on any of the job's invoices): note the fixes paid once (keyed by the fixes invoice),
 *  then the install-invoice effects (deposit, safety check, fully paid; keyed by the installation invoice), then the usual
 *  auto-advance. */
export async function afterPaymentsChanged(jobId: string, invoiceId: string, actorId: string | null) {
  const once = async (eventType: string, summary: string, onInvoice: string, details: Record<string, unknown>) => {
    const { data: prior } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", eventType).contains("details", { invoice_id: onInvoice }).limit(1).maybeSingle();
    if (!prior) await logEvent(jobId, actorId, eventType, summary, { invoice_id: onInvoice, ...details }, { internal: true });
    return !prior;
  };
  // Batch 3b: the fixes are paid on their own invoice — also before any installation invoice exists (old model).
  const fixesQuote = await currentFixesQuote(jobId);
  if (fixesQuote?.status === "accepted" && !(await fixesPaymentBlockerFor(jobId))) {
    const fixesInv = await fixesInvoiceFor(fixesQuote.id);
    if (fixesInv) await once("fixes_payment_received", "Electrical fixes paid – the fixes can be scheduled", fixesInv.id, { amount_cents: toCents(fixesInv.total_inc_gst) });
    // Decision 366: a fixes time the owner already picked becomes the booking now (the 15-minute tick retries otherwise).
    await (await import("./owner-fixes.server")).bookPickedFixesTime(jobId, actorId).catch((e) => console.error("fixes booking after payment skipped", (e as Error).message));
  }
  const v = await jobPaymentView(jobId);
  if (!v) return;
  // Jo 26 Oct 2026: deposit in → the install can be booked now (the installer offers days). The "Your install is booked"
  // email goes only when a day is actually booked (install-days bookAgreedDay), never before the deposit.
  if (v.plan.installDepositCents > 0 && isStepCleared(v.steps, "install_deposit") && !v.provisional.bookedAt
    && await once("install_deposit_received", "10% install deposit received – the install day can now be booked", v.invoiceId, { amount_cents: v.plan.installDepositCents })) {
    await admin.from("jobs").update({ next_action: "Deposit paid – installer to offer 3 install days" }).eq("id", jobId);
  }
  if(isStepPaid(v.steps,'install_deposit'))await (await import('./deposit-request.server')).notifyInstallerDepositPaid(jobId).catch(e=>console.error('Install deposit paid notice held',e instanceof Error?e.message:'read failed'));
  // Decision 325: O22 "You're in!" + safety check receipt once that payment is in (one per accepted quote; best-effort).
  if (isStepPaid(v.steps, "safety_check")) {
    await (await import("./owner-email-triggers.server")).onSafetyCheckPaid(jobId, v.invoiceId).catch((e) => console.error("you're in email skipped", (e as Error).message));
    // Jo 28 Oct 2026: the installer's "Owner accepted" email goes now, once the safety check is paid (once per quote; best-effort).
    await (await import("./installer-accepted-email.server")).emailInstallerOnSafetyCheckPaid(jobId, v.invoiceId).catch((e) => console.error("installer accepted email skipped", (e as Error).message));
  }
  if (v.due.remainingCents === 0 && v.plan.grandTotalCents > 0) await once("completion_pack_due", "Invoice fully paid – completion pack can be sent once the install is complete", v.invoiceId, { paid_cents: v.paidCents });
  const { autoAdvanceJob } = await import("./autoadvance.server");
  await autoAdvanceJob(jobId, actorId, "payment update").catch((e) => console.error("auto-advance after payment skipped", (e as Error).message));
}

/** Install day agreed: record whether the booking is provisional (deposit unpaid, 48h hold). Called best-effort from the booking path. */
export async function noteProvisionalBooking(jobId: string, actorId: string | null) {
  const v = await jobPaymentView(jobId);
  if (!v || v.provisional.decision !== "provisional") return;
  await logEvent(jobId, actorId, "install_booking_provisional", `Install day booked provisionally – ${v.plan.installDepositCents / 100} install deposit due (card, bank transfer or PayID) within 48 hours or by noon the day before the install, whichever is sooner (until ${v.provisional.expiresAt})`, { invoice_id: v.invoiceId, deposit_cents: v.plan.installDepositCents, expires_at: v.provisional.expiresAt }, { internal: true });
}

/** Decision 367: ONE office row per booking whose install start passed with the deposit still unpaid. */
export const DEPOSIT_UNPAID_AT_START_EVENT = "install_deposit_unpaid_at_start";

/** 15-minute tick: release install bookings whose 10% deposit is still unpaid when the hold ends — min(booked + 48h,
 *  noon Melbourne the day before the install) (decisions 139/367). Only jobs under the payment rule with an invoice. The
 *  office is alerted and the owner is told once per released booking (decision 170, deposit-release-notice.server.ts:
 *  text + email, TEST → test-send). With the booking cancelled and the job back in installation_scheduling,
 *  `installDayTurn` is the installer's move again (installer_to_offer), so the installer's job screen asks for 3 new days;
 *  the owner wording says that happens once the deposit is paid. A booking whose start already passed unpaid is never
 *  skipped silently or released mid-job: it raises ONE `install_deposit_unpaid_at_start` Needs me row (the pre-start
 *  check already locks the install with "Install deposit not paid"). */
export async function sweepProvisionalBookings(now = new Date()) {
  // Candidates: booked ≥48h ago, or starting within 48h (noon the day before can come first), or already started.
  const cutoff = new Date(now.getTime() - 48 * 3_600_000).toISOString();
  const soon = new Date(now.getTime() + 48 * 3_600_000).toISOString();
  const { data: bookings } = await admin.from("bookings").select("id, job_id, created_at, scheduled_start").eq("kind", "installation").eq("status", "confirmed").or(`created_at.lt.${cutoff},scheduled_start.lt.${soon}`).limit(300);
  // Perf 25 Oct 2026: a booking whose install day has started and whose office alert is already recorded can only end in
  // "office_alert → already alerted" — skip it without the ~9 payment reads. One batched read of those alerts.
  const started = (bookings ?? []).filter((b) => Date.parse(b.scheduled_start) <= now.getTime());
  const { readByJobIds } = await import("./sweep-batch.server");
  const alertedRows = await readByJobIds<{ details: unknown }>("deposit alerts", started.map((b) => b.job_id), (c) => admin.from("workflow_events").select("details").in("job_id", c).eq("event_type", DEPOSIT_UNPAID_AT_START_EVENT));
  const alertedBookings = new Set(alertedRows.map((r) => String((r.details as { booking_id?: unknown } | null)?.booking_id ?? "")));
  const todo = (bookings ?? []).filter((b) => !(Date.parse(b.scheduled_start) <= now.getTime() && alertedBookings.has(b.id)));
  // Payment views are reads only: five at a time; every action below still runs one booking at a time, in order.
  const views = new Map<string, Awaited<ReturnType<typeof jobPaymentView>> | null>();
  for (let i = 0; i < todo.length; i += 5) await Promise.all(todo.slice(i, i + 5).map(async (b) => { views.set(b.id, await jobPaymentView(b.job_id, now).catch(() => null)); }));
  let released = 0, checked = 0, alerted = 0;
  for (const b of todo) {
    const v = views.get(b.id) ?? null;
    if (!v) continue;
    checked++;
    const action = depositSweepAction({ decision: v.provisional.decision, installStart: b.scheduled_start, now: now.toISOString() });
    if (action === "none") continue;
    if (action === "office_alert") {
      const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", b.job_id).eq("event_type", DEPOSIT_UNPAID_AT_START_EVENT).contains("details", { booking_id: b.id });
      if (!count) {
        await logEvent(b.job_id, null, DEPOSIT_UNPAID_AT_START_EVENT, `Install day ${b.scheduled_start} has started but the ${(v.plan.installDepositCents / 100).toFixed(2)} install deposit is still not paid – the install is locked. Needs Home Insulation Victoria`, { invoice_id: v.invoiceId, booking_id: b.id, scheduled_start: b.scheduled_start, deposit_cents: v.plan.installDepositCents, needs_office: true }, { internal: true });
        alerted++;
      }
      continue;
    }
    const { data: rows, error } = await admin.from("bookings").update({ status: "cancelled" }).eq("id", b.id).eq("status", "confirmed").select("id");
    if (error || !rows?.length) continue;
    try {
      const { transition } = await import("./workflow.server");
      await transition(b.job_id, "installation_scheduling", null, "Install booking released – 10% deposit not received in time (48 hours, or noon the day before the install if sooner); the installer offers new days", { booking_ids: [b.id] });
    } catch (e) {
      await admin.from("bookings").update({ status: "confirmed" }).eq("id", b.id);
      console.error("provisional booking release failed", b.job_id, (e as Error).message);
      continue;
    }
    const { clearInstallDueDate } = await import("./install-balance.server");
    await clearInstallDueDate(b.job_id, null).catch(() => undefined);
    await logEvent(b.job_id, null, "install_booking_released_unpaid", `Install booking released: the ${v.plan.installDepositCents / 100} install deposit was not received by ${v.provisional.expiresAt} (48 hours, or noon the day before the install if sooner). Needs Home Insulation Victoria`, { invoice_id: v.invoiceId, booking_id: b.id, was: b.scheduled_start, expired_at: v.provisional.expiresAt }, { internal: true });
    // Decision 170: owner told by text + email, once per released booking (best-effort; never undoes the release).
    try {
      const { sendDepositReleaseNotice } = await import("./deposit-release-notice.server");
      const r = await sendDepositReleaseNotice({ jobId: b.job_id, bookingId: b.id, wasStart: b.scheduled_start, depositCents: v.plan.installDepositCents, bank: v.bank, reference: v.reference, releasedAt: now.toISOString() });
      await logEvent(b.job_id, null, "install_booking_released_owner_notice_result", `Owner notice about the released install day: ${r}`, { booking_id: b.id }, { internal: true });
    } catch (e) {
      await logEvent(b.job_id, null, "install_booking_released_owner_notice_result", `Owner notice about the released install day failed: ${(e as Error).message}`, { booking_id: b.id }, { internal: true });
    }
    await admin.from("jobs").update({ next_action: "Install day released (deposit unpaid by the hold deadline) – owner told; the installer offers 3 new days once the deposit is paid" }).eq("id", b.job_id);
    released++;
  }
  return { checked, released, alerted };
}
