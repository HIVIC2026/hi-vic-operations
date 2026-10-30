// O3 Jobs + O4 Enquiries structure (decisions 226, 238, 239, 281; one pile per job, Jo 21 Oct).
// Enquiries = every job BEFORE a spot is saved, in ONE list (decision 281: the Fix details pile is gone — the portal
// completes addresses itself; every enquiry is "Waiting on owner").
// Jobs = six stages from a saved spot: Choose installer · Ready Check · Quote · PIESA · Install · Final check,
// plus Closed (Completed · Cancelled · Ineligible · Removed / test). PURE: labels and piles only, never moves a job.
import type { Stage } from "./workflow";

export type JobsStage = "choose_installer" | "ready_check" | "quote" | "piesa" | "install" | "final_check";
export const JOBS_STAGES: { key: JobsStage; label: string }[] = [
  { key: "choose_installer", label: "Choose installer" },
  { key: "ready_check", label: "Ready Check" },
  { key: "quote", label: "Quote" },
  { key: "piesa", label: "PIESA" },
  { key: "install", label: "Install" },
  { key: "final_check", label: "Final check" },
];
export const JOBS_STAGE_LABEL = Object.fromEntries(JOBS_STAGES.map((s) => [s.key, s.label])) as Record<JobsStage, string>;
export const JOBS_STAGE_KEYS = JOBS_STAGES.map((s) => s.key);

const PRE_INSTALLER = new Set(["new_enquiry", "eligibility_review", "preliminary_estimate_ready", "ready_check_awaiting_acceptance", "ready_check_awaiting_payment", "ready_check_ready_to_schedule"]);
const READY_CHECK = new Set(["ready_check_awaiting_acceptance", "ready_check_awaiting_payment", "ready_check_ready_to_schedule", "ready_check_scheduled"]);
const QUOTE = new Set(["ready_check_complete", "measured_estimate_ready", "assessment_complete", "ready_for_installer_quotes", "awaiting_quote_acceptance"]);
const PIESA = new Set(["measured_quote_accepted", "awaiting_deposit_payment", "piesa_and_install_window_pending", "awaiting_electrician", "assessment_booking", "assessment_booked", "piesa_scheduled",
  "rectification_required", "electrical_variation_pending", "awaiting_owner_rectification_approval", "rectification_scheduling", "rectification_booked"]);
const INSTALL = new Set(["piesa_complete", "installation_scheduling", "installation_booked", "evidence_outstanding"]);
const FINAL = new Set(["ap_review", "ready_for_veec"]);

/**
 * The one Jobs stage for an active job. On hold keeps the stage it was at (prior_stage). A job with no installer yet
 * (our lead, spot saved) is "Choose installer"; installers' own jobs always have their originating installer.
 */
export function jobsStage(j: { stage: string | null; priorStage?: string | null; hasInstaller: boolean }): JobsStage | null {
  const s = j.stage === "on_hold" ? j.priorStage ?? null : j.stage;
  if (!s || s === "complete" || s === "cancelled") return null;
  if (PRE_INSTALLER.has(s) && !j.hasInstaller) return "choose_installer";
  if (READY_CHECK.has(s) || PRE_INSTALLER.has(s)) return "ready_check";
  if (QUOTE.has(s)) return "quote";
  if (PIESA.has(s)) return "piesa";
  if (INSTALL.has(s)) return "install";
  if (FINAL.has(s)) return "final_check";
  return null;
}

/**
 * Enquiries is ONE list (decision 281). Only enquiries (before a spot is saved) belong here and every one of them is
 * "Waiting on owner": reminders are automatic, addresses complete themselves, nothing for the office until they answer.
 */
export const ENQUIRY_LIST = { key: "waiting_owner", label: "Waiting on owner" } as const;
export type EnquiryPile = typeof ENQUIRY_LIST.key;
export const enquiryPile = (): EnquiryPile => ENQUIRY_LIST.key;

/** "Waiting on" column (decision 238: spot offered / 3 questions asked; reminders automatic). */
export type WaitingOnFacts = {
  enquiryStatus: string | null; // office_enquiry_index.enquiry_status
  needsFirstResponse: boolean;
  latestSend: { purpose: string; at: string; status: string } | null;
  reminders: number; // owner reminders sent so far (save my spot / 3 questions / estimate follow-ups)
  answeredQuestions: boolean;
  latestFailed: boolean;
};
const day = (iso: string) => new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Melbourne" });
export function waitingOnLine(f: WaitingOnFacts): string {
  if (f.latestFailed) return "Estimate email failed · on Needs me";
  if (f.needsFirstResponse || !f.latestSend) return "Estimate goes out automatically";
  const when = day(f.latestSend.at);
  const reminder = f.reminders > 0 ? ` · reminder ${f.reminders} sent` : "";
  if (f.enquiryStatus === "insulation_requested") return `Asked the 3 questions ${when}${f.answeredQuestions ? " · answered" : " · no answer"}${reminder}`;
  return `Spot offered ${when}${reminder}`;
}

/** Closed tab "Why" column. */
export function closedWhy(j: { stage: string | null; cancelledReason: string | null; installedAt: string | null; veecSubmittedAt: string | null; source: string | null; removed: boolean }): string {
  if (j.source === "qa_test") return "Marked as test";
  if (j.removed) return "Removed from the list";
  if (j.stage === "complete") return [j.installedAt && `Install complete ${day(j.installedAt)}`, j.veecSubmittedAt && `VEEC lodged ${day(j.veecSubmittedAt)}`].filter(Boolean).join(" · ") || "Complete";
  if (j.stage === "cancelled") return j.cancelledReason?.trim() || "Cancelled";
  return j.cancelledReason?.trim() || "Not eligible";
}

