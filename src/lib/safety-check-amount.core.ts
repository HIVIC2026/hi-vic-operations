// Decision 302 (Jo 25 Oct 2026): the owner's upfront "safety check" payment is the quote's electrical safety check
// (PIESA) line — not a fixed $349. Our electrician → the standard $349 line; an installer's approved REC → that REC's
// onboarded rate (e.g. $220). One pure rule picks the figure from the quote lines so the acceptance page, the P2 page,
// the O18/O22 emails, Stripe Checkout, the Xero deposit request and the office Money cards all print the same number.
// Fallback (quote with no positive PIESA line, e.g. a legacy "own electrician bills the owner" quote, or no quote yet):
// `workflow_settings.safety_check_payment_inc_gst`, else the $349 default. PURE: no I/O, no dates.

export const PIESA_LINE_CODE = "PIESA";
export const SAFETY_CHECK_DEFAULT_CENTS = 34_900;
export type SafetyCheckSource = "quote_line" | "setting" | "default";

const toCents = (n: number | string | null | undefined) => Math.round(Number(n ?? 0) * 100);

/** The PIESA line amount in cents when the quote carries exactly one positive PIESA line; otherwise null (never guessed). */
export function piesaLineCents(lines: { code: string | null; line_total_inc_gst: number | string | null }[] | null | undefined): number | null {
  const piesa = (lines ?? []).filter((l) => l.code === PIESA_LINE_CODE && toCents(l.line_total_inc_gst) > 0);
  return piesa.length === 1 ? toCents(piesa[0]!.line_total_inc_gst) : null;
}

/** The safety check amount for a quote: its PIESA line, else the setting, else $349. */
export function safetyCheckCentsFor(i: { lines: { code: string | null; line_total_inc_gst: number | string | null }[] | null | undefined; settingIncGst?: number | string | null }): { cents: number; source: SafetyCheckSource } {
  const line = piesaLineCents(i.lines);
  if (line != null) return { cents: line, source: "quote_line" };
  if (i.settingIncGst != null && Number.isFinite(Number(i.settingIncGst)) && Number(i.settingIncGst) > 0) return { cents: toCents(i.settingIncGst), source: "setting" };
  return { cents: SAFETY_CHECK_DEFAULT_CENTS, source: "default" };
}

/** Same as `safetyCheckCentsFor` but in dollars, for the older gate/split helpers that take `safetyFee` inc GST. */
export const safetyCheckIncGstFor = (i: Parameters<typeof safetyCheckCentsFor>[0]): number => safetyCheckCentsFor(i).cents / 100;

/** "$349" for whole dollars, "$220.50" otherwise — the short form the approved office cards print. */
export function safetyCheckShort(cents: number): string {
  const whole = cents % 100 === 0;
  return `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}
