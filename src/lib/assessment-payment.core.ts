/** Pure pre-assessment acceptance/payment rules. No gateway, Xero, invoice, or final-quote logic. */
export const ASSESSMENT_PAYMENT_AMOUNT = 349 as const;
export const ASSESSMENT_ACCEPTANCE_COPY_VERSION = "pre-assessment-v1" as const;

export type AssessmentPaymentStatus = "unpaid" | "failed" | "paid";
export type TestPaymentOutcome = "failure" | "success";

export type AssessmentAcceptanceState = {
  acceptanceId: string;
  estimateId: string;
  acceptedAt: string;
  paymentId: string;
  paymentStatus: AssessmentPaymentStatus;
  amountIncGst: number;
  estimatedRemainingBalanceIncGst: number;
  paidAt: string | null;
  stale: boolean;
};

export function assessmentRemaining(customerTotalIncGst: number): number {
  return Math.max(0, Math.round((customerTotalIncGst - ASSESSMENT_PAYMENT_AMOUNT) * 100) / 100);
}

export function acceptanceIsCurrent(acceptedEstimateId: string, currentEstimateId: string | null): boolean {
  return !!currentEstimateId && acceptedEstimateId === currentEstimateId;
}

export function testPaymentTransition(status: AssessmentPaymentStatus, outcome: TestPaymentOutcome): AssessmentPaymentStatus {
  if (status === "paid") return "paid";
  return outcome === "success" ? "paid" : "failed";
}

export function readyForAssessmentNextAction(stage: string): string {
  return stage === "awaiting_electrician"
    ? "Assign electrician for Measure + PIESA"
    : "Arrange Measure + PIESA assessment";
}