// Owner payments (Jo 24 Oct 2026, decisions 139/140/141). Pure rules only – no database, no Xero, no dates from the clock.
//
// Money: ONE full Xero invoice per accepted quote (xero.core / invoice.lifecycle). Every payment step below is paid
// AGAINST THAT SAME INVOICE; nothing here creates a second invoice. A step is "paid" when the cumulative amount
// received on the invoice reaches the step's running threshold. Xero is the system of record; the office may record a
// bank transfer it has seen (manual), and the next Xero sync reconciles.
//
// How owners pay (decision 140 — the RBA bans card surcharges from 1 July 2026, so a card fee is NEVER shown):
//   • $349 safety check at acceptance: card (fee absorbed by Home Insulation Victoria) or bank transfer / PayID.
//   • Electrical fixes at approval (decision 141): card or bank transfer / PayID, so fixes are never delayed.
//   • 10% install deposit, balance on install day, pay in full: BANK TRANSFER / PayID ONLY — no card offered.
// Card (decision 144) = Stripe Checkout for exactly the step amount (stripe.core.ts); Xero stays the invoice,
// bank-transfer reference and reconciliation side. All amounts are integer cents.

export const PAYMENT_DECISION = "Jo 24 Oct 2026 (decisions 139, 140, 141, 144)";
export const SAFETY_CHECK_CENTS = 34_900;
export const INSTALL_DEPOSIT_RATE = 0.10;
export const PROVISIONAL_HOLD_HOURS = 48;
export const PROVISIONAL_HOLD_MS = PROVISIONAL_HOLD_HOURS * 3_600_000;

export type PaymentStepKey = "safety_check" | "fixes" | "install_deposit" | "balance";
export const PAYMENT_STEP_ORDER: PaymentStepKey[] = ["safety_check", "fixes", "install_deposit", "balance"];
export const PAYMENT_STEP_LABEL: Record<PaymentStepKey, string> = {
  safety_check: "Pre Insulation Electrical Safety Assessment (PIESA) payment",
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

export const isStepPaid = (steps: PaymentStep[], key: PaymentStepKey) => (steps.find((s) => s.key === key)?.state ?? "not_yet") === "paid";
export const isStepCleared = (steps: PaymentStep[], key: PaymentStepKey) => ["paid", "waived"].includes(steps.find((s) => s.key === key)?.state ?? "not_yet");

/** What is payable right now: the earliest requested/overdue step, plus "pay in full" (always allowed). */
export function payableNow(plan: PaymentPlan, steps: PaymentStep[], paidCents: number) {
  const due = steps.find((s) => s.state === "requested" || s.state === "overdue") ?? null;
  const remainingCents = Math.max(0, plan.grandTotalCents - Math.max(0, Math.round(paidCents)));
  return { step: due, dueNowCents: due ? due.outstandingCents : 0, remainingCents, cardAvailable: !!due && cardAllowedFor(due.key) };
}

// ---------- Provisional install booking (48h) ----------
export const provisionalHoldExpiresAt = (bookedAtIso: string) => new Date(Date.parse(bookedAtIso) + PROVISIONAL_HOLD_MS).toISOString();
export type ProvisionalDecision = "confirmed" | "provisional" | "release" | "not_applicable";
/** Booking stays provisional until the deposit step is paid; unpaid after 48h → release. Jobs outside the payment rule are untouched. */
export function provisionalBookingDecision(f: { bookedAt: string | null; now: string; depositCleared: boolean; gateEnabled: boolean; hasInvoice: boolean }): ProvisionalDecision {
  if (!f.bookedAt || !f.gateEnabled || !f.hasInvoice) return "not_applicable";
  if (f.depositCleared) return "confirmed";
  return Date.parse(f.now) >= Date.parse(provisionalHoldExpiresAt(f.bookedAt)) ? "release" : "provisional";
}

// ---------- Ledger (append-only payment records → cumulative) ----------
export type PaymentSource = "xero" | "bank" | "card" | "manual";
export type PaymentRecord = { amountCents: number; source: PaymentSource; paidAt: string; xeroPaymentId?: string | null; recordedBy?: string | null; note?: string | null };
export const cumulativePaidCents = (records: { amountCents: number }[]) => records.reduce((s, r) => s + Math.max(0, Math.round(r.amountCents)), 0);
/** Xero payments not yet in the ledger (by PaymentID). Idempotent: re-running with the same input returns nothing new. */
export function newXeroPayments(knownIds: Iterable<string>, xero: { PaymentID?: string; Amount?: number; Date?: string; Status?: string }[]) {
  const known = new Set(knownIds);
  return xero.filter((p) => p.PaymentID && !known.has(p.PaymentID) && p.Status !== "DELETED" && Number(p.Amount ?? 0) > 0)
    .map((p) => ({ xeroPaymentId: p.PaymentID as string, amountCents: toCents(p.Amount), paidAt: xeroDateIso(p.Date) }));
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
    `${aud(plan.installDepositCents)} (10%) to book your install day, by bank transfer or PayID — your day is held for ${PROVISIONAL_HOLD_HOURS} hours while you pay`,
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
