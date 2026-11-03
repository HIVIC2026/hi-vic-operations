// Part 2 (Jo 3 Nov 2026): the installer changes the electrician on its own job until the safety check (PIESA) is done.
// Pure rules and wording only; the swap itself is electrician-swap.server.ts.

export const SWAP_PIESA_DONE = "The safety check is done, so the electrician can't change";
export const SWAP_NOT_LINKED = "That electrician isn't linked to your business";
export const SWAP_NOT_ONBOARDED = "That electrician hasn't finished signing up";
export const SWAP_SAME = "That's already the electrician";

export const OWN_JOB_ELECTRICIAN_SWAPPED_EVENT = "own_job_electrician_swapped";
export const OWN_JOB_SWAP_FORM_NOT_MOVED_EVENT = "own_job_swap_form_not_moved";

/** Why this swap can't go ahead (null = fine). The first reason that applies wins. */
export function swapProblem(f: { piesaDone: boolean; linkedActive: boolean; onboarded: boolean; same: boolean }): string | null {
  if (f.piesaDone) return SWAP_PIESA_DONE;
  if (!f.linkedActive) return SWAP_NOT_LINKED;
  if (!f.onboarded) return SWAP_NOT_ONBOARDED;
  if (f.same) return SWAP_SAME;
  return null;
}

/** Off until Jo approves the "You're no longer on this job" email to the old electrician. */
export const OWN_JOB_SWAP_OLD_ELECTRICIAN_EMAIL_APPROVED: boolean = false;

/** The old electrician: they're off this job. (Held wording.) */
export function oldElectricianEmail(i: { address: string }): { subject: string; text: string } {
  return { subject: `You're no longer on ${i.address}`, text: `The installer has picked another electrician for the safety check (PIESA) at ${i.address}. You don't need to do anything. Your link no longer works.` };
}

/** The old electrician is emailed once per ended assignment. */
export const oldElectricianEmailKey = (assignmentId: string) => `electrician-swap:v1:${assignmentId}:old-electrician`;
