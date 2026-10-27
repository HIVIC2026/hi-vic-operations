// Decision 355 (Jo 25 Oct 2026, corrected 27 Oct 2026): the electrician payout timing — PURE. Paid within 7 days of the
// electrician's Mitti form being complete and approved (decision-318 gate passed; A3 for the safety check, A4 for the
// fixes, the A3 for same-visit fixes). It never waits for the owner's payment. Form facts: trade-payout-gate.server.ts.
import { electricianPayDueAt, type ElectricianPayKind } from "./trade-view.core";
import { electricianFormCompleteAt, type TradePayoutFacts } from "./trade-payout-gate.core";

export type ElectricianPayTiming = { formCompleteAt: string | null; dueAt: string | null };

/** The decision-355 timing for one electrician payout. The form gate's reasons come from `tradePayoutBlockers`. */
export function electricianPayTiming(kind: ElectricianPayKind, gate: TradePayoutFacts | undefined): ElectricianPayTiming {
  const formCompleteAt = gate ? electricianFormCompleteAt(kind, gate) : null;
  return { formCompleteAt, dueAt: electricianPayDueAt({ formCompleteAt }) };
}
