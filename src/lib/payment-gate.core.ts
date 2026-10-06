// Approved payment-option gate (owner decision 2026-10-03). Pure rules, no database.
// 7 Oct: safety check payment gates PIESA; balance in two halves or paid in full. Replaces deposit tiers and the 3-instalment plan. The database mirrors this in
// docs/pending-migrations/0080_payment_option_gate.sql (required_deposit_amount / invoice_deposit_cleared).
import { WORKFLOW_DECISIONS, depositPctFor } from "@/config/workflow-decisions";

export type PaymentRoute = "hiv_lead" | "installer_supplied" | "unknown";
export type PaymentOption =
  "safety_check_paid" | "deposit_paid" | "paid_in_full" | "instalment_plan_active" | "office_override" | "qa_test_simulated";

export const PAYMENT_RULE_PENDING =
  "Payment rule pending activation – PIESA and scheduling are locked until the approved payment-option gate is switched on.";
export const PAYMENT_RULE_EXCEPTION =
  "Payment rule exception – no approved payment rule for this customer source. PIESA and scheduling are blocked until office sets one.";

const cents = (n: number | string) => Math.round(Number(n) * 100);

/** Route from the job's permanent source. Installer-supplied customers never inherit the Home Insulation Victoria rule. */
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
export function balanceSplit(totalIncGst: number | string, safetyFee?: number | string | null) {
  const t = cents(totalIncGst);
  const fee = requiredDepositCents(totalIncGst, safetyFee);
  const bal = t - fee;
  const first = Math.floor(bal / 2);
  return { total: t / 100, fee: fee / 100, balance: bal / 100, firstHalf: first / 100, secondHalf: (bal - first) / 100 };
}

/** Invoice split kept under its old name: deposit = safety check payment, balance = the rest. */
export function splitForOption(totalIncGst: number | string, safetyFee?: number | string | null) {
  const b = balanceSplit(totalIncGst, safetyFee);
  return { depositPct: b.total > 0 ? Math.round((b.fee / b.total) * 10000) / 10000 : 0, deposit: b.fee, balance: b.balance, firstHalf: b.firstHalf, secondHalf: b.secondHalf };
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
  refund_all: "Refund everything paid (safety check never happened)",
  refund_except_safety_fee: "Refund everything except the safety check payment (check done, job can't go ahead)",
  keep_safety_fee: "Keep the safety check payment (check done, job can't go ahead)",
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
  if (i.route !== "hiv_lead") return { cleared: false, blocker: PAYMENT_RULE_EXCEPTION };
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
  `Safety check can't be booked — ${aud(feeCents(fee))} safety check payment not received.`;

export type PiesaRequestFacts = {
  readyCheckComplete: boolean;
  verifiedEligible: boolean;
  currentQuoteApproved: boolean;
  payment: PaymentGateResult;
};

/** PIESA can be requested only when all four approved conditions hold. */
export function piesaRequestBlockers(f: PiesaRequestFacts): string[] {
  const out: string[] = [];
  if (!f.readyCheckComplete) out.push("Ready Check not complete.");
  if (!f.verifiedEligible) out.push("Verified eligibility has not been recorded as eligible.");
  if (!f.currentQuoteApproved)
    out.push("Owner has not approved the current confirmed insulation quote version.");
  if (!f.payment.cleared) out.push(f.payment.blocker);
  return out;
}

/** Customer/trade wording for the payment requirement (no percentages that the gate does not use). */
export const PAYMENT_OPTION_SUMMARY =
  "The $349 safety check payment is needed before the electrician's safety check is booked. Then pay the balance in two halves (install booked, install day) or in full now.";
export const PAYMENT_DECISION_STATUS = WORKFLOW_DECISIONS.payment.deposit.status;
