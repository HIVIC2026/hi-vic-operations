// Approved payment-option gate (owner decision 2026-10-03). Pure rules, no database.
// Replaces the retired half-deposit gate. The database mirrors this in
// docs/pending-migrations/0080_payment_option_gate.sql (required_deposit_amount / invoice_deposit_cleared).
import { WORKFLOW_DECISIONS, depositPctFor } from "@/config/workflow-decisions";

export type PaymentRoute = "hiv_lead" | "installer_supplied" | "unknown";
export type PaymentOption =
  "deposit_paid" | "paid_in_full" | "instalment_plan_active" | "office_override" | "qa_test_simulated";

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

/** Minimum upfront payment in cents: 10% under $20,000, 5% at/over (pending legal confirmation). Rounded UP so it is never under-collected. */
export function requiredDepositCents(totalIncGst: number | string): number {
  const t = cents(totalIncGst);
  const pct = depositPctFor(t / 100);
  return Math.ceil((t * pct) / 100);
}

/** Deposit/balance split for a new invoice: deposit = configured minimum, balance = the rest. */
export function splitForOption(totalIncGst: number | string) {
  const t = cents(totalIncGst);
  const d = requiredDepositCents(totalIncGst);
  return { depositPct: depositPctFor(t / 100) / 100, deposit: d / 100, balance: (t - d) / 100 };
}

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
  const required = requiredDepositCents(i.invoice.total_inc_gst);
  if (paid >= required) return { cleared: true, option: "deposit_paid" };
  if (instalmentPlanActive(i.plan, i.currentQuote.id))
    return { cleared: true, option: "instalment_plan_active" };
  if (i.overrideCount > 0) return { cleared: true, option: "office_override" };
  const pct = depositPctFor(total / 100);
  return {
    cleared: false,
    blocker: `Payment option not verified – minimum upfront payment ${aud(required)} (${pct}%) not yet paid in Xero, not paid in full, and no active 3-instalment plan.`,
  };
}

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
  "Approved payment option required: minimum upfront deposit, paid in full, or an active 3-instalment plan.";
export const PAYMENT_DECISION_STATUS = WORKFLOW_DECISIONS.payment.deposit.status;
