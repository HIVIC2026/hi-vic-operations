/** Read-only office signal; money must be confirmed on the safety-check step's own invoice. */
export type PaidGateWarning = { paid: boolean; at: string; blockers: string[] };
export function paidGateWarningLine(f: PaidGateWarning | null | undefined): string | null {
  if (!f?.paid) return null;
  const reasons = [...new Set(f.blockers.map(s => s.trim()).filter(Boolean))];
  if (!reasons.length) return null;
  const paperwork = reasons.filter(s => /^Owner paperwork [A-D]: /.test(s));
  const other = reasons.filter(s => !/^Owner paperwork [A-D]: /.test(s));
  const parts = [paperwork.length ? `waiting on owner paperwork: ${paperwork.map(s => s.replace(/^Owner paperwork [A-D]: /, "")).join("; ")}` : null,
    other.length ? `blocked: ${other.join("; ")}` : null].filter(Boolean);
  return `Paid, ${parts.join(" · ")}`;
}