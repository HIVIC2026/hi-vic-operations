// Decision 355 (Jo 25 Oct 2026): the electrician payout timing — PURE. Paid 7 days after BOTH the electrician's Mitti
// form is 100% complete (decision-318 gate passed; A4 for the safety check, A5 for the fixes, the A4 for same-visit fixes)
// AND the owner has paid that step (safety check / fixes). Facts are read by electrician-pay.server.ts.
import { electricianPayDueAt, ELECTRICIAN_PAY_WAITING, type ElectricianPayKind } from "./trade-view.core";
import { electricianFormCompleteAt, type TradePayoutFacts } from "./trade-payout-gate.core";

export type OwnerElectricalPaid = { safetyPaidAt: string | null; fixesPaidAt: string | null };
export type ElectricianPayTiming = { formCompleteAt: string | null; ownerPaidAt: string | null; dueAt: string | null; waiting: string[] };

/** The decision-355 timing for one electrician payout from the two fact sets. `waiting` = why it is not due yet beyond
 *  the form gate (which `tradePayoutBlockers` already reports): the owner hasn't paid that step. */
export function electricianPayTiming(kind: ElectricianPayKind, gate: TradePayoutFacts | undefined, paid: OwnerElectricalPaid | undefined): ElectricianPayTiming {
  const formCompleteAt = gate ? electricianFormCompleteAt(kind, gate) : null;
  const ownerPaidAt = (kind === "assessment" ? paid?.safetyPaidAt : paid?.fixesPaidAt) ?? null;
  return { formCompleteAt, ownerPaidAt, dueAt: electricianPayDueAt({ formCompleteAt, ownerPaidAt }), waiting: ownerPaidAt ? [] : [ELECTRICIAN_PAY_WAITING[kind]] };
}
