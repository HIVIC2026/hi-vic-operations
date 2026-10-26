// Owner payments (Jo 24 Oct 2026, decisions 139/140/141; decision 302 25 Oct: the safety check amount is the quote's PIESA
// line — callers pass it as `safetyCheckCents`; 349 below is only the HIV-electrician default). Pure rules only – no
// database, no Xero, no dates from the clock.
//
// Money: ONE full Xero invoice per accepted quote (xero.core / invoice.lifecycle). Every payment step below is paid
// AGAINST THAT SAME INVOICE; nothing here creates a second invoice. A step is "paid" when the cumulative amount
// received on the invoice reaches the step's running threshold. Xero is the system of record; card (Stripe) payments
// count until Xero shows the same money (`reconciledPaidCents`, audit F01). The office never types a payment in
// (decision 368): payments arrive only from Xero and Stripe.
//
// How owners pay (decision 140 — the RBA bans card surcharges from 1 July 2026, so a card fee is NEVER shown):
//   • $349 safety check at acceptance: card (fee absorbed by Home Insulation Victoria) or bank transfer / PayID.
//   • Electrical fixes at approval (decision 141): card or bank transfer / PayID, so fixes are never delayed.
//   • 10% install deposit, balance on install day, pay in full: BANK TRANSFER / PayID ONLY — no card offered.
// Card (decision 144) = Stripe Checkout for exactly the step amount (stripe.core.ts); Xero stays the invoice,
// bank-transfer reference and reconciliation side. All amounts are integer cents.

import { melbourneAt, melbourneYmd } from "./piesa-windows.core";

export const PAYMENT_DECISION = "Jo 24 Oct 2026 (decisions 139, 140, 141, 144)";
export const SAFETY_CHECK_CENTS = 34_900;
export const INSTALL_DEPOSIT_RATE = 0.10;
export const PROVISIONAL_HOLD_HOURS = 48;
export const PROVISIONAL_HOLD_MS = PROVISIONAL_HOLD_HOURS * 3_600_000;

export type PaymentStepKey = "safety_check" | "fixes" | "install_deposit" | "balance";
export const PAYMENT_STEP_ORDER: PaymentStepKey[] = ["safety_check", "fixes", "install_deposit", "balance"];
export const PAYMENT_STEP_LABEL: Record<PaymentStepKey, string> = {
  safety_check: "Pre Insulation Electrical Safety Assessment (PIESA) fee",
  fixes: "Electrical fixes",
  install_deposit: "Install deposit (10%)",
  balance: "Balance (install day)",
};
export type PaymentMethod = "card" | "bank";

