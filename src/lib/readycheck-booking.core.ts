// Ready Check booking: installer eligibility + matching order. Pure rules only. Price is never a factor.
// Jo 24 Oct 2026: on our leads the office picks one installer and the installer offers the owner times
// (ready-check-times.core.ts); there are no automatic batches and owners no longer give Ready Check windows.
import { rankRecCandidates, recEligibilityBlocker, type RecCandidate } from "./allocation.core";

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

/** Eligible installers for the office's "Choose installer" list, in the shared matching order (nearby that day →
 *  reliability → fewest recent Ready Checks → speed). Jo 24 Oct 2026: the office picks ONE; nothing is batch-offered. */
export function rankedInstallers(cands: (RecCandidate & { freeMeasureUps?: boolean | null })[]): RecCandidate[] {
  return rankRecCandidates(cands.filter((c) => !installerEligibilityBlocker(c)));
}

/** Owner must have been shown their estimated price range before booking — only when an estimate exists. */
export function priceSeenBlocker(f: { hasEstimate: boolean; estimateViewed: boolean }): string | null {
  return f.hasEstimate && !f.estimateViewed ? "Please look at your estimated price range before booking the Ready Check." : null;
}
