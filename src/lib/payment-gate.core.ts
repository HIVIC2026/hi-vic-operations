// Approved payment-option gate (owner decision 2026-10-03). Pure rules, no database.
// 7 Oct: safety check payment gates PIESA; balance in two halves or paid in full. Replaces deposit tiers and the 3-instalment plan. The database mirrors this in
// docs/pending-migrations/0080_payment_option_gate.sql (required_deposit_amount / invoice_deposit_cleared).
import { WORKFLOW_DECISIONS, depositPctFor } from "@/config/workflow-decisions";

export type PaymentRoute = "hiv_lead" | "installer_supplied" | "unknown";
export type PaymentOption =
  "safety_check_paid" | "deposit_paid" | "paid_in_full" | "instalment_plan_active" | "office_override" | "qa_test_simulated";

export const PAYMENT_RULE_PENDING =
  "Payment rule pending activation – PIESA and scheduling are locked until the approved payment-option gate is switched on.";
/** Jo 7 Oct 6:40pm: payment rule ON for TEST (qa_test) jobs only. Real jobs follow workflow_settings.payment_option_gate_enabled
 *  and stay locked until Jo's lawyer approves the wording and Jo turns it on for everyone. */
export const TEST_JOBS_PAYMENT_GATE_ON = true;
export function paymentGateEnabledFor(f: { globalEnabled: boolean; jobSource: string | null | undefined; qaArchived: boolean }): boolean {
  if (f.globalEnabled) return true;
  return TEST_JOBS_PAYMENT_GATE_ON && f.jobSource === "qa_test" && !f.qaArchived;
}
export const PAYMENT_RULE_EXCEPTION =
  "Payment rule exception – no approved payment rule for this customer source. PIESA and scheduling are blocked until office sets one.";

const cents = (n: number | string) => Math.round(Number(n) * 100);

/** Route from the job's permanent source. Both known routes use the same safety-check rule (Jo 24 Oct); unknown stays blocked. */
export function paymentRouteFor(channel: string | null | undefined): PaymentRoute {
  if (channel === "hivic_sourced") return "hiv_lead";
  if (channel === "installer_sourced") return "installer_supplied";
  return "unknown";
}

/** Safety check (PIESA) payment, Jo 7 Oct. The live amount comes from workflow_settings.safety_check_payment_inc_gst. */
export const SAFETY_CHECK_FEE_DEFAULT = 349;
const feeCents = (fee?: number | string | null) => cents(fee ?? SAFETY_CHECK_FEE_DEFAULT);

/** Upfront amount in cents = the safety check payment (never more than the total). */
export function requiredDepositCents(totalIncGst: number | string, safetyFee?: number | string | null): number {
  return Math.min(feeCents(safetyFee), cents(totalIncGst));
}

/** Balance after the safety check payment, split into two halves. First half rounds DOWN to the cent; second takes the remainder. */
/** Invoice split (Jo 26 Oct 2026: no half-and-half balance, no instalments). The `deposit` field is the PIESA fee
 *  (stored in the invoice's legacy deposit_* columns that mirror Xero) — shown to people as "PIESA fee", never "deposit". */
export function splitForOption(totalIncGst: number | string, safetyFee?: number | string | null) {
  const t = cents(totalIncGst);
  const fee = requiredDepositCents(totalIncGst, safetyFee);
  return { depositPct: t > 0 ? Math.round((fee / t) * 10000) / 10000 : 0, deposit: fee / 100, balance: (t - fee) / 100 };
}

export type RefundOutcome = "none" | "refund_all" | "refund_except_safety_fee" | "keep_safety_fee";
/** Office guidance only; no money moves automatically. */
export function refundOutcome(f: { paidCents: number; safetyFeeCents: number; checkDone: boolean; checkNeverHappening: boolean; canProceed: boolean }): { outcome: RefundOutcome; refundCents: number } {
  if (f.paidCents <= 0) return { outcome: "none", refundCents: 0 };
  if (!f.checkDone && f.checkNeverHappening) return { outcome: "refund_all", refundCents: f.paidCents };
  if (f.checkDone && !f.canProceed) {
    const r = Math.max(0, f.paidCents - f.safetyFeeCents);
    return { outcome: r > 0 ? "refund_except_safety_fee" : "keep_safety_fee", refundCents: r };
  }
  return { outcome: "none", refundCents: 0 };
}
export const REFUND_LABELS: Record<RefundOutcome, string> = {
  none: "No refund due",
  refund_all: "Refund everything paid (Pre Insulation Electrical Safety Assessment (PIESA) never happened)",
  refund_except_safety_fee: "Refund everything except the Pre Insulation Electrical Safety Assessment (PIESA) payment (check done, job can't go ahead)",
  keep_safety_fee: "Keep the Pre Insulation Electrical Safety Assessment (PIESA) payment (check done, job can't go ahead)",
};

