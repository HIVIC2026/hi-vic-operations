// Pure auto-progression planner. No database / network: the server wrapper injects facts and actions.
// Rule: only objective, already-recorded facts move a job. Human judgement (eligibility decision,
// contractor selection, quote acceptance, measure-up approval, AP judgement, overrides, VEEC data) is never automated.
import type { Stage } from "./workflow";

export type AdvanceFacts = {
  eligibilityConfirmed: boolean; // admin-set (eligibility_set_by) and not "does not appear eligible"
  /** A current ceiling measure-up has been accepted (e.g. an installer's own complete measure-up) – the Ready Check isn't needed. */
  measureUpAccepted?: boolean;
  electricianAssigned: boolean;
  assessmentBookingConfirmed: boolean;
  openRectItems: number;
  rectQuoteIssued: boolean;
  rectQuoteAccepted: boolean;
  installQuotesIssued: boolean;
  installQuoteAccepted: boolean;
  consumerSigned: boolean;
  invoiceExists: boolean;
  depositCleared: boolean;
  rectBookingConfirmed: boolean;
  installBookingConfirmed: boolean;
  installationCompleted: boolean;
  installerDeclarationSigned: boolean;
  veecLodged: boolean; // submitted or approved
};

export type Step =
  | { kind: "transition"; to: Stage; summary: string }
  | { kind: "generate_quotes"; to: Stage; summary: string }
  | { kind: "complete_site"; to: Stage; summary: string }
  | { kind: "stop"; reason: string };

export const TERMINAL: Stage[] = ["complete", "on_hold", "cancelled"];

/** The single deterministic next step for a stage, or a stop with the reason (who/what it waits on). */
export function planStep(stage: Stage, f: AdvanceFacts, opts: { allowApPromotion?: boolean } = {}): Step {
  const t = (to: Stage, summary: string): Step => ({ kind: "transition", to, summary });
  const stop = (reason: string): Step => ({ kind: "stop", reason });
  switch (stage) {
    case "new_enquiry":
    case "eligibility_review":
      if (!f.eligibilityConfirmed) return stop("HI VIC must confirm Gate 1 eligibility");
      return f.measureUpAccepted ? t("ready_check_complete", "Eligibility confirmed – accepted measure-up already on file, no Ready Check needed") : t("ready_check_ready_to_schedule", "Eligibility confirmed – free installer Ready Check next");
    case "ready_check_ready_to_schedule":
      return f.measureUpAccepted ? t("ready_check_complete", "Accepted measure-up on file – Ready Check not needed") : stop("HI VIC must assign an installer for the free Ready Check");
    case "awaiting_electrician":
      return f.electricianAssigned ? t("assessment_booking", "Electrician assigned – booking PIESA") : stop("HI VIC must assign an electrician for PIESA");
    case "assessment_booking":
      return f.assessmentBookingConfirmed ? t("assessment_booked", "Assessment booking confirmed") : stop("Assessment booking not confirmed");
    case "assessment_booked":
      // Delegated to advanceSiteRequirements (derives rectification scope + routing through transition()).
      return { kind: "complete_site", to: "assessment_complete", summary: "Site requirements complete" };
    case "assessment_complete":
      return f.openRectItems > 0 ? t("rectification_required", `${f.openRectItems} rectification item(s) required`) : t("ready_for_installer_quotes", "No rectification required – ready for installer quotes");
    case "rectification_required":
      return f.rectQuoteIssued ? t("awaiting_owner_rectification_approval", "Rectification quote issued to owner") : stop("Rectification quote not yet issued");
    case "awaiting_owner_rectification_approval":
      return f.rectQuoteAccepted ? t("ready_for_installer_quotes", "Rectification scope approved – preparing final installation quotes") : stop("Owner must approve the rectification scope");
    case "ready_for_installer_quotes":
      return f.installQuotesIssued ? t("awaiting_quote_acceptance", "Installation quotes issued to owner") : { kind: "generate_quotes", to: "awaiting_quote_acceptance", summary: "Installation quotes auto-generated from active rate cards and issued to owner" };
    case "awaiting_quote_acceptance":
      if (!f.installQuoteAccepted) return stop("Owner must accept an installation quote");
      if (!f.consumerSigned) return stop("Customer Agreement / Quote Acceptance not signed");
      if (!f.invoiceExists) return stop("Xero invoice not yet created");
      return t("awaiting_deposit_payment", "Owner accepted final installation quote – 50% deposit due");
    case "awaiting_deposit_payment":
      if (!f.depositCleared) return stop("Waiting on 50% deposit payment in Xero");
      return f.openRectItems > 0 ? t("rectification_scheduling", "Deposit cleared – rectification scheduling unlocked") : t("installation_scheduling", "Deposit cleared – installation scheduling unlocked");
    case "rectification_scheduling":
      return f.rectBookingConfirmed ? t("rectification_booked", "Rectification booking confirmed") : stop("Rectification booking not confirmed");
    case "rectification_booked":
      return f.openRectItems === 0 ? t("installation_scheduling", "Rectification complete, PIESA passed – installation scheduling unlocked") : stop("Rectification works not yet completed");
    case "installation_scheduling":
      return f.installBookingConfirmed ? t("installation_booked", "Installation booking confirmed") : stop("Installation booking not confirmed");
    case "installation_booked":
      return f.installationCompleted ? t("evidence_outstanding", "Installation completed") : stop("Installer must complete the installation");
    case "evidence_outstanding":
      if (!f.installationCompleted) return stop("Installation not recorded as complete");
      if (!f.installerDeclarationSigned) return stop("Installer declaration not signed");
      return t("ap_review", "All required evidence uploaded and declarations signed – submitted for AP review");
    case "ap_review":
      // AP judgement is human: only promote when invoked from an admin compliance/AP action.
      return opts.allowApPromotion ? t("ready_for_veec", "All compliance requirements passed – Ready for VEEC") : stop("AP review by HI VIC");
    case "ready_for_veec":
      return f.veecLodged ? t("complete", "VEEC lodged – job complete") : stop("VEEC lodgement not submitted");
    default:
      return stop(`${stage} does not auto-progress`);
  }
}

