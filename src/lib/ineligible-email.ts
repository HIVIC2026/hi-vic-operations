/** Pure preliminary-ineligible outcome email adapter. No data access or delivery. */
import { renderIneligibleOutcomeEmail, type EstimateEmail } from "./estimate-email";

export type IneligibleEmailInput = { referralUrl: string; reason?: string | null; reasons?: string[] | null; reference?: string | null; apCount?: number | null };
export const INELIGIBLE_SUBJECT = "Your Home Insulation Victoria eligibility result";

/** Keeps only a short, plain customer-safe reason (no markup or internal review codes). */
export function safeReason(r: string | null | undefined): string | null {
  if (!r) return null;
  const t = r.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  if (!t || /[_]{1}[a-z]+_/.test(t) || /review required/i.test(t)) return null;
  return t.slice(0, 400);
}

export function renderIneligibleEmail(input: IneligibleEmailInput): EstimateEmail {
  const reasons = (input.reasons ?? [input.reason]).map(safeReason).filter((reason): reason is string => Boolean(reason));
  return renderIneligibleOutcomeEmail({ referralUrl: input.referralUrl, reasons, reference: input.reference, apCount: input.apCount });
}