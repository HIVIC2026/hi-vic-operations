import { cumulativePaidCents, effectiveLedger, isStepPaid, paymentPlan, paymentSteps, stepPaidAt, toCents, type PaymentRecord } from './payments.core';

/** Existing installation-invoice rules only; other invoices and undated mirrors never manufacture receipt dates. */
export function installerMoneyReceipts(input: { totalIncGst: number | string; totalPaid: number | string | null; safetyCents: number; records: PaymentRecord[] }) {
  const ledger = effectiveLedger(input.records);
  const received = cumulativePaidCents(ledger);
  const paid = input.records.some(r => r.source === 'xero') ? received : Math.max(received, toCents(input.totalPaid));
  const plan = paymentPlan({ quoteTotalCents: toCents(input.totalIncGst), safetyCheckCents: input.safetyCents });
  const steps = paymentSteps(plan, { install: paid, fixes: 0, repeat: 0 }, {}, new Date().toISOString());
  return {
    depositPaid: isStepPaid(steps, 'install_deposit'),
    depositPaidAt: isStepPaid(steps, 'install_deposit') ? stepPaidAt(plan, 'install_deposit', ledger) : null,
    balancePaidAt: isStepPaid(steps, 'balance') ? stepPaidAt(plan, 'balance', ledger) : null,
  };
}