export const toCents = (n: number | string | null | undefined) => Math.round(Number(n ?? 0) * 100);
export const fromCents = (c: number) => c / 100;
export const aud = (c: number) => `$${(c / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const roundHalfUp = (n: number) => Math.floor(n + 0.5);

export type PaymentPlanInput = {
  /** Accepted quote total inc GST, AFTER the VEU rebate (what the owner pays). */
  quoteTotalCents: number;
  /** workflow_settings.safety_check_payment_inc_gst in cents; defaults to $349. */
  safetyCheckCents?: number | null;
  /** Approved electrical fixes (rectification) total inc GST, 0 when none. */
  fixesCents?: number | null;
};
export type PaymentPlan = {
  quoteTotalCents: number; safetyCheckCents: number; fixesCents: number; installDepositCents: number; balanceCents: number;
  /** Everything the owner pays across the job: quote total + fixes. */
  grandTotalCents: number;
  /** Running thresholds in PAYMENT_STEP_ORDER; a step is paid when cumulative received ≥ its threshold. */
  thresholds: Record<PaymentStepKey, number>;
};

/** The amount maths. Deposit = 10% of (quote total after rebate − safety check), rounded half up to the cent. */
export function paymentPlan(i: PaymentPlanInput): PaymentPlan {
  const quoteTotalCents = Math.max(0, Math.round(i.quoteTotalCents));
  const safetyCheckCents = Math.min(Math.max(0, Math.round(i.safetyCheckCents ?? SAFETY_CHECK_CENTS)), quoteTotalCents);
  const fixesCents = Math.max(0, Math.round(i.fixesCents ?? 0));
  const remaining = quoteTotalCents - safetyCheckCents;
  const installDepositCents = roundHalfUp(remaining * INSTALL_DEPOSIT_RATE);
  const balanceCents = remaining - installDepositCents;
  const grandTotalCents = quoteTotalCents + fixesCents;
  const thresholds = {
    safety_check: safetyCheckCents,
    fixes: safetyCheckCents + fixesCents,
    install_deposit: safetyCheckCents + fixesCents + installDepositCents,
    balance: grandTotalCents,
  };
  return { quoteTotalCents, safetyCheckCents, fixesCents, installDepositCents, balanceCents, grandTotalCents, thresholds };
}

export const stepAmountCents = (p: PaymentPlan, k: PaymentStepKey) =>
  k === "safety_check" ? p.safetyCheckCents : k === "fixes" ? p.fixesCents : k === "install_deposit" ? p.installDepositCents : p.balanceCents;

/** Decision 140/141: card only for the safety check and the fixes; everything else is bank transfer / PayID only. */
export function paymentMethodsFor(step: PaymentStepKey): PaymentMethod[] {
  return step === "safety_check" || step === "fixes" ? ["card", "bank"] : ["bank"];
}
export const cardAllowedFor = (step: PaymentStepKey) => paymentMethodsFor(step).includes("card");

// ---------- Step states (idempotent: derived only from facts, so recomputing never changes history) ----------
export type PaymentStepState = "not_yet" | "requested" | "paid" | "overdue" | "waived";
export type PaymentStepFacts = {
  /** When the step became payable (acceptance, fixes approval, install booked, install completed). Null = not yet. */
  requestedAt: string | null;
  /** When it falls overdue if unpaid (e.g. booking + 48h for the deposit, install day for the balance). */
  dueAt?: string | null;
  /** An audited office override that waives this step (deposit-gate override waives the safety check). */
  waived?: boolean;
};
export type PaymentStep = {
  key: PaymentStepKey; label: string; amountCents: number; thresholdCents: number; state: PaymentStepState;
  methods: PaymentMethod[]; requestedAt: string | null; dueAt: string | null;
  /** Still owing on this step (0 once paid/waived). */
  outstandingCents: number;
};

export function stepState(f: { thresholdCents: number; amountCents: number; paidCents: number; facts: PaymentStepFacts; nowIso: string }): PaymentStepState {
  if (f.amountCents <= 0) return "paid"; // nothing to pay (no fixes, or a tiny quote) – never blocks
  if (f.paidCents >= f.thresholdCents) return "paid";
  if (f.facts.waived) return "waived";
  if (!f.facts.requestedAt) return "not_yet";
  if (f.facts.dueAt && Date.parse(f.facts.dueAt) < Date.parse(f.nowIso)) return "overdue";
  return "requested";
}

export function paymentSteps(plan: PaymentPlan, paidCents: number, facts: Partial<Record<PaymentStepKey, PaymentStepFacts>>, nowIso: string): PaymentStep[] {
  const paid = Math.max(0, Math.round(paidCents));
  return PAYMENT_STEP_ORDER.filter((k) => k !== "fixes" || plan.fixesCents > 0).map((key) => {
    const f = facts[key] ?? { requestedAt: null };
    const amountCents = stepAmountCents(plan, key);
    const thresholdCents = plan.thresholds[key];
    const state = stepState({ thresholdCents, amountCents, paidCents: paid, facts: f, nowIso });
    const outstandingCents = state === "paid" || state === "waived" ? 0 : Math.max(0, Math.min(amountCents, thresholdCents - paid));
    return { key, label: PAYMENT_STEP_LABEL[key], amountCents, thresholdCents, state, methods: paymentMethodsFor(key), requestedAt: f.requestedAt, dueAt: f.dueAt ?? null, outstandingCents };
  });
}

/** Decision 355: WHEN a step was paid — the payment that took the cumulative total (in paid-at order) to the step's
 *  threshold. `fallback` covers money the Xero mirror shows (invoices.total_paid) without ledger rows. Null = not paid
 *  (or nothing to pay for that step). */
export function stepPaidAt(plan: PaymentPlan, key: PaymentStepKey, records: { amountCents: number; paidAt: string }[], fallback?: { paidCents: number; at: string | null } | null): string | null {
  if (stepAmountCents(plan, key) <= 0) return null;
  const threshold = plan.thresholds[key];
  let sum = 0;
  for (const r of [...records].sort((a, b) => a.paidAt.localeCompare(b.paidAt))) {
    sum += Math.max(0, Math.round(r.amountCents));
    if (sum >= threshold) return r.paidAt;
  }
  return fallback && fallback.at && Math.round(fallback.paidCents) >= threshold ? fallback.at : null;
}

/** Decision 366 / audit F03: the fixes amount the owner pays as its OWN step. Only a fixes (rectification) quote accepted
 *  AFTER the installation quote counts — in the old model the fixes lines were folded into a later installation quote
 *  (so the invoice total already holds them) and counting the fixes quote too would charge them twice. */
export function fixesCountedCents(f: { rectTotalCents: number | null | undefined; rectAcceptedAt: string | null | undefined; installAcceptedAt: string | null | undefined }): number {
  if (!f.rectAcceptedAt || !(Number(f.rectTotalCents) > 0)) return 0;
  if (f.installAcceptedAt && Date.parse(f.rectAcceptedAt) < Date.parse(f.installAcceptedAt)) return 0;
  return Math.round(Number(f.rectTotalCents));
}
/** Audit R07: the plan's quote part. Once the approved fixes are on the ONE Xero invoice (`xero-repairs.core`), the
 *  invoice total is quote + fixes; the plan keeps the accepted installation quote as its quote part so the fixes are
 *  counted once and the plan's grand total equals the Xero invoice total. Otherwise the invoice total, as before. */
export function planQuoteTotalCents(f: { invoiceTotalCents: number; quoteTotalCents: number | null | undefined; fixesCents: number }): number {
  const q = f.quoteTotalCents == null ? null : Math.round(f.quoteTotalCents);
  if (f.fixesCents > 0 && q != null && Math.round(f.invoiceTotalCents) === q + Math.round(f.fixesCents)) return q;
  return Math.round(f.invoiceTotalCents);
}

/** Jo 26 Oct 2026: the install is booked only once the 10% install deposit (10% of the install price — never the PIESA
 *  fee or the fixes) is paid. No "book first, pay within 48 hours". The PIESA fee alone never unlocks the install. */
export const INSTALL_DEPOSIT_BLOCKER = "The 10% install deposit must be paid before the install is booked.";
/** Stages where the install is the next thing to book, so the 10% deposit is due now. */
export const INSTALL_DEPOSIT_DUE_STAGES: ReadonlySet<string> = new Set(["piesa_complete", "installation_scheduling", "installation_booked"]);
export function installDepositBlocker(plan: Pick<PaymentPlan, "installDepositCents">, steps: PaymentStep[]): string | null {
  if (plan.installDepositCents <= 0) return null;
  return isStepCleared(steps, "install_deposit") ? null : INSTALL_DEPOSIT_BLOCKER;
}

/** Decision 366: the fixes visit is booked only once the fixes are paid in full (card or bank transfer). */
export const FIXES_NOT_PAID_BLOCKER = "The electrical fixes must be paid in full before the fixes visit is booked.";
export function fixesPaymentBlocker(plan: Pick<PaymentPlan, "fixesCents">, steps: PaymentStep[]): string | null {
  if (plan.fixesCents <= 0) return null;
  return isStepCleared(steps, "fixes") ? null : FIXES_NOT_PAID_BLOCKER;
}

/**
 * Review R08 / audit F14 (decision 314 follow-up): the "electrician on site at the start of the install day" exception
 * clears the job for install coordination only once the FULL accepted onsite electrical (fixes) charge has been
 * received on top of the safety check payment — the same cumulative threshold as the fixes step (`thresholds.fixes`).
 * The generic payment gate (which clears on the safety check payment alone) is never enough on its own. Fails closed:
 * no accepted charge, no invoice or no money = not paid. Amounts are read, never changed.
 */
export const ONSITE_CHARGE_NOT_PAID = "Waiting for the owner's payment for the electrician on site at the start of the install day.";
export function onsiteChargePaid(i: { quoteTotalCents: number | null | undefined; safetyCheckCents: number; rectTotalCents: number | null | undefined; paidCents: number }): boolean {
  const rect = Math.round(Number(i.rectTotalCents ?? 0));
  if (!(rect > 0) || !(Number(i.quoteTotalCents ?? 0) > 0)) return false;
  const plan = paymentPlan({ quoteTotalCents: Number(i.quoteTotalCents), safetyCheckCents: i.safetyCheckCents, fixesCents: rect });
  return Math.round(i.paidCents) >= plan.thresholds.fixes;
}

export const isStepPaid = (steps: PaymentStep[], key: PaymentStepKey) => (steps.find((s) => s.key === key)?.state ?? "not_yet") === "paid";
export const isStepCleared = (steps: PaymentStep[], key: PaymentStepKey) => ["paid", "waived"].includes(steps.find((s) => s.key === key)?.state ?? "not_yet");

/** What is payable right now: the earliest requested/overdue step, plus "pay in full" (always allowed). */
export function payableNow(plan: PaymentPlan, steps: PaymentStep[], paidCents: number) {
  const due = steps.find((s) => s.state === "requested" || s.state === "overdue") ?? null;
  const remainingCents = Math.max(0, plan.grandTotalCents - Math.max(0, Math.round(paidCents)));
  return { step: due, dueNowCents: due ? due.outstandingCents : 0, remainingCents, cardAvailable: !!due && cardAllowedFor(due.key) };
}

// ---------- Provisional install booking (decision 367: 48h, or noon the day before the install if sooner) ----------
/** Decision 367 (Jo 25 Oct 2026, "48h or noon day before"): the 10% deposit hold ends at 12:00 Melbourne the day before. */
export const DEPOSIT_DEADLINE_HOUR = 12;
export const INSTALL_DEPOSIT_NOT_PAID = "Install deposit not paid";
const ymdMinus1 = (ymd: string) => { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
/** Noon Melbourne on the day before the install start. */
export const depositDeadlineBeforeStart = (installStartIso: string) => melbourneAt(ymdMinus1(melbourneYmd(new Date(installStartIso))), DEPOSIT_DEADLINE_HOUR).toISOString();
/** When an unpaid provisional booking is released: min(booked + 48h, noon Melbourne the day before the install). Without
 *  a start (older callers) it is booked + 48h. A booking made after that noon expires at once unless the deposit is in. */
export function provisionalHoldExpiresAt(bookedAtIso: string, installStartIso?: string | null): string {
  const hold = Date.parse(bookedAtIso) + PROVISIONAL_HOLD_MS;
  if (!installStartIso) return new Date(hold).toISOString();
  return new Date(Math.min(hold, Date.parse(depositDeadlineBeforeStart(installStartIso)))).toISOString();
}
export type ProvisionalDecision = "confirmed" | "provisional" | "release" | "not_applicable";
/** Booking stays provisional until the deposit step is paid; unpaid at the hold expiry → release. Jobs outside the payment rule are untouched. */
export function provisionalBookingDecision(f: { bookedAt: string | null; now: string; depositCleared: boolean; gateEnabled: boolean; hasInvoice: boolean; installStart?: string | null }): ProvisionalDecision {
  if (!f.bookedAt || !f.gateEnabled || !f.hasInvoice) return "not_applicable";
  if (f.depositCleared) return "confirmed";
  return Date.parse(f.now) >= Date.parse(provisionalHoldExpiresAt(f.bookedAt, f.installStart)) ? "release" : "provisional";
}
/** What the 15-minute sweep does with one confirmed install booking (decision 367). An unpaid booking whose start has
 *  already passed is never silently skipped or released mid-job: the office gets ONE Needs me row. */
export function depositSweepAction(f: { decision: ProvisionalDecision; installStart: string; now: string }): "release" | "office_alert" | "none" {
  if (f.decision !== "release") return "none";
  return Date.parse(f.installStart) > Date.parse(f.now) ? "release" : "office_alert";
}
/** Pre-start fact (decision 367): the install cannot start while the deposit for this booking is unpaid. */
export const installDepositPrestartBlocker = (decision: ProvisionalDecision | null | undefined): string | null =>
  decision === "provisional" || decision === "release" ? INSTALL_DEPOSIT_NOT_PAID : null;

// ---------- Ledger (append-only payment records → cumulative) ----------
// Audit F01: the ledger holds Xero payments (one per PaymentID), card payments (one per Stripe PaymentIntent) and old
// office records. A card payment that later lands in Xero arrives as a NEW Xero PaymentID for the SAME money, and a Xero
// payment can be deleted/voided after it was recorded. So the amount received is never the plain ledger sum (and never
// max(Xero, ledger)): it is `reconciledPaidCents` — Xero's live payments + card/office records not yet matched in Xero.
// Audit R02: a card row matches a Xero payment only by Stripe receipt identity, never by amount/date alone. A Stripe
// refund is an `owner_payment_reversed` row with source card (one per cumulative refunded amount).
export type PaymentSource = "xero" | "bank" | "card" | "manual";
export type PaymentRecord = {
  amountCents: number; source: PaymentSource; paidAt: string; xeroPaymentId?: string | null; recordedBy?: string | null; note?: string | null;
  /** "reversal" = an `owner_payment_reversed` row: the Xero payment with this id was deleted/voided/removed in Xero, or
   *  (source card) a Stripe refund of the card payment with these Stripe ids. */
  kind?: "payment" | "reversal";
  /** Xero payment Reference (as Xero returned it) — used to match card payments by their Stripe id. */
  reference?: string | null;
  /** Stripe ids for a card payment (PaymentIntent, charge, session) — a Xero payment whose Reference holds one is the same money. */
  stripeIds?: string[] | null;
  /** Stripe refund rows: Stripe's cumulative refunded amount for the PaymentIntent at that delivery. */
  refundedTotalCents?: number | null;
};
/** One `owner_payment_recorded` / `owner_payment_reversed` workflow event → ledger record (pure; shared by every reader). */
export function ledgerRecordFromEvent(eventType: string, createdAt: string, actorId: string | null, d: Record<string, unknown> | null | undefined): PaymentRecord {
  const det = d ?? {};
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const note = str(det["note"]);
  const stripeIds = [str(det["stripe_payment_intent"]), str(det["stripe_charge"]), str(det["stripe_session"]), note?.startsWith("stripe:") ? note.slice(7) : null].filter((x): x is string => !!x);
  return {
    amountCents: Number(det["amount_cents"] ?? 0), source: (str(det["source"]) as PaymentSource | null) ?? "manual", paidAt: String(det["paid_at"] ?? createdAt),
    xeroPaymentId: str(det["xero_payment_id"]), recordedBy: actorId, note, kind: eventType === "owner_payment_reversed" ? "reversal" : "payment",
    reference: str(det["xero_reference"]), stripeIds: stripeIds.length ? [...new Set(stripeIds)] : null,
    ...(det["refunded_total_cents"] != null ? { refundedTotalCents: Number(det["refunded_total_cents"]) } : {}),
  };
}
/** Payments minus reversals (never below 0). Reversal rows carry the reversed payment's positive amount. */
export const cumulativePaidCents = (records: { amountCents: number; kind?: "payment" | "reversal" }[]) =>
  Math.max(0, records.reduce((s, r) => s + (r.kind === "reversal" ? -1 : 1) * Math.max(0, Math.round(r.amountCents)), 0));

export type XeroPaymentFact = { paymentId: string | null; amountCents: number; paidAt: string; reference?: string | null; status?: string | null };
export type XeroPaymentInput = { PaymentID?: string; Amount?: number; Date?: string; Status?: string; Reference?: string };
const XERO_DEAD = new Set(["DELETED", "VOIDED"]);
const isLiveXero = (p: { Status?: string; Amount?: number }) => !XERO_DEAD.has(String(p.Status ?? "").toUpperCase()) && Number(p.Amount ?? 0) > 0;
export const xeroPaymentFacts = (xero: XeroPaymentInput[]): XeroPaymentFact[] =>
  xero.map((p) => ({ paymentId: p.PaymentID ?? null, amountCents: toCents(p.Amount), paidAt: xeroDateIso(p.Date), reference: p.Reference ?? null, status: p.Status ?? null }));
const liveXero = (xero: XeroPaymentFact[]) => xero.filter((p) => !XERO_DEAD.has(String(p.status ?? "").toUpperCase()) && p.amountCents > 0);

/** Audit R02 (25 Oct 2026): same amount within this many days is only a CANDIDATE pair, never proof of one receipt. A card
 *  row and a Xero payment are the same money only when the Xero Reference holds one of the card's Stripe ids; an
 *  identity-less same-amount pair is counted as TWO payments and raised for the office (`unclear`). Legacy office rows
 *  (source bank/manual — typed copies of money Xero holds, decision 368 stopped new ones) keep the amount/date match. */
export const RECONCILE_WINDOW_DAYS = 10;
const RECONCILE_WINDOW_MS = RECONCILE_WINDOW_DAYS * 86_400_000;
const usableIds = (r: PaymentRecord) => (r.stripeIds ?? []).filter((x) => !!x && x.length >= 6);
const refHolds = (p: XeroPaymentFact, ids: string[]) => !!p.reference && ids.some((id) => p.reference!.includes(id));
const withinWindow = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= RECONCILE_WINDOW_MS;

/** Receipt identity written on every ledger row (`details.receipt_key`) — unique in the database (pending migration
 *  payment-receipt-once.sql), so two concurrent deliveries of one receipt can never both be recorded (audit R06). */
export const stripeReceiptKey = (paymentKey: string) => `stripe:${paymentKey}`;
/** One Stripe refund state per PaymentIntent: the cumulative amount refunded (Stripe's `amount_refunded`). */
export const stripeRefundReceiptKey = (paymentKey: string, cumulativeRefundedCents: number) => `stripe-refund:${paymentKey}:${Math.round(cumulativeRefundedCents)}`;
export const xeroReceiptKey = (invoiceId: string, xeroPaymentId: string) => `xero:${invoiceId}:${xeroPaymentId}`;
export const xeroReversalReceiptKey = (invoiceId: string, xeroPaymentId: string) => `xero-reversal:${invoiceId}:${xeroPaymentId}`;

/** Refunded so far for these refund rows: Stripe reports a CUMULATIVE amount, so the highest recorded state wins (order
 *  and concurrent deliveries of different states never add up twice); rows without that state add their amount. */
const refundStateCents = (refunds: PaymentRecord[]) => Math.max(
  refunds.reduce((m, x) => Math.max(m, Math.round(Number(x.refundedTotalCents ?? 0))), 0),
  refunds.filter((x) => x.refundedTotalCents == null).reduce((s, x) => s + Math.max(0, Math.round(x.amountCents)), 0));
/** Card refunds (`owner_payment_reversed` rows with source card) already recorded against a card row's Stripe ids. */
function refundedCents(r: PaymentRecord, ledger: PaymentRecord[]): number {
  const ids = usableIds(r);
  if (!ids.length) return 0;
  const refunds = ledger.filter((x) => x.kind === "reversal" && x.source === "card" && usableIds(x).some((id) => ids.includes(id)));
  return Math.min(Math.max(0, Math.round(r.amountCents)), refundStateCents(refunds));
}
/** How much of a Stripe receipt is already recorded as refunded (for the next `charge.refunded` delivery). */
export const stripeRefundedSoFarCents = (ledger: PaymentRecord[], paymentKey: string) =>
  refundStateCents(ledger.filter((x) => x.kind === "reversal" && x.source === "card" && (x.stripeIds ?? []).includes(paymentKey)));

export type UnclearPaymentPair<T> = { record: T; xero: XeroPaymentFact };

/** Pure: which card/office records are already in Xero.
 *  1. Exact: the Xero payment Reference holds one of the record's Stripe ids (PaymentIntent / charge / session).
 *  2. Legacy office rows only (no receipt identity exists for them): same amount within 10 days, closest date first.
 *  Each Xero payment claims at most one record. A card row with no identity match is NOT merged with a same-amount Xero
 *  payment: both count, and the pair is returned in `unclear` for the office to settle in Xero (audit R02).
 *  A card row's Stripe refunds reduce it while it is unmatched; once Xero holds that money Xero is the record. */
export function reconcilePayments<T extends PaymentRecord>(ledger: T[], xeroPayments: XeroPaymentFact[]) {
  const live = liveXero(xeroPayments);
  const xeroCents = live.reduce((s, p) => s + p.amountCents, 0);
  const others = ledger.filter((r) => r.source !== "xero" && r.kind !== "reversal" && r.amountCents > 0);
  const claimed = new Set<number>();
  const matched = new Map<T, XeroPaymentFact>();
  for (const r of others) {
    const ids = usableIds(r);
    if (!ids.length) continue;
    const i = live.findIndex((p, k) => !claimed.has(k) && refHolds(p, ids));
    if (i >= 0) { claimed.add(i); matched.set(r, live[i]!); }
  }
  // A Xero payment whose Reference names ANY recorded Stripe receipt belongs to that receipt, never to another row.
  const allIds = others.flatMap(usableIds);
  const closest = (r: T, skip: Set<number>) => {
    let best = -1, bestGap = Infinity;
    live.forEach((p, k) => {
      if (claimed.has(k) || skip.has(k) || p.amountCents !== Math.round(r.amountCents) || refHolds(p, allIds) || !withinWindow(p.paidAt, r.paidAt)) return;
      const gap = Math.abs(Date.parse(p.paidAt) - Date.parse(r.paidAt));
      if (gap < bestGap) { best = k; bestGap = gap; }
    });
    return best;
  };
  for (const r of others) {
    if (matched.has(r) || r.source === "card" || usableIds(r).length) continue;
    const best = closest(r, claimed);
    if (best >= 0) { claimed.add(best); matched.set(r, live[best]!); }
  }
  const unclear: UnclearPaymentPair<T>[] = [];
  const reported = new Set<number>();
  for (const r of others) {
    if (matched.has(r) || r.source !== "card") continue;
    const best = closest(r, reported);
    if (best >= 0) { reported.add(best); unclear.push({ record: r, xero: live[best]! }); }
  }
  const netCents = new Map<T, number>();
  for (const r of others) if (!matched.has(r)) netCents.set(r, Math.max(0, Math.round(r.amountCents) - refundedCents(r, ledger)));
  const unmatched = others.filter((r) => !matched.has(r) && (netCents.get(r) ?? 0) > 0);
  const paidCents = xeroCents + unmatched.reduce((s, r) => s + (netCents.get(r) ?? 0), 0);
  return { paidCents, xeroCents, unmatched, matched, unclear, netCents };
}
/** The amount truly received on the invoice: Xero's live payments + card/office records not yet matched in Xero. */
export const reconciledPaidCents = (ledger: PaymentRecord[], xeroPayments: XeroPaymentFact[]) => reconcilePayments(ledger, xeroPayments).paidCents;

/** Xero payments already in the ledger, minus those reversed — the ledger's own view of Xero (no network call). One per
 *  PaymentID even if an older race recorded a payment twice. */
export function ledgerXeroPayments(ledger: PaymentRecord[]): XeroPaymentFact[] {
  const reversed = new Set(ledger.filter((r) => r.kind === "reversal" && r.source === "xero" && r.xeroPaymentId).map((r) => r.xeroPaymentId as string));
  const seen = new Set<string>();
  return ledger.filter((r) => {
    if (r.source !== "xero" || r.kind === "reversal" || (r.xeroPaymentId && reversed.has(r.xeroPaymentId))) return false;
    if (!r.xeroPaymentId) return true;
    if (seen.has(r.xeroPaymentId)) return false;
    seen.add(r.xeroPaymentId);
    return true;
  }).map((r) => ({ paymentId: r.xeroPaymentId ?? null, amountCents: Math.round(r.amountCents), paidAt: r.paidAt, reference: r.reference ?? null, status: null }));
}
/** The ledger as money actually received: live Xero rows + card/office rows not matched in Xero (net of card refunds).
 *  No reversal rows, no duplicates — so `cumulativePaidCents`/`stepPaidAt` over it equal `reconciledPaidCents` against
 *  the ledger's Xero view. */
export function effectiveLedger<T extends PaymentRecord>(ledger: T[]): T[] {
  const xero = ledgerXeroPayments(ledger);
  const { unmatched, netCents } = reconcilePayments(ledger, xero);
  const keep = new Set<T>(unmatched);
  const seenXero = new Set<string>();
  const liveIds = new Set(xero.map((p) => p.paymentId));
  const out: T[] = [];
  for (const r of ledger) {
    if (r.kind === "reversal") continue;
    if (r.source === "xero") {
      if (!liveIds.has(r.xeroPaymentId ?? null)) continue;
      if (r.xeroPaymentId) { if (seenXero.has(r.xeroPaymentId)) continue; seenXero.add(r.xeroPaymentId); }
      out.push(r);
    } else if (keep.has(r)) {
      const net = netCents.get(r) ?? Math.round(r.amountCents);
      out.push(net === Math.round(r.amountCents) ? r : { ...r, amountCents: net });
    }
  }
  return out;
}

/** Xero payments not yet in the ledger (by PaymentID). Idempotent: re-running with the same input returns nothing new. */
export function newXeroPayments(knownIds: Iterable<string>, xero: XeroPaymentInput[]) {
  const known = new Set(knownIds);
  return xero.filter((p) => p.PaymentID && !known.has(p.PaymentID) && isLiveXero(p))
    .map((p) => ({ xeroPaymentId: p.PaymentID as string, amountCents: toCents(p.Amount), paidAt: xeroDateIso(p.Date), reference: p.Reference ?? null }));
}
/** Recorded Xero payments that Xero no longer shows as live (DELETED/VOIDED or gone from the invoice) and that have no
 *  reversal yet. Only call with the invoice's FULL Payments list. Idempotent: once reversed, never again. */
export function xeroReversals(ledger: PaymentRecord[], xero: XeroPaymentInput[]): { xeroPaymentId: string; amountCents: number; paidAt: string }[] {
  const live = new Set(xero.filter((p) => p.PaymentID && isLiveXero(p)).map((p) => p.PaymentID as string));
  const reversed = new Set(ledger.filter((r) => r.kind === "reversal" && r.xeroPaymentId).map((r) => r.xeroPaymentId as string));
  return ledger.filter((r) => r.source === "xero" && r.kind !== "reversal" && r.xeroPaymentId && !live.has(r.xeroPaymentId) && !reversed.has(r.xeroPaymentId))
    .map((r) => ({ xeroPaymentId: r.xeroPaymentId as string, amountCents: Math.round(r.amountCents), paidAt: r.paidAt }));
}
export function xeroDateIso(d?: string): string {
  if (!d) return new Date(0).toISOString();
  const m = /\/Date\((\d+)/.exec(d);
  const t = m ? Number(m[1]) : Date.parse(d);
  return new Date(Number.isFinite(t) ? t : 0).toISOString();
}

// ---------- Bank details (TO CONFIRM with Jo; never invent numbers) ----------
export type BankDetails = { accountName: string; bsb: string | null; accountNumber: string | null; payId: string | null; configured: boolean };
export const BANK_DETAILS_TO_CONFIRM: BankDetails = { accountName: "DC Construction Solutions Pty Ltd T/A Home Insulation Victoria", bsb: null, accountNumber: null, payId: null, configured: false };
/** Jo 24 Oct 2026 (decision 152): the business account owners pay into (NAB). No PayID yet. Env vars may override. */
export const HIV_BANK_DETAILS: BankDetails = { accountName: "Home Insulation Victoria", bsb: "082-902", accountNumber: "777966349", payId: null, configured: true };
export const formatBsb = (bsb: string) => bsb.replace(/\D/g, "").replace(/^(\d{3})(\d{3})$/, "$1-$2");
/** Lines for pages and emails. Unconfigured details say so instead of showing blanks. */
export function bankDetailLines(b: BankDetails, reference: string | null): string[] {
  if (!b.configured || (!b.bsb && !b.payId)) return ["Bank details: we'll send these with your invoice (to be confirmed)."];
  const out = [`Account name: ${b.accountName}`];
  if (b.bsb && b.accountNumber) out.push(`BSB ${formatBsb(b.bsb)} · Account ${b.accountNumber}`);
  if (b.payId) out.push(`PayID: ${b.payId}`);
  if (reference) out.push(`Reference: ${reference}`);
  return out;
}

// ---------- Plain-English payment lines (decision 140: never mention a card fee) ----------
export const PAY_LINE_SAFETY_CHECK = "$349 by card or bank transfer — no fee";
export const PAY_LINE_FIXES = "Pay by card or bank transfer — no fee";
export const PAY_LINE_BANK_ONLY = "Bank transfer or PayID";
export const PAY_LINE_HOW = "Pay by card or bank transfer — no fee either way";

/** "Reference HV-0123" style tail for bank-only steps. */
export function paymentLine(step: PaymentStepKey, reference: string | null, safetyCheckCents = SAFETY_CHECK_CENTS): string {
  const ref = reference ? `, reference ${reference}` : "";
  if (step === "safety_check") return safetyCheckCents === SAFETY_CHECK_CENTS ? PAY_LINE_SAFETY_CHECK : `${aud(safetyCheckCents)} by card or bank transfer — no fee`;
  if (step === "fixes") return PAY_LINE_FIXES;
  return `${PAY_LINE_BANK_ONLY}${ref}`;
}

/** The "How you can pay" summary on the quote / acceptance page. */
export function howYouPayLines(plan: PaymentPlan): string[] {
  return [
    `${aud(plan.safetyCheckCents)} now for the electrical safety check (card or bank transfer, no fee)`,
    `${aud(plan.installDepositCents)} deposit (10% of the install price) before your install day can be booked, by bank transfer or PayID`,
    `${aud(plan.balanceCents)} on install day, by bank transfer or PayID`,
    `Or pay the full ${aud(plan.quoteTotalCents)} any time by bank transfer or PayID`,
  ];
}

/** Final-invoice / completion email footer line (replaces the retired "card fee shown" wording). */
export const FINAL_INVOICE_PAY_LINE = "Pay your balance by bank transfer or PayID using the reference on your invoice · Invoice PDF attached";

/** The owner's "pay now" block for the step that is due. Card (Stripe Checkout, decision 144) only where card is allowed
 *  (decisions 140/141) AND Stripe is available for this job; bank details always. Never a card fee. */
export function payNowBlock(i: { step: PaymentStep | null; cardAvailable: boolean; bank: BankDetails; reference: string | null; remainingCents: number }) {
  if (!i.step) return i.remainingCents > 0
    ? { title: "Nothing due right now", amountCents: 0, card: false, lines: [`You can pay the remaining ${aud(i.remainingCents)} any time by bank transfer or PayID.`, ...bankDetailLines(i.bank, i.reference)] }
    : { title: "All paid — thank you", amountCents: 0, card: false, lines: [] as string[] };
  return {
    title: `${i.step.label}: ${aud(i.step.outstandingCents)} due now`,
    amountCents: i.step.outstandingCents,
    card: cardAllowedFor(i.step.key) && i.cardAvailable,
    lines: [paymentLine(i.step.key, i.reference, i.step.key === "safety_check" ? i.step.amountCents : SAFETY_CHECK_CENTS), ...bankDetailLines(i.bank, i.reference)],
  };
}
