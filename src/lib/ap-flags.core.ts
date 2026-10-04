// Pure: turn existing records into AP review flags. Labels only — never decides eligibility or approves.
export const AREA_VARIANCE_PCT = 15;

export type ApFlagFacts = {
  estimatedAreaM2: number | null;
  measuredAreaM2: number | null;
  recordedVariancePct: number | null;
  measurementAcceptedReason: string | null;
  evidenceRejections: number;
  paymentOverrides: number;
  quoteManualEdits: number;
  visitIssues: string[]; // visit_events event names counting against owner or trade
};

const VISIT_TEXT: Record<string, string> = {
  owner_late_change: "Owner changed a visit within 24 hours",
  owner_no_show: "Owner was not home for a visit",
  trade_cancelled: "Trade cancelled a visit",
  trade_no_show: "Trade did not arrive for a visit",
};

export function areaVariancePct(f: Pick<ApFlagFacts, "estimatedAreaM2" | "measuredAreaM2" | "recordedVariancePct">): number | null {
  if (f.recordedVariancePct != null) return Math.abs(f.recordedVariancePct);
  if (!f.estimatedAreaM2 || f.measuredAreaM2 == null) return null;
  return Math.abs((f.measuredAreaM2 - f.estimatedAreaM2) / f.estimatedAreaM2) * 100;
}

export function apFlags(f: ApFlagFacts): string[] {
  const out: string[] = [];
  const v = areaVariancePct(f);
  if (v != null && v > AREA_VARIANCE_PCT) out.push(`Measured area is ${Math.round(v)}% from the estimate (over ${AREA_VARIANCE_PCT}%)`);
  if (f.measurementAcceptedReason) out.push(`Measurement accepted by the office with a reason: ${f.measurementAcceptedReason}`);
  if (f.evidenceRejections > 0) out.push(`Evidence was rejected ${f.evidenceRejections} time${f.evidenceRejections > 1 ? "s" : ""} and re-uploaded`);
  if (f.paymentOverrides > 0) out.push("An office payment override was used");
  if (f.quoteManualEdits > 0) out.push("The quote price was edited by hand");
  for (const e of [...new Set(f.visitIssues)]) if (VISIT_TEXT[e]) out.push(VISIT_TEXT[e]!);
  return out;
}

/** Flagged jobs need a note on approval; clean jobs may approve without one. Always one job at a time. */
export function approvalNoteBlocker(flags: string[], note: string | null | undefined): string | null {
  return flags.length > 0 && !(note ?? "").trim() ? "This job is flagged. Add a note saying why it is OK to approve." : null;
}
