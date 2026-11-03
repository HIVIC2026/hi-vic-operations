// Jo 3 Nov 2026 (approved plan): a job the portal created from a Mitti form never went through Add a job, so the
// installer is asked ONCE in the portal which of THEIR OWN electricians does the safety check. Home Insulation Victoria
// has no electricians, so there is no "Home Insulation Victoria arranges" answer. No answer by the time the safety check
// is due: their approved usual electrician is used; none → the job waits with an office Needs me row. Nothing is sent.
// PURE: no I/O.
import type { ElectricianPlan } from "./job-electrician.core";

export const MITTI_ELECTRICIAN_QUESTION = "Choose your electrician";
export const MITTI_ELECTRICIAN_OFFICE_LINE = "Installer to choose electrician";
export const MITTI_USUAL_USED_EVENT = "mitti_usual_electrician_used";
export const MITTI_ELECTRICIAN_HELD_EVENT = "mitti_electrician_choice_needed";

export type MittiQuestionFacts = {
  source: string | null | undefined;
  channel?: string | null;
  /** jobs.electrician_choice — any recorded value means a choice exists. */
  electricianChoice: string | null | undefined;
  hasNomination: boolean;
  hasElectricianAssigned: boolean;
  hasPiesaOffer: boolean;
  usualUsed?: boolean;
};

/** Open only for a Mitti pickup that has no electrician chosen, nominated, offered, assigned or defaulted yet. */
export function mittiElectricianQuestionOpen(f: MittiQuestionFacts): boolean {
  const installer = f.source === "installer_mitti" || f.channel === "installer_sourced";
  const unanswered = !f.electricianChoice || ["hivic_organise", "hivic_matched", "hivic"].includes(f.electricianChoice);
  return installer && unanswered && !f.hasNomination && !f.hasElectricianAssigned && !f.hasPiesaOffer && !f.usualUsed;
}

/** Only an own electrician is an answer: an approved one, or one already invited by the installer. */
export function mittiElectricianPlanProblem(plan: ElectricianPlan | null | undefined): string | null {
  if (!plan || plan.mode !== "mine") return "Choose one of your own electricians.";
  if (!plan.business_id && !plan.nomination_id) return "Choose one of your own electricians.";
  return null;
}

export type MittiFallback = { action: "proceed" } | { action: "use_usual"; businessId: string } | { action: "hold" };

/** At safety-check time: a recorded choice proceeds unchanged; else the approved usual electrician; else hold. */
export function mittiElectricianFallback(i: { questionOpen: boolean; usualApprovedBusinessId: string | null }): MittiFallback {
  if (!i.questionOpen) return { action: "proceed" };
  return i.usualApprovedBusinessId ? { action: "use_usual", businessId: i.usualApprovedBusinessId } : { action: "hold" };
}
