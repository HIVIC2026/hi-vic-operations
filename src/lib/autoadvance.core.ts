// Pure auto-progression planner. No database / network: the server wrapper injects facts and actions.
// Rule: only objective, already-recorded facts move a job. Human judgement (eligibility decision,
// contractor selection, quote acceptance, measure-up approval, AP judgement, overrides, VEEC data) is never automated.
// Jo 24 Oct exception, outside this planner: a Mitti Ready Check marked Complete with clean answers records its own
// measurements and form eligibility and moves to the quote stage (mitti-complete.server.ts, guarded transitions).
import type { Stage } from "./workflow";

export type AdvanceFacts = {
  eligibilityConfirmed: boolean; // admin-set (eligibility_set_by) and not "does not appear eligible"
  /** Home Insulation Victoria has explicitly approved (accepted_by set) the current measure-up, e.g. an installer's own – only then is the Ready Check skipped. */
  measureUpAccepted?: boolean;
  /** jobs.channel = installer_sourced: the installer's own customer. Jo 24 Oct 2026 (HV-3151): such a job never waits for
   *  the owner to "save their spot" — the installer does the Ready Check (Mitti form), so it goes straight to Ready Check ready to schedule. */
  installerSourced?: boolean;
  electricianAssigned: boolean;
  assessmentBookingConfirmed: boolean;
  openRectItems: number;
  /** Decision 314 follow-up: the A4's ONLY repair tick is "Be on site at the start of the install day" (fixes-times.core
   *  `onsiteStartOnly`) — no fixes visit ever. Absent = false (read only when fixes items are open). */
  onsiteStartOnly?: boolean;
  /** …and electrical clearance holds on the `electrician_at_start` basis (fixes quote accepted + payment rule cleared,
   *  allocation.core `onsiteStartAtInstall`). The open items are done on the install day. Absent = false. */
  onsiteStartCleared?: boolean;
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
export const INSTALLER_OWN_CUSTOMER_SUMMARY = "Installer's own customer – the installer does the Ready Check (Mitti form); no spot to save";

/** The single deterministic next step for a stage, or a stop with the reason (who/what it waits on). */
export const ONSITE_START_INSTALL_SUMMARY = "Electrician on site at the start of the install day (fixes quote accepted and paid) – no fixes visit, installation scheduling unlocked";
export const ONSITE_START_WAITING = "Waiting for the owner to accept and pay the fixes quote (electrician on site at the start of the install day)";

export function planStep(stage: Stage, f: AdvanceFacts): Step {
  const t = (to: Stage, summary: string): Step => ({ kind: "transition", to, summary });
  const stop = (reason: string): Step => ({ kind: "stop", reason });
  // Decision 314 follow-up: open fixes items that are done on the install day never route to a fixes visit.
  const onsiteCleared = f.openRectItems > 0 && !!f.onsiteStartCleared;
  const onsiteWaiting = f.openRectItems > 0 && !!f.onsiteStartOnly && !f.onsiteStartCleared;
  switch (stage) {
    case "new_enquiry":
    case "eligibility_review":
      if (f.measureUpAccepted && (f.eligibilityConfirmed || f.installerSourced)) return t("ready_check_complete", "Eligibility confirmed – accepted Ready Check already on file, no Ready Check needed");
      // Jo 24 Oct (HV-3151): an installer's own customer has no spot to save — the installer's Mitti Ready Check is next.
      if (f.installerSourced) return t("ready_check_ready_to_schedule", INSTALLER_OWN_CUSTOMER_SUMMARY);
      if (!f.eligibilityConfirmed) return stop("Home Insulation Victoria must confirm Gate 1 eligibility");
      // Jo, 8 Oct: the Ready Check comes only AFTER the owner saves their spot.
      return t("preliminary_estimate_ready", "Eligibility passed – waiting for the owner to save their spot");
    case "preliminary_estimate_ready":
      if (f.measureUpAccepted) return t("ready_check_complete", "Accepted Ready Check on file – Ready Check not needed");
      // Jo 24 Oct (HV-3151): a job the website checks parked here is an installer's customer — move it on, never wait for a spot.
      if (f.installerSourced) return t("ready_check_ready_to_schedule", INSTALLER_OWN_CUSTOMER_SUMMARY);
      return stop("Waiting for the owner to save their spot");
    case "ready_check_ready_to_schedule":
      return f.measureUpAccepted ? t("ready_check_complete", "Accepted Ready Check on file – Ready Check not needed") : stop("Home Insulation Victoria must assign an installer for the free Ready Check");
    case "awaiting_electrician":
    case "assessment_booking":
    case "assessment_booked":
      // Retired legacy electrician-assessment path: never auto-advance; office moves the job back to the Ready Check.
      return stop("Retired legacy stage – Home Insulation Victoria must move this job to the free Ready Check");
    case "piesa_complete":
      // No rectification: the same unlock as after payment (installation_scheduling entry still needs a passing current
      // PIESA, the accepted quote, a verified payment option and a valid 30-day window). Rectification found at the PIESA
      // is routed by Home Insulation Victoria (variation vs rectification scheduling is not automated).
      if (onsiteCleared) return t("installation_scheduling", ONSITE_START_INSTALL_SUMMARY);
      return f.openRectItems > 0 ? stop("Electrical fixes listed at the PIESA – Home Insulation Victoria must route the electrical fixes") : t("installation_scheduling", "PIESA complete, no electrical fixes – installation scheduling unlocked");
    case "assessment_complete":
      return f.openRectItems > 0 ? t("rectification_required", `${f.openRectItems} electrical fixes item(s) required`) : t("ready_for_installer_quotes", "No electrical fixes required – ready for installer quotes");
    case "rectification_required":
      return f.rectQuoteIssued ? t("awaiting_owner_rectification_approval", "Electrical fixes quote issued to owner") : stop("Electrical fixes quote not yet issued");
    case "awaiting_owner_rectification_approval":
      return f.rectQuoteAccepted ? t("ready_for_installer_quotes", "Electrical fixes scope approved – preparing final installation quotes") : stop("Owner must approve the electrical fixes scope");
    case "ready_for_installer_quotes":
      return f.installQuotesIssued ? t("awaiting_quote_acceptance", "Installation quotes issued to owner") : { kind: "generate_quotes", to: "awaiting_quote_acceptance", summary: "Installation quotes auto-generated from active rate cards and issued to owner" };
    case "awaiting_quote_acceptance":
      if (!f.installQuoteAccepted) return stop("Owner must accept an installation quote");
      if (!f.consumerSigned) return stop("Customer Agreement / Quote Acceptance not signed");
      if (!f.invoiceExists) return stop("Xero invoice not yet created");
      return t("awaiting_deposit_payment", "Owner accepted final installation quote – approved payment option due");
    case "awaiting_deposit_payment":
      if (!f.depositCleared) return stop("Waiting on approved payment option (minimum deposit, paid in full or active 3-instalment plan)");
      if (onsiteCleared) return t("installation_scheduling", ONSITE_START_INSTALL_SUMMARY);
      if (onsiteWaiting) return stop(ONSITE_START_WAITING);
      return f.openRectItems > 0 ? t("rectification_scheduling", "Payment option verified – electrical fixes scheduling unlocked") : t("installation_scheduling", "Payment option verified – installation scheduling unlocked");
    case "rectification_scheduling":
      if (onsiteCleared) return t("installation_scheduling", ONSITE_START_INSTALL_SUMMARY);
      if (onsiteWaiting && !f.rectBookingConfirmed) return stop(ONSITE_START_WAITING);
      return f.rectBookingConfirmed ? t("rectification_booked", "Electrical fixes booking confirmed") : stop("Electrical fixes booking not confirmed");
    case "rectification_booked":
      return f.openRectItems === 0 ? t("installation_scheduling", "Electrical fixes complete, PIESA passed – installation scheduling unlocked") : stop("Electrical fixes not yet completed");
    case "installation_scheduling":
      return f.installBookingConfirmed ? t("installation_booked", "Installation booking confirmed") : stop("Installation booking not confirmed");
    case "installation_booked":
      return f.installationCompleted ? t("evidence_outstanding", "Installation completed") : stop("Installer must complete the installation");
    case "evidence_outstanding":
      if (!f.installationCompleted) return stop("Installation not recorded as complete");
      if (!f.installerDeclarationSigned) return stop("Missing evidence: installer declaration");
      return t("ap_review", "All required evidence uploaded and declarations signed – submitted for Final check");
    case "ap_review":
      // AP judgement is human: final approval happens only in the AP queue (approveApJob), never here.
      return stop("Final check: approve in AP queue");
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
export async function runAutoAdvance(deps: AdvanceDeps): Promise<AdvanceResult> {
  const from = await deps.getStage();
  let stage = from;
  const steps: Stage[] = [];
  const seen = new Set<Stage>([stage]);
  for (let i = 0; i < MAX_AUTO_STEPS; i++) {
    if (TERMINAL.includes(stage)) return { from, to: stage, steps, stoppedBecause: `Job is ${stage.replaceAll("_", " ")}` };
    const step = planStep(stage, await deps.facts());
    if (step.kind === "stop") return { from, to: stage, steps, stoppedBecause: step.reason };
    if (step.kind === "complete_site") {
      const ok = await deps.completeSite();
      const next = await deps.getStage();
      if (!ok || next === stage) return { from, to: next, steps, stoppedBecause: "Site requirements outstanding (Ready Check and/or electrical/PIESA)" };
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