/** Retired 3-instalment plan (kept read-only for history). */
export type InstalmentPlan = {
  quote_id: string;
  status: string; // proposed | active | cancelled | failed | overdue | superseded
  instalment_count: number;
  office_approved_at: string | null;
  owner_accepted_at: string | null;
  first_instalment_verified_at: string | null; // verified in Xero
  collection_recorded_at: string | null; // active payment method or approved collection arrangement
};

/** Active only when ALL hold. Office approval alone never clears the gate. */
export function instalmentPlanActive(
  plan: InstalmentPlan | null | undefined,
  currentQuoteId: string,
): boolean {
  return (
    !!plan &&
    plan.quote_id === currentQuoteId &&
    plan.status === "active" &&
    plan.instalment_count === 3 &&
    !!plan.office_approved_at &&
    !!plan.owner_accepted_at &&
    !!plan.first_instalment_verified_at &&
    !!plan.collection_recorded_at
  );
}

export type PaymentGateInput = {
  enabled: boolean;
  route: PaymentRoute;
  currentQuote: { id: string; customer_total_inc_gst: number | string } | null; // owner-approved current confirmed quote
  invoice: { quote_id: string; total_inc_gst: number | string; total_paid: number | string } | null;
  plan: InstalmentPlan | null;
  overrideCount: number; // audited office overrides for this invoice
  /** TEST journeys only: an audited simulated payment for the current quote. Never true for a real job. */
  qaSimulated?: { jobSource: string | null; quoteId: string | null } | null;
  /** workflow_settings.safety_check_payment_inc_gst; defaults to SAFETY_CHECK_FEE_DEFAULT. */
  safetyFeeIncGst?: number | string | null;
};
export type PaymentGateResult =
  { cleared: true; option: PaymentOption } | { cleared: false; blocker: string };

const aud = (c: number) => `$${(c / 100).toFixed(2)}`;

export function evaluatePaymentGate(i: PaymentGateInput): PaymentGateResult {
  // TEST-only: lets a qa_test journey continue past payment while the real gate and Xero stay off.
  if (i.qaSimulated && i.qaSimulated.jobSource === "qa_test" && i.currentQuote && i.qaSimulated.quoteId === i.currentQuote.id)
    return { cleared: true, option: "qa_test_simulated" };
  if (!i.enabled) return { cleared: false, blocker: PAYMENT_RULE_PENDING };
  // Jo 24 Oct 2026: installer-supplied customers follow the same rule — the $349 safety check payment before the PIESA.
  if (i.route === "unknown") return { cleared: false, blocker: PAYMENT_RULE_EXCEPTION };
  if (!i.currentQuote)
    return { cleared: false, blocker: "Owner has not approved the current confirmed quote." };
  if (!i.invoice || i.invoice.quote_id !== i.currentQuote.id)
    return { cleared: false, blocker: "No Xero invoice for the current confirmed quote." };
  const total = cents(i.invoice.total_inc_gst);
  const paid = cents(i.invoice.total_paid);
  if (paid >= total) return { cleared: true, option: "paid_in_full" };
  const required = requiredDepositCents(i.invoice.total_inc_gst, i.safetyFeeIncGst);
  if (paid >= required) return { cleared: true, option: "safety_check_paid" };
  if (i.overrideCount > 0) return { cleared: true, option: "office_override" };
  return { cleared: false, blocker: safetyCheckBlocker(i.safetyFeeIncGst) };
}

export const safetyCheckBlocker = (fee?: number | string | null) =>
  `Pre Insulation Electrical Safety Assessment (PIESA) can't be booked — ${aud(feeCents(fee))} Pre Insulation Electrical Safety Assessment (PIESA) payment not received.`;

// ---------- What the money actually is (display only; the gate logic above is unchanged) ----------

/**
 * The five states a safety check payment can honestly be in. The point of the union is that an
 * administrative override is NOT money: the old trade timeline rendered "paid" whenever the gate had
 * been cleared by an override, while Office's payment mirror read $0.00 received. Both were "right"
 * about different facts and contradicted each other.
 */
export type SafetyCheckPayState =
  | { kind: "paid"; paidAt: string | null }
  | { kind: "overridden"; at: string | null }
  | { kind: "test_simulated" }
  | { kind: "unpaid" }
  | { kind: "unknown" };

export type SafetyCheckPayInput = {
  /** The amount that must be received for the safety check payment. */
  requiredAmount?: number | string | null;
  /** invoices.total_paid (Xero-mirrored), when there is one. */
  invoicePaid?: number | string | null;
  /** Audited office overrides on this invoice's deposit gate. */
  overrideCount: number;
  /** TEST journeys only: an audited qa_payment_simulated event exists for this job. */
  qaSimulated?: boolean;
  /** The recorded $349 pre-assessment payment row (assessment_payments.status = 'paid'), when there is one. */
  recordedPaidAt?: string | null;
};

