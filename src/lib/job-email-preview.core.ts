import { renderJoOutcomeEmail, type JoOutcomeEmailInput } from './jo-outcome-email.core';

/** Office display only. Never recalculate a price or infer an eligibility decision. */
export function renderJobEmailPreview(input: JoOutcomeEmailInput) {
  if (input.outcome !== 'does_not_appear_eligible') {
    const f = input.figures;
    if (!f || !Object.values(f).filter(v => typeof v === 'number').every(v => Number.isFinite(v) && v >= 0) || f.ceilingAreaM2 <= 0) return null;
  }
  return renderJoOutcomeEmail(input);
}