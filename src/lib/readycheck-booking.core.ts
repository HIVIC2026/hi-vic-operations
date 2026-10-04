// Ready Check booking (Operating Model v2): owner windows + installer one-tap. Pure rules only.
// Reuses the PIESA window rules (piesa-windows.core) and the matching order (allocation.core). Price is never a factor.
import { rankRecCandidates, recEligibilityBlocker, nextOfferBatch, type RecCandidate } from "./allocation.core";
import { noTakerStep } from "./piesa-windows.core";

export const READY_CHECK_NO_TAKER_DETAIL = "No installer could take the owner's Ready Check times.";
export const READY_CHECK_UNPAID_NOTE = "Free Ready Check — unpaid. No payment is made to installers for Ready Checks.";
export const READY_CHECK_WINDOW_STAGES = ["preliminary_estimate_ready", "ready_check_awaiting_acceptance", "ready_check_ready_to_schedule"] as const;

/** Full, current EEC certification: latest record verified AND office-recorded level Full with expiry on/after today. Missing level = NOT confirmed. */
export function fullCurrentCert(c: { status: string | null; level: string | null; expiresOn: string | null }, today: string): boolean {
  return c.status === "verified" && c.level === "full" && !!c.expiresOn && c.expiresOn >= today;
}

export type InstallerFacts = Omit<RecCandidate, "has_valid_licence" | "approved_workers"> & {
  credentialsOk: boolean; fullCertifiedInstallers: number; freeMeasureUps: boolean | null;
};

/** Map installer facts onto the shared candidate shape so the same eligibility/ranking code applies. */
export function installerCandidate(f: InstallerFacts): RecCandidate & { freeMeasureUps: boolean | null } {
  const { credentialsOk, fullCertifiedInstallers, ...rest } = f;
  return { ...rest, has_valid_licence: credentialsOk, approved_workers: fullCertifiedInstallers };
}

/** Why an installer cannot be offered this Ready Check (null = eligible). */
export function installerEligibilityBlocker(c: RecCandidate & { freeMeasureUps?: boolean | null }): string | null {
  if (!c.is_active || c.onboarding_status !== "approved") return "Installer business is not approved and active.";
  if (c.approved_workers < 1) return "No approved installer with a Full, current EEC certification recorded.";
  if (c.freeMeasureUps !== true) return "Has not agreed to free Ready Checks for Home Insulation Victoria leads.";
  if (!c.has_valid_licence) return "A required document has expired.";
  return recEligibilityBlocker(c) ? `Not available: ${recEligibilityBlocker(c)!.replace(/^Partner /, "")}` : null;
}

/** Next batch of eligible installers: nearby that day → reliability → fewest recent Ready Checks → speed. */
export function nextInstallerBatch(cands: (RecCandidate & { freeMeasureUps?: boolean | null })[], alreadyOffered: Set<string>, batchSize: number): RecCandidate[] {
  return nextOfferBatch(rankRecCandidates(cands.filter((c) => !installerEligibilityBlocker(c))), alreadyOffered, batchSize);
}

/** Offers can start only at the Ready Check scheduling stage, with no installer yet, open owner windows and no open offers. */
export function readyCheckStartBlockers(f: { stage: string; hasInstaller: boolean; openWindows: number; hasOpenOffers: boolean }): string[] {
  const b: string[] = [];
  if (f.stage !== "ready_check_ready_to_schedule") b.push("The job is not waiting for a Ready Check booking.");
  if (f.hasInstaller) b.push("An installer is already assigned.");
  if (f.openWindows < 1) b.push("The owner has no open Ready Check times.");
  if (f.hasOpenOffers) b.push("Ready Check offers are already open.");
  return b;
}

/** Owner must have been shown their estimated price range before booking — only when an estimate exists. */
export function priceSeenBlocker(f: { hasEstimate: boolean; estimateViewed: boolean }): string | null {
  return f.hasEstimate && !f.estimateViewed ? "Please look at your estimated price range before booking the Ready Check." : null;
}

/** After a round with no taker: round 1 → ask the owner once for more times; round 2 → needs attention. */
export const readyCheckNoTakerStep = noTakerStep;