/**
 * Single-source status for the safety check payment. Money actually received always wins; an override or
 * a TEST simulation is only reported when nothing was received, and is always reported as such — never as
 * "paid". `unknown` means we hold no payment information at all (no invoice yet), which is also not "paid".
 */
export function safetyCheckPayState(i: SafetyCheckPayInput): SafetyCheckPayState {
  const paid = i.invoicePaid == null ? 0 : cents(i.invoicePaid);
  const required = i.requiredAmount == null ? 0 : cents(i.requiredAmount);
  if (required > 0 && paid >= required) return { kind: "paid", paidAt: i.recordedPaidAt ?? null };
  if (i.recordedPaidAt) return { kind: "paid", paidAt: i.recordedPaidAt };
  if (i.qaSimulated) return { kind: "test_simulated" };
  if (i.overrideCount > 0) return { kind: "overridden", at: null };
  if (i.requiredAmount == null && i.recordedPaidAt == null && !i.qaSimulated && i.overrideCount === 0) return { kind: "unknown" };
  return { kind: "unpaid" };
}

/** Timeline/step wording. `staff` hides amounts from non-owner staff logins, as before. */
export function safetyCheckPayLabel(s: SafetyCheckPayState, staff: boolean): string {
  switch (s.kind) {
    case "paid": return staff ? "PIESA paid" : "$349 paid";
    case "overridden": return "Payment requirement overridden";
    case "test_simulated": return "TEST payment (simulated)";
    case "unpaid": return staff ? "PIESA payment due" : "$349 due";
    case "unknown": return staff ? "PIESA payment to confirm" : "PIESA payment to confirm";
  }
}

/** One-line explanation for the Office/owner panels, so the two portals cannot disagree. */
export function safetyCheckPayNote(s: SafetyCheckPayState, staff: boolean): string | null {
  switch (s.kind) {
    case "paid": return null;
    case "overridden": return "Payment block overridden by the office — no money has been received for the Pre Insulation Electrical Safety Assessment (PIESA) payment.";
    case "test_simulated": return staff ? "TEST simulated payment — no money received." : "TEST simulated payment — no real money has been received.";
    case "unpaid": return null;
    case "unknown": return "No payment information yet — an invoice is raised when the owner accepts the quote.";
  }
}

export type PiesaRequestFacts = {
  readyCheckComplete: boolean;
  verifiedEligible: boolean;
  currentQuoteApproved: boolean;
  payment: PaymentGateResult;
  /** Installer-supplied intake route (Jo, 8 Oct 2026): office-checked eligibility + qualifying insulation + measured
   * scope + installer quote. Replaces only the Ready Check/verified-eligibility pair; quote approval and payment stay. */
  installerIntakeQualified?: boolean;
};

/** PIESA can be requested only when all four approved conditions hold. */
export function piesaRequestBlockers(f: PiesaRequestFacts): string[] {
  const out: string[] = [];
  if (f.installerIntakeQualified !== true) {
    if (!f.readyCheckComplete) out.push("Ready Check not complete.");
    if (!f.verifiedEligible) out.push("Verified eligibility has not been recorded as eligible.");
  }
  if (!f.currentQuoteApproved)
    out.push("Owner has not approved the current confirmed insulation quote version.");
  if (!f.payment.cleared) out.push(f.payment.blocker);
  return out;
}

/** Customer/trade wording for the payment requirement (no percentages that the gate does not use). */
/** Jo 24 Oct 2026 (decisions 139/140/141): $349 at acceptance (card or bank, no fee), 10% of the rest to book the install (bank
 *  transfer / PayID, day held 48h), balance on install day (bank transfer / PayID), or pay in full any time. No card fee is ever shown. */
/** Decision 302: the same sentence with the quote's own safety check figure (e.g. $220 for an approved REC). */
export const paymentOptionSummary = (safetyCheckIncGst: number) => `The $${safetyCheckIncGst.toLocaleString("en-AU", { maximumFractionDigits: 2 })} Pre Insulation Electrical Safety Assessment (PIESA) payment is needed before the electrician's Pre Insulation Electrical Safety Assessment (PIESA) is booked. Then 10% of the rest to book your install day and the balance on install day, or pay in full any time.`;
export const PAYMENT_OPTION_SUMMARY =
  "The $349 Pre Insulation Electrical Safety Assessment (PIESA) payment is needed before the electrician's Pre Insulation Electrical Safety Assessment (PIESA) is booked. Then 10% of the rest to book your install day and the balance on install day, or pay in full any time.";
export const PAYMENT_DECISION_STATUS = "decided_2026_10_26_flat_10_pct" as const;
