// Jo 28 Oct 2026 (decision card 04:40 UTC): "Alert after 3 days unpaid".
// PURE. A job paused waiting on a homeowner payment raises exactly ONE Needs me row for the office once the payment
// has been outstanding for 3 full days; the row says plainly which payment and since when. The row is derived from
// the paid amount, never stored — the moment the payment is recorded it clears by itself.
// Covered (Jo's list): the $349 safety check (PIESA) at quote acceptance, the 10% install deposit, the electrical
// fixes, and the repeat safety check. The balance is NOT covered — it is due on install day and the install-day
// locks already handle it.

import { PAYMENT_STEP_LABEL, type PaymentStepKey } from "./payments.core";

export const PAYMENT_STALL_DAYS = 3;
const MS_DAY = 86_400_000;

/** The payment steps this alert covers (balance excluded on purpose — Jo's list). */
export const STALLED_STEPS: readonly PaymentStepKey[] = ["safety_check", "fixes", "install_deposit", "repeat_safety_check"];

/** One unpaid step: `since` is when the owner was first asked for this payment (a stable fact, never "now"). */
export type StallStep = { key: PaymentStepKey; since: string };
export type PaymentStall = { key: PaymentStepKey; since: string; days: number };

/** The ONE payment to name for a job: the covered step waiting on the owner the longest, once 3 full days have passed. */
export function paymentStall(steps: readonly StallStep[], now: number): PaymentStall | null {
  const waiting = steps
    .filter((s) => STALLED_STEPS.includes(s.key))
    .map((s) => ({ key: s.key, since: s.since, days: Math.floor((now - Date.parse(s.since)) / MS_DAY) }))
    .filter((s) => Number.isFinite(s.days) && s.days >= PAYMENT_STALL_DAYS)
    .sort((a, b) => a.since.localeCompare(b.since) || a.key.localeCompare(b.key));
  return waiting[0] ?? null;
}

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "Australia/Melbourne" });

/** The row line: which payment is outstanding and since when, in plain words. */
export function paymentStallLine(s: PaymentStall): string {
  return `Waiting on the owner's payment — ${PAYMENT_STEP_LABEL[s.key]} unpaid since ${fmtDay(s.since)}`;
}