/** Reopen (decision 227): back to the stage it was at, never into a retired stage; complete jobs cannot be reopened here. */
export function reopenBlocker(j: { stage: string | null; priorStage: string | null; retired: (s: string) => string | null }): string | null {
  if (j.stage === "complete") return "Completed jobs stay closed. Their record is final.";
  if (j.stage !== "cancelled") return "Only a cancelled job can be reopened.";
  if (!j.priorStage) return "This job has no earlier stage recorded, so it can't be reopened automatically.";
  const r = j.retired(j.priorStage);
  return r ? `It was at a retired step (${j.priorStage.replaceAll("_", " ")}): ${r}` : null;
}

/**
 * Where a cancelled job goes when it is reopened (Jo 28 Oct 2026, batch 1 task 6). A booked or done Ready Check goes back
 * to "choose installer" (the released installer is not re-offered). From the safety check (PIESA) on, the old check no
 * longer counts: back to PIESA pending and a NEW safety check is needed. Stages it doesn't know stay as they were.
 */
const REOPEN_TO_CHOOSE_INSTALLER = new Set(["ready_check_scheduled", "ready_check_complete", "measured_estimate_ready"]);
const REOPEN_NEW_PIESA_FROM: Stage = "piesa_and_install_window_pending";
// "PIESA stage or later", listed (not by STAGE_ORDER position: the legacy ready_for_installer_quotes /
// awaiting_quote_acceptance sit after it there but come before quote acceptance — they reopen to themselves).
const REOPEN_TO_NEW_PIESA = new Set<string>([
  "piesa_and_install_window_pending", "piesa_scheduled", "piesa_complete", "electrical_variation_pending", "rectification_required",
  "awaiting_owner_rectification_approval", "awaiting_deposit_payment", "rectification_scheduling", "rectification_booked",
  "installation_scheduling", "installation_booked", "evidence_outstanding", "ap_review",
]);
export function reopenStageFor(priorStage: string): { stage: string; needsNewPiesa: boolean } {
  if (REOPEN_TO_CHOOSE_INSTALLER.has(priorStage)) return { stage: "ready_check_ready_to_schedule", needsNewPiesa: false };
  if (REOPEN_TO_NEW_PIESA.has(priorStage)) return { stage: REOPEN_NEW_PIESA_FROM, needsNewPiesa: true };
  return { stage: priorStage, needsNewPiesa: false };
}

export type ReopenFacts = {
  stage: string | null;
  priorStage: string | null;
  eligibilityOutcome: string | null;
  source: string | null;
  /** Source recorded on the latest "marked_test" event (null = born a TEST job or marked before it was recorded). */
  testPriorSource: string | null;
  /** A "lead_removed" event exists: the list view keeps it in Removed for good. */
  removedLead: boolean;
  /** Second contact for the same owner/property (contact_rank > 1): it is the other job's duplicate. */
  duplicateContact: boolean;
  retired: (s: string) => string | null;
};
export type ReopenPlan =
  | { ok: false; blocker: string }
  | { ok: true; stage: string | null; clearIneligible: boolean; source: string | null };

/**
 * Reopen from Closed (decision 227; office gaps A4): every closed reason except Completed, always with a reason.
 * Undoes exactly what closed it: a cancelled stage goes back to the stage it was at; an ineligible decision goes back
 * to "confirm on site" (decision 238: eligibility is decided at the Ready Check); a job marked as test gets its recorded
 * source back. Born-TEST jobs, removed leads and duplicate contacts cannot be reopened (they stay where they are).
 */
export function reopenPlan(f: ReopenFacts): ReopenPlan {
  if (f.stage === "complete") return { ok: false, blocker: "Completed jobs stay closed. Their record is final." };
  if (f.removedLead) return { ok: false, blocker: "Removed leads (duplicates / junk) stay in Removed. Add a new enquiry if the owner comes back." };
  if (f.duplicateContact) return { ok: false, blocker: "This is a second contact for the same owner and property — open the other job instead." };
  let source: string | null = null;
  if (f.source === "qa_test") {
    if (!f.testPriorSource || f.testPriorSource === "qa_test") return { ok: false, blocker: "This was created as a TEST job (or its earlier source was not recorded), so it stays a test record." };
    source = f.testPriorSource;
  }
  let stage: string | null = null;
  if (f.stage === "cancelled") {
    const b = reopenBlocker({ stage: f.stage, priorStage: f.priorStage, retired: f.retired });
    if (b) return { ok: false, blocker: b };
    stage = f.priorStage;
  }
  const clearIneligible = f.eligibilityOutcome === "does_not_appear_eligible";
  if (!stage && !clearIneligible && !source) return { ok: false, blocker: "Nothing recorded on this job can be undone by reopening it." };
  return { ok: true, stage, clearIneligible, source };
}

/** Surname for one-line rows ("Papadopoulos"); full name when only one word. */
export function surnameOf(full: string | null | undefined): string {
  const w = (full ?? "").trim().split(/\s+/).filter(Boolean);
  return w.at(-1) ?? "";
}
