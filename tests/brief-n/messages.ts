// Single source of the exact wording Brief N asserts. Copied verbatim from the application source so a
// message change shows up as a failing test rather than a silent drift.
export const MESSAGES = {
  /** readycheck-booking.core.ts readyCheckStartBlockers() — one blocker. */
  offerNoWindows: "Ready Check offers cannot start: The owner has no open Ready Check times.",
  offerWrongStage: "Ready Check offers cannot start: The job is not waiting for a Ready Check booking.",
  offerAssigned: "Ready Check offers cannot start: An installer is already assigned.",
  offerAlreadyOpen: "Ready Check offers cannot start: Ready Check offers are already open.",
  /** installerCandidatesFor → installerEligibilityBlocker (not approved / not active). */
  notACandidate: "One of those installers isn't an approved installer for this job.",
  /** offerNextReadyCheckBatch, when the chosen candidate carries a blocker. */
  candidateBlockedPrefix: "can't take this Ready Check:",
  /** respondToReadyCheckOffer outcomes. */
  offerTaken: "This Ready Check has just been taken.",
  slotUnavailable: "That time is no longer available. Please choose another time.",
  notInstaller: "Only an installer team member can accept a Ready Check.",
  /** allocation.core ACCEPT_OUTCOME_MESSAGE.not_member — the RPC's own wording for a cross-business accept. */
  differentBusiness: "This offer was made to a different business.",
  /** trade-view.server.ts — the trade-side scoping guard. */
  notYourOffer: "This offer isn't for your business.",
  notYourJob: "This job isn't assigned to you.",
  /** submitReadyCheckWindows. */
  windowsAlreadyWithInstallers: "Your Ready Check times are already with our installers.",
  /** ready-check-draft.server.ts. */
  submitNotReadyPrefix: "Not ready to submit:",
  alreadySubmitted: "This Ready Check was already submitted — ask Home Insulation Victoria to reopen it.",
  saveBeforeSubmit: "Save the Ready Check before submitting it.",
  /** piesa-windows.core.ts piesaWindowBlockers(). */
  tooFewTimes: "Please choose between 3 and 5 times.",
  notEnoughDays: "Please choose times on at least 3 different days.",
  duplicateTime: "Each time can only be chosen once.",
  outsideAllowedDays: "Times must be on a business day at least 2 business days away and within the next 21 days.",
} as const;

/** The exact required Ready Check answers for a job with no evidence requirements configured. */
export const FULL_RC_VALUES: Record<string, string> = {
  "attendance.attended_at": "2026-10-20T09:30:00.000Z",
  "measure.eligible_area_m2": "120",
  "measure.method": "laser",
  "insulation.existing": "none",
  "removal.required": "no",
  "access.level": "standard",
  "elec.downlight_count": "6",
  "elec.downlight_type": "led",
};
