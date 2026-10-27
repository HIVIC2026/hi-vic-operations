// Ready Check booking: installer eligibility + matching order. Pure rules only. Price is never a factor.
// Jo 24 Oct 2026: on our leads the office picks one installer and the installer offers the owner times
// (ready-check-times.core.ts); there are no automatic batches and owners no longer give Ready Check windows.
import { rankRecCandidates, recEligibilityBlocker, type RecCandidate } from "./allocation.core";
import { crewClearance } from "./worker-compliance.core";

export const READY_CHECK_UNPAID_NOTE = "Free Ready Check — unpaid. No payment is made to installers for Ready Checks.";
export const READY_CHECK_WINDOW_STAGES = ["preliminary_estimate_ready", "ready_check_awaiting_acceptance", "ready_check_ready_to_schedule"] as const;

/** Full, current EEC certification: latest record verified AND office-recorded level Full with expiry on/after today. Missing level = NOT confirmed. */
export function fullCurrentCert(c: { status: string | null; level: string | null; expiresOn: string | null }, today: string): boolean {
  // Decision 153: the shared crew clearance (verified + recorded level + not expired) plus the Full level for offers.
  return crewClearance({ certStatus: c.status, level: c.level, expiresOn: c.expiresOn }, today).cleared && c.level === "full";
}

export type InstallerFacts = Omit<RecCandidate, "has_valid_licence" | "approved_workers"> & {
  credentialsOk: boolean; fullCertifiedInstallers: number; freeMeasureUps: boolean | null;
  /** The true reason no installer person can be offered (from `installerGapReason`), shown instead of the generic line. */
  installerGap?: string | null;
  /** The true document reason (first failing document rule), shown instead of the generic line. */
  credentialsGap?: string | null;
};

/** Facts for one installer person, used only to explain WHY nobody at the business can be offered. */
export type InstallerPersonGap = {
  noticeAcknowledged: boolean | null; piisaBlocked: boolean;
  cert: { status: string | null; level: string | null; expiresOn: string | null } | null;
};

export const INSTALLER_GAP = {
  none: "Can't be offered: the business has no installer person added yet. The installer business must add one.",
  notice: "Can't be offered: the installer hasn't accepted the ESC privacy notice yet. The installer must open their notice link and accept it.",
  piisa: "Can't be offered: the installer's PIISA training isn't uploaded and verified yet. The installer must upload it, then the office verifies it.",
  noCert: "Can't be offered: no EEC certification recorded for the installer. The office must record it.",
  certNotVerified: "Can't be offered: the installer's EEC certification hasn't been verified. The office must verify it.",
  notFull: "Can't be offered: the installer's EEC certification isn't recorded as Full. The office must record a Full level.",
  expired: "Can't be offered: the installer's EEC certification has expired. The installer must send a current one for the office to record.",
} as const;

/** One reason per person, in the order a person would fix them; the business shows the reason of the person
 *  closest to being offerable (notice/PIISA before certificate gaps). Null = someone can be offered. */
export function installerGapReason(people: InstallerPersonGap[], today: string): string | null {
  if (people.length === 0) return INSTALLER_GAP.none;
  const rank: string[] = [INSTALLER_GAP.notice, INSTALLER_GAP.piisa, INSTALLER_GAP.expired, INSTALLER_GAP.notFull, INSTALLER_GAP.certNotVerified, INSTALLER_GAP.noCert];
  const reasons = people.map((p) => {
    const certGap = !p.cert ? INSTALLER_GAP.noCert
      : p.cert.status !== "verified" ? INSTALLER_GAP.certNotVerified
      : !p.cert.level || p.cert.level !== "full" ? INSTALLER_GAP.notFull
      : !p.cert.expiresOn || p.cert.expiresOn < today ? INSTALLER_GAP.expired
      : null;
    if (p.noticeAcknowledged === false) return INSTALLER_GAP.notice;
    if (p.piisaBlocked) return INSTALLER_GAP.piisa;
    return certGap;
  });
  if (reasons.some((r) => r === null)) return null;
  return [...reasons].sort((a, b) => rank.indexOf(a!) - rank.indexOf(b!))[0]!;
}

/** Map installer facts onto the shared candidate shape so the same eligibility/ranking code applies. */
export function installerCandidate(f: InstallerFacts): RecCandidate & { freeMeasureUps: boolean | null } {
  const { credentialsOk, fullCertifiedInstallers, ...rest } = f;
  return { ...rest, has_valid_licence: credentialsOk, approved_workers: fullCertifiedInstallers };
}

/** Why an installer cannot be offered this Ready Check (null = eligible). */
export function installerEligibilityBlocker(c: RecCandidate & { freeMeasureUps?: boolean | null; installerGap?: string | null; credentialsGap?: string | null }): string | null {
  if (!c.is_active || c.onboarding_status !== "approved") return "Installer business is not approved and active.";
  if (c.approved_workers < 1) return c.installerGap ?? "No approved installer with a Full, current EEC certification recorded.";
  if (c.freeMeasureUps !== true) return "Has not agreed to free Ready Checks for Home Insulation Victoria leads.";
  if (!c.has_valid_licence) return c.credentialsGap ?? "A required document has expired.";
  return recEligibilityBlocker(c) ? `Not available: ${recEligibilityBlocker(c)!.replace(/^Partner /, "")}` : null;
}

/** ONE rule for "this installer can be offered this job here": no blocker AND its verified area covers the job.
 *  The Choose installer pop-up's nearby list and the Choose installer list's "Installer ✓" both use it. */
export function installerOfferable(c: RecCandidate & { freeMeasureUps?: boolean | null }): boolean {
  return !installerEligibilityBlocker(c) && (c.covers_postcode || c.exact_postcode);
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
