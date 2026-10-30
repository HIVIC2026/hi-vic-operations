// Repeat PIESA Mitti form (Jo 29 Oct 2026): after the 30-day window lapses, the repeat PIESA gets its OWN new Mitti form,
// made automatically when its time is booked (decision 398 path), never twice for the same repeat round. PURE.
// The job keeps its one `assessments` row: when the repeat PIESA is booked, the first check moves to history ONCE per lapsed
// deadline (a `repeat_piesa_form_reset` event holding the first form's id/outcome/date; its `piesa_records` row stays) and
// the row is reset for the new round. The PIESA create claim then moves to a new generation (mitti-create-claim.core).

export const REPEAT_PIESA_FORM_RESET_EVENT = "repeat_piesa_form_reset";

/** Stable event id seed: one reset per job per lapsed deadline (a duplicate insert is ignored). */
export const repeatFormResetSeed = (jobId: string, deadline: string) => `repeat-piesa-form:${jobId}:${deadline}`;

/** The assessments row at the start of a new PIESA round. */
export const ASSESSMENT_ROUND_RESET = {
  status: "in_progress",
  completed_at: null,
  piesa_outcome: "pending",
  assessed_on: null,
  no_rectification_confirmed: null,
  external_mitti_id: null,
  mitti_template_id: null,
  mitti_raw_snapshot: null,
  mitti_sync_status: "not_synced",
  mitti_last_error: null,
  // Fix round 1 (coordinator ruling): the first form's completion facts must not carry into the new round.
  mitti_completed: false,
  mitti_synced_at: null,
  mitti_modified_at: null,
  mitti_validation_issues: [],
} as const;

/**
 * "reset" = move the first check to history now. No lapsed deadline → "none". No reset event for this deadline → "reset".
 * The event exists → "reset" only while the row is still the old round (a crash between the event and the row update).
 */
export function repeatFormStep(f: {
  repeatDeadline: string | null;
  reset: { previousAuditId: string | null } | null;
  current: { auditId: string | null; status: string } | null;
}): "reset" | "none" {
  if (!f.repeatDeadline) return "none";
  if (!f.reset) return "reset";
  const c = f.current;
  return c && c.status === "complete" && c.auditId === f.reset.previousAuditId ? "reset" : "none";
}

/** The first completed PIESA is the initial record; any later one (the repeat) is a reassessment. */
export function piesaCompletionKind(priorOfficialRecords: number): "initial" | "reassessment" {
  return priorOfficialRecords > 0 ? "reassessment" : "initial";
}
