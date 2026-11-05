// Receipt wording and maths for the $349 safety check, the 50% deposit and the final payment. PURE (no pdf-lib, no database).
// Amounts come from `paymentPlan` (payments.core.ts) and the ledger; nothing here recomputes the deposit.
import { aud, stepAmountCents, type PaymentPlan } from "./payments.core";

export type ReceiptStep = "safety_check" | "install_deposit" | "balance";
export type ReceiptEarlier = { label: string; paidOn: string; cents: number };
export type ReceiptInput = {
  step: ReceiptStep; jobNumber: string; ownerName: string; firstName: string; address: string; paidOn: string; method: "card" | "bank";
  amountCents: number; yourPriceCents: number; earlier: ReceiptEarlier[];
};
export type ReceiptModel = { heading: string; paidLine: string; rows: { label: string; amount: string }[]; stillToPay: string; gstLine: string | null };

export const SAFETY_CHECK_LABEL = "Electrical safety check (PIESA)";
export const DEPOSIT_LABEL = "Deposit";
const HEADING: Record<ReceiptStep, string> = { safety_check: "We've received your payment.", install_deposit: "We've received your deposit.", balance: "We've received your final payment." };
const PAID_LINE: Record<ReceiptStep, string> = { safety_check: SAFETY_CHECK_LABEL, install_deposit: "Your deposit to book your install day", balance: "The rest of your price, due on install day" };
const TODAY_LABEL: Record<ReceiptStep, string> = { safety_check: `${SAFETY_CHECK_LABEL}, paid today`, install_deposit: "Your deposit, paid today", balance: "Final payment, paid today" };

/** GST inside a GST-inclusive amount (one eleventh), rounded half up to the cent. */
const gstInside = (cents: number) => Math.floor(cents / 11 + 0.5);

export function receiptModel(i: ReceiptInput): ReceiptModel {
  const rows = [
    { label: "Your price (incl. GST)", amount: aud(i.yourPriceCents) },
    ...i.earlier.map((e) => ({ label: `${e.label}, paid ${e.paidOn}`, amount: `– ${aud(e.cents)}` })),
    { label: TODAY_LABEL[i.step], amount: `– ${aud(i.amountCents)}` },
  ];
  const left = i.yourPriceCents - i.earlier.reduce((s, e) => s + e.cents, 0) - i.amountCents;
  const stillToPay = left <= 0 ? "$0.00 · Paid in full ✓" : i.step === "install_deposit" ? `${aud(left)} on install day` : `${aud(left)} later`;
  return { heading: HEADING[i.step], paidLine: PAID_LINE[i.step], rows, stillToPay, gstLine: i.step === "safety_check" ? `Includes GST ${aud(gstInside(i.amountCents))}` : null };
}

// ---- facts → input (pure; the server only reads and files) ----------------------------------------------------------
export type ReceiptPayment = { amountCents: number; paidAt: string; source: string; kind?: "payment" | "reversal" };
const MELB = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", ...o });
const fmtLong = (iso: string) => MELB({ weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso)).replace(",", "");
const fmtShort = (iso: string) => MELB({ day: "numeric", month: "short" }).format(new Date(iso));

/** The ledger less ONE row matching `p` (same time, amount, source and kind). */
export function withoutPayment(ledger: ReceiptPayment[], p: ReceiptPayment): ReceiptPayment[] {
  const i = ledger.findIndex((r) => r === p || (r.paidAt === p.paidAt && Math.round(r.amountCents) === Math.round(p.amountCents) && r.source === p.source && (r.kind ?? "payment") === (p.kind ?? "payment")));
  return i < 0 ? ledger : [...ledger.slice(0, i), ...ledger.slice(i + 1)];
}
/** When the running total of payments first reached `thresholdCents`; null if it never did. */
export function reachedOn(ledger: ReceiptPayment[], thresholdCents: number): string | null {
  let sum = 0;
  for (const r of [...ledger].sort((a, b) => Date.parse(a.paidAt) - Date.parse(b.paidAt))) {
    sum += (r.kind === "reversal" ? -1 : 1) * Math.max(0, Math.round(r.amountCents));
    if (sum >= thresholdCents) return r.paidAt;
  }
  return null;
}

export type ReceiptFacts = {
  step: ReceiptStep; jobNumber: string | null | undefined; ownerName: string | null | undefined; address: string | null | undefined;
  plan: PaymentPlan; /** The installation invoice's effective ledger. */ ledger: ReceiptPayment[]; /** The ledger row this receipt is for. */ payment: ReceiptPayment | null | undefined;
};
const held = (why: string) => ({ held: `Receipt not made: ${why}` });
/** A held reason for any missing fact — never a blank or a guess. */
export function buildReceiptInput(f: ReceiptFacts): ReceiptInput | { held: string } {
  const ownerName = (f.ownerName ?? "").trim();
  const firstName = ownerName.split(/\s+/)[0] ?? "";
  if (!ownerName || !firstName) return held("the owner's name is missing");
  const address = (f.address ?? "").trim();
  if (!address) return held("the property address is missing");
  const jobNumber = (f.jobNumber ?? "").trim();
  if (!jobNumber) return held("the job number is missing");
  if (!(f.plan.quoteTotalCents > 0)) return held("the price is missing");
  if (!f.payment) return held("that payment is not on record");
  const due = stepAmountCents(f.plan, f.step);
  if (Math.round(f.payment.amountCents) !== due) return held(`the payment of ${aud(f.payment.amountCents)} is not the ${aud(due)} due for this step`);
  const earlier: ReceiptEarlier[] = [];
  // Earlier steps are dated from the OTHER payments only: with the 50% deposit (Jo 5 Nov 2026) this payment alone can exceed
  // the $349, so counting it would date the safety check from the deposit itself.
  const others = withoutPayment(f.ledger, f.payment);
  if (f.step !== "safety_check") {
    const day = reachedOn(others, f.plan.thresholds.safety_check);
    if (!day) return held("the date of the earlier safety check payment is not on record");
    earlier.push({ label: SAFETY_CHECK_LABEL, paidOn: fmtShort(day), cents: f.plan.safetyCheckCents });
  }
  if (f.step === "balance") {
    const day = reachedOn(others, f.plan.thresholds.install_deposit);
    if (!day) return held("the date of the earlier deposit payment is not on record");
    earlier.push({ label: DEPOSIT_LABEL, paidOn: fmtShort(day), cents: f.plan.installDepositCents });
  }
  return { step: f.step, jobNumber, ownerName, firstName, address, paidOn: fmtLong(f.payment.paidAt), method: f.payment.source === "card" ? "card" : "bank", amountCents: due, yourPriceCents: f.plan.quoteTotalCents, earlier };
}