export type AdvanceDeps = {
  getStage: () => Promise<Stage>;
  facts: () => Promise<AdvanceFacts>;
  blockers: (to: Stage) => Promise<string[]>;
  transition: (to: Stage, summary: string) => Promise<void>;
  generateQuotes: () => Promise<void>;
  /** Runs the site-requirements completion; returns false when measure-up/PIESA are still outstanding. */
  completeSite: () => Promise<boolean>;
};

export type AdvanceResult = { from: Stage; to: Stage; steps: Stage[]; stoppedBecause: string };

export const MAX_AUTO_STEPS = 20;

/** Advance as far as safely possible. Idempotent: re-running on an unchanged job does nothing. */
export async function runAutoAdvance(deps: AdvanceDeps, opts: { allowApPromotion?: boolean } = {}): Promise<AdvanceResult> {
  const from = await deps.getStage();
  let stage = from;
  const steps: Stage[] = [];
  const seen = new Set<Stage>([stage]);
  for (let i = 0; i < MAX_AUTO_STEPS; i++) {
    if (TERMINAL.includes(stage)) return { from, to: stage, steps, stoppedBecause: `Job is ${stage.replaceAll("_", " ")}` };
    const step = planStep(stage, await deps.facts(), opts);
    if (step.kind === "stop") return { from, to: stage, steps, stoppedBecause: step.reason };
    if (step.kind === "complete_site") {
      const ok = await deps.completeSite();
      const next = await deps.getStage();
      if (!ok || next === stage) return { from, to: next, steps, stoppedBecause: "Site requirements outstanding (measure-up and/or electrical/PIESA)" };
      stage = next; steps.push(stage); seen.add(stage);
      continue;
    }
    const blockers = (await deps.blockers(step.to)).filter((b) => !(step.kind === "generate_quotes" && b === "No installation quotes issued."));
    if (blockers.length) return { from, to: stage, steps, stoppedBecause: `Blocked: ${blockers.join(" • ")}` };
    if (step.kind === "generate_quotes") {
      try { await deps.generateQuotes(); } catch (e) { return { from, to: stage, steps, stoppedBecause: `Quote generation stopped: ${(e as Error).message}` }; }
      const after = await deps.blockers(step.to);
      if (after.length) return { from, to: stage, steps, stoppedBecause: `Blocked: ${after.join(" • ")}` };
    }
    await deps.transition(step.to, `Auto: ${step.summary}`);
    stage = await deps.getStage();
    if (stage !== step.to || seen.has(stage)) return { from, to: stage, steps, stoppedBecause: "Loop guard" };
    seen.add(stage);
    steps.push(stage);
  }
  return { from, to: stage, steps, stoppedBecause: "Step limit reached" };
}
