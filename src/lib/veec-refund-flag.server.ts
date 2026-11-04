// G6 S9 (final Part 9 review, 4 Nov 2026): ONE place that tells the office when money is reversed after VEECs were created
// (Part 9 Task 11 Review Focus 4) — for a Stripe refund (stripe.server recordStripeRefund) AND for a Xero payment later
// deleted / voided (payments.server recordXeroPayments → owner_payment_reversed). A refund that lands after creation can't
// be stopped, so the office is told at once (`veec_copayment_refunded`, needs_office → Needs me). Fail closed: when the VEEC
// record can't be read, the office is told THAT (the check-failed line) instead of a console line nobody sees. Never throws
// to its caller: the reversal itself is already recorded; a failure here is logged.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { VEEC_COPAYMENT_REFUNDED_EVENT, VEEC_REFUND_NEEDS_LINE, veecCreatedBefore, veecRefundCheckFailedDetails, veecRefundEventDetails } from "./veec-creation-gate.core";

export type ReversalFact = { refundedCents: number; source: "card" | "xero"; paymentIntentId?: string | null; stripeEventId?: string | null; xeroPaymentId?: string | null };

export async function flagRefundAfterVeecCreation(jobId: string, i: ReversalFact): Promise<"flagged" | "check_failed" | "not_created"> {
  try {
    const { data: l, error } = await admin.from("veec_lodgements").select("status, submission_reference").eq("job_id", jobId).maybeSingle();
    if (error) {
      await logEvent(jobId, null, VEEC_COPAYMENT_REFUNDED_EVENT, veecRefundCheckFailedDetails({ ...i, reason: error.message }).line, veecRefundCheckFailedDetails({ ...i, reason: error.message || "unknown error" }), { internal: true });
      return "check_failed";
    }
    if (!veecCreatedBefore(l)) return "not_created";
    await logEvent(jobId, null, VEEC_COPAYMENT_REFUNDED_EVENT, VEEC_REFUND_NEEDS_LINE, veecRefundEventDetails({ ...i, veecReference: l?.submission_reference ?? null }), { internal: true });
    return "flagged";
  } catch (e) {
    // The event itself could not be written: nothing more can be done here; the reversal row is on file.
    console.error("VEEC refund flag failed", jobId, e instanceof Error ? e.message : String(e));
    return "check_failed";
  }
}
