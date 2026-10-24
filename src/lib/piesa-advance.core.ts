// PURE Phase 1 rule: after an electrician records the PIESA result, may the job leave `piesa_scheduled`?
// No database, no network. `requirements.server.ts` gathers the facts and applies the decision.
//
// Why this exists: the manual electrician result can be completed at `piesa_scheduled` (S64), but
// `advanceSiteRequirements` only knew the retired `assessment_booked` path, so a completed PIESA left the
// job and its Office next_action unchanged (Brief R, F-1). The allowed forward transition from
// `piesa_scheduled` is `piesa_complete` (workflow.server TRANSITIONS) — for a pass AND for a fail, because
// the stage means "the PIESA visit is complete", not "the PIESA passed". Rectification is scheduled from
// `piesa_complete`. Nothing here decides compliance; it only refuses to move on incomplete facts.

export const PIESA_RECORDED_OUTCOMES = ["pass", "fail"] as const;
export type PiesaRecordedOutcome = (typeof PIESA_RECORDED_OUTCOMES)[number];

/** The one stage this rule applies to. Every other stage keeps its existing behaviour. */
export const PIESA_ADVANCE_STAGE = "piesa_scheduled" as const;

export type PiesaAdvanceFacts = {
  stage: string | null | undefined;
  /** `assessments.status` — 'complete' only once the electrician has finalised the result. */
  assessmentStatus: string | null | undefined;
  /** `assessments.piesa_outcome` — 'pending' | 'pass' | 'fail'. */
  outcome: string | null | undefined;
  /** True only when the assessment is complete AND a current `piesa_records` row exists. */
  hasCurrentPiesa: boolean;
  /** Decision 178: PIESA evidence blockers from the stored onsite-form snapshot (`piesaEvidenceHold`);
   *  empty (or omitted for a manual PIESA) means the evidence is in. Any blocker holds the job. */
  evidenceBlockers?: string[];
};

export type PiesaAdvanceDecision =
  | { action: "advance"; outcome: PiesaRecordedOutcome }
  | { action: "hold"; reason: string };

export const PIESA_HOLD = {
  wrongStage: "Only a job at PIESA Scheduled is advanced by an electrical assessment result.",
  notComplete: "Electrical assessment is not complete yet.",
  noOutcome: "PIESA outcome not recorded yet.",
  noRecord: "No current PIESA record.",
  /** Decision 178 — the onsite-form PIESA evidence is not all in. */
  evidence: (blockers: string[]) => `PIESA evidence still needed: ${blockers.join("; ")}`,
} as const;

/** Advance only on a genuinely completed assessment with a recorded outcome and a current PIESA record. */
export function piesaAdvanceDecision(f: PiesaAdvanceFacts): PiesaAdvanceDecision {
  if (f.stage !== PIESA_ADVANCE_STAGE) return { action: "hold", reason: PIESA_HOLD.wrongStage };
  if (f.assessmentStatus !== "complete") return { action: "hold", reason: PIESA_HOLD.notComplete };
  if (f.evidenceBlockers?.length) return { action: "hold", reason: PIESA_HOLD.evidence(f.evidenceBlockers) };
  const outcome = String(f.outcome ?? "").trim().toLowerCase();
  if (!(PIESA_RECORDED_OUTCOMES as readonly string[]).includes(outcome)) return { action: "hold", reason: PIESA_HOLD.noOutcome };
  if (!f.hasCurrentPiesa) return { action: "hold", reason: PIESA_HOLD.noRecord };
  return { action: "advance", outcome: outcome as PiesaRecordedOutcome };
}

/** The canonical Office next_action for the destination stage, so callers never invent wording. */
export const PIESA_COMPLETE_NEXT_ACTION = "Reconcile PIESA scope against allowance";

/** Rectification must be worked before installation can be scheduled, for a fail or for any priced item. */
export function piesaNeedsRectification(outcome: string | null | undefined, rectificationItemCount: number): boolean {
  return outcome === "fail" || rectificationItemCount > 0;
}

/** A passed PIESA with nothing to rectify clears both electrical compliance checks. */
export function piesaClearsElectrical(outcome: string | null | undefined, rectificationItemCount: number): boolean {
  return outcome === "pass" && rectificationItemCount === 0;
}
