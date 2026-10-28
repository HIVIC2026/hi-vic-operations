// Pure rules for the instant Ready Check form creation on Add a job (Jo 27 Oct): every skip/stop gets one
// plain internal note on the job so it can be traced; the 15-minute tick stays the backup.
export const IMMEDIATE_SKIP_EVENT = "mitti_ready_check_instant_skipped";

export type ImmediateFacts = {
  auditId: string | null; measurementComplete: boolean; installerUserId: string | null;
  mittiInvited: boolean; templateSet: boolean; autoSend: boolean; gateADone: boolean;
} | null;

/** Why the instant form creation will not start, or null when it may start. */
export function immediateSkipReason(f: ImmediateFacts): string | null {
  if (!f) return "job not found";
  if (f.auditId) return "a Mitti form is already on the job";
  if (f.measurementComplete) return "the Ready Check measurements are already complete";
  if (!f.installerUserId) return "no active installer is assigned";
  if (!f.mittiInvited) return "the installer's business is not invited to Mitti";
  if (!f.templateSet) return "no Mitti Ready Check form template is set";
  if (!f.autoSend) return "automatic Mitti forms are switched off";
  if (!f.gateADone) return "owner paperwork A is not done";
  return null;
}

/** Note for a creation that started but did not produce a form. Null when nothing needs noting. */
export function immediateOutcomeNote(outcome: "created" | "held" | "uncertain" | "failed"): string | null {
  if (outcome === "created") return null;
  if (outcome === "held") return "another form creation attempt is already in progress";
  if (outcome === "uncertain") return "Mitti's answer was unclear; check Mitti before retrying";
  return "Mitti refused or errored (see the form note on this job)";
}

export function immediateNoteSummary(reason: string): string {
  return `Instant Ready Check form not created on Add a job: ${reason}. The 15-minute check will try again.`;
}
