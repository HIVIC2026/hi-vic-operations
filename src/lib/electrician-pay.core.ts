// Decision 410 (Jo 27 Oct 2026, replaces decision 355 for electricians): the electrician payout timing — PURE. Paid within
// 7 days of someone in the office pressing Approve on the electrician's completed Mitti form (A3 for the safety check, A4
// for the fixes; fixes done on the same visit are on the A3, so the A3 approval covers them). Approve is only offered once
// the form passes the decision-318 gate. The safety check pay never waits for the owner's payment; the FIXES pay also waits
// for the owner's fixes invoice to be paid in full (batch 3b, Jo 29 Oct 2026). Facts: trade-payout-gate.server.ts.
import { electricianPayDueAt, type ElectricianPayKind } from "./trade-view.core";
import { electricianFormCompleteAt, type TradePayoutFacts } from "./trade-payout-gate.core";

/** Workflow event the office Approve writes (details.kind = "assessment" | "rectification"). */
export const ELECTRICIAN_FORM_APPROVED_EVENT = "electrician_form_approved";
/** Held reason while a complete form waits for the office's Approve. */
export const ELECTRICIAN_FORM_AWAITING_APPROVAL: Record<ElectricianPayKind, string> = {
  assessment: "Waiting for the office to approve the safety check form (A3)",
  rectification: "Waiting for the office to approve the electrical fixes form (A4)",
};

/** Batch 3b (Jo 29 Oct 2026): held reason while the owner's electrical fixes invoice is not paid in full. */
export const ELECTRICIAN_FIXES_INVOICE_UNPAID = "Waiting for the owner to pay the electrical fixes invoice";

export type ElectricianPayTiming = { formCompleteAt: string | null; approvedAt: string | null; dueAt: string | null; waiting: string[]; approvable: boolean };

/** Which approval a payout needs: same-visit fixes are on the A3, so they follow the A3's approval. */
export const approvalKindFor = (kind: ElectricianPayKind, gate: TradePayoutFacts | undefined): ElectricianPayKind =>
  kind === "rectification" && gate?.fixes?.sameVisitOnPiesa ? "assessment" : kind;

/** The decision-410 timing for one electrician payout. The form gate's own reasons come from `tradePayoutBlockers`;
 *  `waiting` adds the office-approval reason once the form is complete; `approvable` = show the office Approve. */
export function electricianPayTiming(kind: ElectricianPayKind, gate: TradePayoutFacts | undefined): ElectricianPayTiming {
  const formCompleteAt = gate ? electricianFormCompleteAt(kind, gate) : null;
  const approvalKind = approvalKindFor(kind, gate);
  const approvedAt = formCompleteAt ? gate?.electricianApprovedAt?.[approvalKind] ?? null : null;
  const ownerUnpaid = kind === "rectification" && gate?.fixesInvoice?.paid === false;
  return {
    formCompleteAt, approvedAt, dueAt: ownerUnpaid ? null : electricianPayDueAt({ approvedAt }),
    waiting: [...(formCompleteAt && !approvedAt ? [ELECTRICIAN_FORM_AWAITING_APPROVAL[approvalKind]] : []), ...(ownerUnpaid ? [ELECTRICIAN_FIXES_INVOICE_UNPAID] : [])],
    approvable: !!formCompleteAt && !approvedAt,
  };
}
