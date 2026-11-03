/** Installers' own jobs (Part 2, Jo 3 Nov 2026): the installer's chosen electrician calls the owner and books the safety
 *  check (PIESA). No offer, no owner 3-times step. HIV leads and in-house partner jobs keep their current flows. Pure. */

/** The reason every skipped offer path returns for these jobs. */
export const OWN_JOB_CALL_AND_BOOK = "own job: call and book" as const;
export type OwnJobCallAndBookReason = typeof OWN_JOB_CALL_AND_BOOK;

/** Office-facing line when someone tries the old offer path on one of these jobs. */
export const OWN_JOB_OFFER_MESSAGE = "This is the installer's own job — it goes straight to their electrician";

export const OWN_JOB_PIESA_HANDED_EVENT = "own_job_piesa_handed";
export const OWN_JOB_PIESA_HELD_EVENT = "own_job_piesa_held";

export const HOLD_NO_ELECTRICIAN = "No electrician chosen for this job";
export const HOLD_NO_PROFILE = "Electrician has no portal profile";
export const HOLD_NOT_SIGNED_UP = "Electrician hasn't finished signing up";

/** The two stages a hand-over can start from: first time (measured_quote_accepted), or a new round / in-flight job
 *  already at the PIESA stage with no electrician for the current round. */
export const OWN_JOB_HANDOFF_STAGES = ["measured_quote_accepted", "piesa_and_install_window_pending"] as const;

export function isOwnJobCallAndBook(j: { channel: string | null; heldInHouse: boolean }): boolean {
  return j.channel === "installer_sourced" && !j.heldInHouse;
}

export type OwnJobHandoffPlan = { kind: "hand" } | { kind: "wait"; reason: string } | { kind: "hold"; reason: string };

/** Hand only when the safety check fee is paid, the job sits in a hand-over stage and it was not handed already this round. */
export function ownJobHandoffPlan(f: { paid: boolean; stage: string; electricianBusinessId: string | null; electricianUserId: string | null; alreadyHanded: boolean; electricianNotSignedUp?: boolean }): OwnJobHandoffPlan {
  if (f.alreadyHanded) return { kind: "wait", reason: "Already handed to the electrician" };
  if (!f.paid) return { kind: "wait", reason: "Safety check (PIESA) fee not paid yet" };
  if (!(OWN_JOB_HANDOFF_STAGES as readonly string[]).includes(f.stage)) return { kind: "wait", reason: "Job is not waiting for its safety check (PIESA)" };
  if (!f.electricianBusinessId) return { kind: "hold", reason: f.electricianNotSignedUp ? HOLD_NOT_SIGNED_UP : HOLD_NO_ELECTRICIAN };
  if (!f.electricianUserId) return { kind: "hold", reason: HOLD_NO_PROFILE };
  return { kind: "hand" };
}

/** One hand-over per job per safety check round (round = the latest reopen, or "first"). */
export function ownJobHandoffKey(jobId: string, reopenAt: string | null): string {
  return `own_job_piesa:${jobId}:${reopenAt ?? "first"}`;
}

export const OWN_JOB_PIESA_NOT_BOOKED_EVENT = "own_job_piesa_not_booked";

/** After the 2 business days (`dueAt` = the end of that Melbourne day, from the hand-over event) with no booking, the
 *  job is "returned" to the installer office once: one event, one email. The electrician's link keeps working. */
export function deadlineAction(f: { dueAt: string; booked: boolean; alreadyReturned: boolean; now: Date }): "none" | "return" {
  if (f.booked || f.alreadyReturned) return "none";
  const due = Date.parse(f.dueAt);
  return Number.isFinite(due) && f.now.getTime() > due ? "return" : "none";
}

/** Part 3 Task 4b (Jo 4 Nov 2026): electricians on installers' own jobs have no login, so nobody presses Complete PIESA.
 *  A Complete A3 synced at PIESA booked completes the PIESA itself, once per Mitti form (claim = this event). */
export const PIESA_AUTO_COMPLETED_EVENT = "piesa_auto_completed";
/** The auto-complete was refused: ONE office row per form, shown while the PIESA is still booked. */
export const OWN_JOB_PIESA_COMPLETE_HELD_EVENT = "own_job_piesa_complete_held";

export const ownJobPiesaCompleteHeldLine = (reason: string) => `PIESA done in Mitti but couldn't be completed — ${reason.trim() || "reason not recorded"}`;

/** The open held row: the newest held event, only while the job is still at PIESA booked (a completed PIESA clears it). */
export function ownJobPiesaCompleteHeldOpen(events: { event_type: string; created_at: string; details?: Record<string, unknown> | null }[], stage: string | null): { at: string; reason: string } | null {
  if (stage !== "piesa_scheduled") return null;
  const last = events.filter((e) => e.event_type === OWN_JOB_PIESA_COMPLETE_HELD_EVENT).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!last) return null;
  return { at: last.created_at, reason: String(last.details?.["reason"] ?? "") };
}
