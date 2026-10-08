// Installer job page progress + one next action for installer-supplied (intake) jobs. Pure presentation from real records.
// Never decides workflow: each step is "done" only from its own fact (never from stage order).

export type ProgressStepKey = "review" | "quote" | "electrical" | "installation" | "evidence" | "veec";
export type ProgressStep = { key: ProgressStepKey; label: string; state: "done" | "current" | "todo"; note: string | null };
export type ProgressFacts = {
  coordination: "hivic_managed" | "self_managed" | null;
  quoted: "yes" | "no" | null;
  eligibility: "eligible" | "declined" | "unresolved";
  quoteHeld: string[];
  quoteStatus: "none" | "draft" | "issued" | "accepted";
  reconfirmationRequired: boolean;
  electricianPayer: "hivic" | "own" | "undecided";
  /** Current PIESA record with a pass outcome AND a recorded sign-off (an uploaded report alone is not clearance). */
  electricalCleared: boolean;
  installationCompleted: boolean;
  /** Required evidence items still missing or rejected. */
  evidenceMissing: number;
  /** AP approval recorded (stage change to ready_for_veec). */
  evidenceApprovedAt: string | null;
  veecStatus: string | null; // veec_lodgements.status: submitted | approved | query | rejected | other
  stage: string;
};
export type NextAction = { who: "You" | "Home Insulation Victoria" | "Owner" | "Electrician" | "Regulator" | null; text: string };

export const PROGRESS_LABELS: Record<ProgressStepKey, string> = {
  review: "Job review", quote: "Quote", electrical: "Electrical safety", installation: "Installation", evidence: "Evidence review", veec: "VEEC submission",
};

export function installerProgress(f: ProgressFacts): { steps: ProgressStep[]; next: NextAction } {
  const veecSubmitted = f.veecStatus === "submitted" || f.veecStatus === "approved" || f.veecStatus === "query";
  const done: Record<ProgressStepKey, boolean> = {
    review: f.eligibility === "eligible",
    quote: f.quoteStatus === "accepted" && !f.reconfirmationRequired,
    electrical: f.electricalCleared,
    installation: f.installationCompleted,
    evidence: f.evidenceApprovedAt != null,
    veec: veecSubmitted,
  };
  const notes: Partial<Record<ProgressStepKey, string>> = {};
  if (f.eligibility === "declined") notes.review = "Not eligible";
  if (f.quoteStatus === "issued") notes.quote = "Sent to owner";
  if (f.reconfirmationRequired) notes.quote = "Owner must reconfirm";
  if (f.veecStatus === "approved") notes.veec = "Registered";
  else if (f.veecStatus === "submitted") notes.veec = "Submitted — awaiting registration";
  else if (f.veecStatus === "query") notes.veec = "Submitted — regulator query";
  else if (f.veecStatus === "rejected") notes.veec = "Rejected by regulator";
  const keys: ProgressStepKey[] = ["review", "quote", "electrical", "installation", "evidence", "veec"];
  const firstOpen = keys.find((k) => !done[k]) ?? null;
  const steps = keys.map((k) => ({ key: k, label: PROGRESS_LABELS[k], state: done[k] ? "done" as const : k === firstOpen ? "current" as const : "todo" as const, note: notes[k] ?? null }));
  return { steps, next: nextAction(f, done) };
}

function nextAction(f: ProgressFacts, done: Record<ProgressStepKey, boolean>): NextAction {
  const HIV = "Home Insulation Victoria" as const;
  if (f.stage === "cancelled") return { who: null, text: "This job was cancelled." };
  if (f.stage === "on_hold") return { who: HIV, text: "Job is on hold while the office reviews it." };
  if (f.eligibility === "declined") return { who: null, text: "The owner isn't eligible, so this job won't go ahead." };
  const quotedYes = f.quoted === "yes";
  if (f.eligibility !== "eligible") {
    return { who: HIV, text: quotedYes ? "Check the owner's eligibility, then prepare the owner quote."
      : f.coordination === "self_managed" ? "Check the owner's eligibility. Then you measure and quote the job and add it below."
      : "Check the owner's eligibility, then arrange the Ready Check." };
  }
  if (!done.quote) {
    if (f.reconfirmationRequired) return { who: "Owner", text: "Reconfirm the updated quote." };
    if (f.quoteStatus === "issued") return { who: "Owner", text: "Review and accept the quote." };
    if (!quotedYes) return f.coordination === "self_managed"
      ? { who: "You", text: "Measure and quote the job, then add the details below." }
      : { who: HIV, text: "Arrange the Ready Check so the job can be measured and quoted." };
    if (f.quoteHeld.length) return { who: f.quoteHeld.some((b) => /installer|you|area|quote|fee|electrician/i.test(b)) ? "You" : HIV, text: `Owner quote on hold: ${f.quoteHeld[0]}` };
    return { who: HIV, text: "Prepare and send the owner quote." };
  }
  if (!done.electrical) return f.electricianPayer === "own"
    ? { who: "Electrician", text: "Your electrician completes the electrical safety check; the office verifies the report." }
    : f.electricianPayer === "undecided" ? { who: "You", text: "Choose who arranges the electrician (below)." }
    : { who: HIV, text: "Arrange the electrical safety check." };
  if (!done.installation) return { who: "You", text: "Complete the installation once it's booked." };
  if (!done.evidence) return f.evidenceMissing > 0
    ? { who: "You", text: `Upload ${f.evidenceMissing} missing or rejected evidence item${f.evidenceMissing === 1 ? "" : "s"}.` }
    : { who: HIV, text: "Review the installation evidence." };
  if (f.veecStatus === "rejected") return { who: HIV, text: "Resolve the regulator's rejection." };
  if (!done.veec) return { who: HIV, text: "Submit the VEEC claim." };
  if (f.veecStatus === "approved") return { who: null, text: "VEECs registered — nothing more to do." };
  if (f.veecStatus === "query") return { who: HIV, text: "Answer the regulator's query." };
  return { who: "Regulator", text: "Registration decision on the submitted VEEC claim." };
}

// ---- Installer Jobs tabs (My work) ----
export type InstallerTab = "action" | "progress" | "done";
export const INSTALLER_TABS: { key: InstallerTab; label: string }[] = [
  { key: "action", label: "Action needed" }, { key: "progress", label: "In progress" }, { key: "done", label: "Done" },
];
/** Done only from an actual final stage; Action needed only when the trade has a real task or offer. */
export function installerTab(place: "offers" | "needs_me" | "coming_up" | "moving", stage: string): InstallerTab {
  if (stage === "complete" || stage === "cancelled") return "done";
  if (place === "offers" || place === "needs_me") return "action";
  return "progress";
}
export function doneReason(stage: string): string {
  return stage === "cancelled" ? "Cancelled" : stage === "complete" ? "Job complete" : "Closed";
}
