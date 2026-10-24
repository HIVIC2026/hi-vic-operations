// Mandatory evidence gate for AP review / Ready for VEEC (pure; used by stageEntryBlockers in workflow.server.ts).
// Same rule as before — AP review needs every required item uploaded or verified; Ready for VEEC needs every
// required item verified — but it now fails closed when the checklist can't be read or has no installation items.
export type ApEvidenceRow = { label: string; status: string; required: boolean; gate?: string | null };

export const EVIDENCE_READ_FAILED = "The evidence checklist could not be checked — please try again.";
export const EVIDENCE_CHECKLIST_MISSING = "This job has no installation evidence checklist — Home Insulation Victoria must restore it before Final check.";

/** Decision 205 extras: Activity Guide v1.2 Table 4 install evidence (install-evidence.core) and the Activity 48 product
 *  check (esc-approved-products.core), both already in plain words. Either list missing = nothing extra (never a pass). */
export type ApEvidenceExtras = { installEvidence?: string[] | null; productProblems?: string[] | null };

export function evidenceStageBlockers(to: "ap_review" | "ready_for_veec", rows: ApEvidenceRow[] | null, readFailed: boolean, extras: ApEvidenceExtras = {}): string[] {
  if (readFailed || !rows) return [EVIDENCE_READ_FAILED];
  const required = rows.filter((r) => r.required);
  const out: string[] = [];
  if (!required.some((r) => r.gate === "installation")) out.push(EVIDENCE_CHECKLIST_MISSING);
  for (const r of required) {
    if (to === "ap_review" && !["uploaded", "verified"].includes(r.status)) out.push(`Evidence missing: ${r.label}`);
    if (to === "ready_for_veec" && r.status !== "verified") out.push(`Evidence not verified: ${r.label}`);
  }
  // Table 4 items and the product register check block both AP review and Ready for VEEC, each item on its own line.
  out.push(...(extras.installEvidence ?? []), ...(extras.productProblems ?? []));
  return out;
}
