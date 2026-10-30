// Jo 28 Oct 2026 (decision card 04:40 UTC): "Alert after 3 days unpaid".
// PURE. A job paused waiting on a homeowner payment raises ONE Needs me row per invoice (batch 3b) for the office once the payment
// has been outstanding for 3 full days; the row says plainly which payment and since when. The row is derived from
// the paid amount, never stored — the moment the payment is recorded it clears by itself.
// Covered (Jo's list): the $349 safety check (PIESA) at quote acceptance, the 10% install deposit, the electrical
// fixes, and the repeat safety check. The balance is NOT covered — it is due on install day and the install-day
// locks already handle it.

import { PAYMENT_STEP_LABEL, paymentPlan, stepInvoiceKind, toCents, type InvoiceSlot, type PaymentStepKey } from "./payments.core";

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

/** The row line: which payment is outstanding and since when, in plain words (batch 3b: + that invoice's reference). */
export function paymentStallLine(s: PaymentStall & { reference?: string | null }): string {
  return `Waiting on the owner's payment — ${PAYMENT_STEP_LABEL[s.key]} unpaid since ${fmtDay(s.since)}${s.reference ? ` · ${s.reference}` : ""}`;
}

/** Batch 3b: one stall per INVOICE — the installation invoice ($349 safety check, 10% deposit), the fixes invoice and the
 *  repeat safety check invoice each raise their own row, measured on that invoice's own money only. */
export type InvoicePaymentStall = PaymentStall & { invoice: InvoiceSlot; reference: string | null };
type StallInvoice = { id: string; kind: string | null; quote_id: string | null; total_inc_gst: number | string | null; total_paid: number | string | null; created_at: string | null; xero_invoice_number: string | null };
export type JobStallInput = {
  now: number;
  invoices: readonly StallInvoice[];
  /** The accepted installation quote (newest acceptance). */
  installQuote: { accepted_at: string; customer_total_inc_gst: number | string | null };
  /** The newest accepted fixes quote; its OWN invoice (quote_id) carries the fixes money. */
  fixesQuote: { id: string; accepted_at: string; customer_total_inc_gst: number | string | null } | null;
  safetyCents: number;
  /** The office overrode the $349 gate on the installation invoice. */
  waived: boolean;
  /** When the 10% deposit was first asked for (deposit-due stage entry) and whether it is due now (fixes done). */
  depositSince: string | null; depositDueNow: boolean;
  /** The owner-paid repeat safety check for the current deadline (price in cents, accepted, recorded paid). */
  repeat: { cents: number; acceptedAt: string | null; paid: boolean } | null;
};

const newest = <T extends { created_at: string | null }>(xs: readonly T[]) => [...xs].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0] ?? null;

export function jobPaymentStalls(i: JobStallInput): InvoicePaymentStall[] {
  const install = newest(i.invoices.filter((x) => x.kind === "installation"));
  const fixesInv = i.fixesQuote ? newest(i.invoices.filter((x) => x.kind === "rectification" && x.quote_id === i.fixesQuote!.id)) : null;
  const repeatInv = newest(i.invoices.filter((x) => x.kind === "repeat_safety_check"));
  const fixesCents = i.fixesQuote ? toCents(i.fixesQuote.customer_total_inc_gst ?? 0) : 0;
  const repeatCents = i.repeat && i.repeat.acceptedAt ? Math.max(0, i.repeat.cents) : 0;
  const plan = paymentPlan({ quoteTotalCents: toCents(i.installQuote.customer_total_inc_gst ?? 0), safetyCheckCents: i.safetyCents, fixesCents, repeatCents });
  const paid = { install: install ? toCents(install.total_paid ?? 0) : 0, fixes: fixesInv ? toCents(fixesInv.total_paid ?? 0) : 0 };
  const steps: StallStep[] = [];
  if (install && !i.waived && paid.install < plan.thresholds.safety_check) steps.push({ key: "safety_check", since: i.installQuote.accepted_at });
  if (install && i.depositSince && i.depositDueNow && paid.install < plan.thresholds.install_deposit) steps.push({ key: "install_deposit", since: i.depositSince });
  if (fixesCents > 0 && i.fixesQuote && paid.fixes < plan.thresholds.fixes) steps.push({ key: "fixes", since: i.fixesQuote.accepted_at });
  if (repeatCents > 0 && i.repeat?.acceptedAt && !i.repeat.paid) steps.push({ key: "repeat_safety_check", since: i.repeat.acceptedAt });
  const reference: Record<InvoiceSlot, string | null> = { install: install?.xero_invoice_number ?? null, fixes: fixesInv?.xero_invoice_number ?? null, repeat: repeatInv?.xero_invoice_number ?? null };
  const out: InvoicePaymentStall[] = [];
  for (const slot of ["install", "fixes", "repeat"] as const) {
    const s = paymentStall(steps.filter((x) => stepInvoiceKind(x.key) === slot), i.now);
    if (s) out.push({ ...s, invoice: slot, reference: reference[slot] });
  }
  return out;
}
