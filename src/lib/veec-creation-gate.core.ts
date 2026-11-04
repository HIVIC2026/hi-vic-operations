// New job flow, Part 9, Task 11: before VEECs are created the installed product must be on the VEU Register ON THE
// CREATION DAY (install-evidence.core `declaredProductProblems` tests the install date and the creation date) and the
// owner must have paid at least $200 incl GST on the installation invoice (the VEU co-payment minimum). PURE: no database.
// Read by esc-registry-robot.core `planVeecCreation` (robot) and portal.functions `updateVeec` (office) — one rule.
// A refund that lands AFTER creation can't be stopped in Stripe; stripe.server `recordStripeRefund` raises ONE
// `veec_copayment_refunded` office event so the office is told at once.

import { NO_ESC_REFUSAL } from "./no-esc.core";

/** The VEU minimum consumer co-payment, incl GST, in cents. */
export const MIN_COPAYMENT_CENTS = 20000;
export const COPAYMENT_TOO_LOW = "Owner has paid less than $200 (incl GST) — VEECs can't be created yet."; // office-only
export const VEEC_COPAYMENT_REFUNDED_EVENT = "veec_copayment_refunded";
export const VEEC_REFUND_NEEDS_LINE = "A payment was refunded after VEECs were created. The $200 minimum can't be refunded — call Jo."; // office-only (Needs me)

export type VeecCreationFacts = {
  /** install-evidence.server `jobProductProblems` lines ("Product: …"); empty = every installed product is approved on both days. */
  productProblems: string[];
  /** Cents received on the installation invoice (payments.server `jobPaymentView().paid.install`); null = could not be read. */
  installPaidCents: number | null;
  /** Part 9 Task 14 (real runs, Jo 2 Nov answers 18–19): the job is marked "no ESC" (no-esc.core) — nothing goes to the ESC
   *  Registry and no certificates are created; the refusal line comes first. undefined = not marked (older callers; the
   *  robot and updateVeec always pass the read value). */
  noEsc?: boolean | undefined;
};

/** Plain reasons VEECs can't be created yet. Empty = both checks pass. Unknown money fails closed. */
export function veecCreationBlockers(i: VeecCreationFacts): string[] {
  const out = i.noEsc === true ? [NO_ESC_REFUSAL, ...i.productProblems] : [...i.productProblems];
  if (i.installPaidCents == null || !Number.isFinite(i.installPaidCents) || i.installPaidCents < MIN_COPAYMENT_CENTS) out.push(COPAYMENT_TOO_LOW);
  return out;
}

/** Has a VEEC creation already been lodged for this job? Submitted, under query or approved count; a rejected or
 *  never-submitted lodgement does not (a refund then is the ordinary payment-reversed row). */
export function veecCreatedBefore(l: { status: string; submission_reference: string | null } | null | undefined): boolean {
  return !!l && ["submitted", "query", "approved"].includes(l.status);
}

/** Details of the one office event raised when a refund lands after creation. */
export function veecRefundEventDetails(i: { refundedCents: number; veecReference: string | null; paymentIntentId: string; stripeEventId: string }) {
  return { refunded_cents: i.refundedCents, veec_reference: i.veecReference, stripe_payment_intent: i.paymentIntentId, stripe_event_id: i.stripeEventId, line: VEEC_REFUND_NEEDS_LINE, needs_office: true as const };
}
