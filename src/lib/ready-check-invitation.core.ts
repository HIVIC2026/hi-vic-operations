/**
 * P1-R3-S92 — GAP-2: Template 8 (Ready Check invitation) Office manual-trigger guards.
 *
 * PURE module: no database, no network, no email. It decides, from facts already gathered, whether an
 * Office-initiated Ready Check invitation may be prepared or sent.
 *
 * OWNER DECISION (approved): OPTION A — OFFICE MANUAL TRIGGER.
 * The invitation is an explicit, auditable Office action for ONE named saved-spot job. This module is
 * the single place that encodes that decision, so no automatic path can be built around it:
 *   - there is no availability, geographic, schedule, activity or save-spot trigger here,
 *   - every guard fails CLOSED (a missing/unreadable fact blocks).
 */
import type { SavedPricingSnapshot } from "./jo-email-templates.core";

/** The caller resolves the role through the existing Office authorisation (requireAdmin). */
export type OfficeActor = { userId: string | null; role: "office" | "none" };

export const OFFICE_ONLY_MESSAGE = "Only an office user can prepare or send a Ready Check invitation.";
export const JOB_NOT_FOUND_MESSAGE = "Job not found. Nothing was prepared.";
export const NOT_ELIGIBLE_MESSAGE = "This job's official result is not eligible. Nothing was prepared.";
export const NO_SAVED_SPOT_MESSAGE = "This customer hasn't saved their spot, so there is no saved quote to invite them with.";
export const SNAPSHOT_MISSING_MESSAGE = "This saved quote can't be read in full, so no invitation was prepared.";
export const ALREADY_INVITED_MESSAGE = "This home has already been invited. Check its history before inviting again.";

export function officeAuthorized(actor: OfficeActor | null | undefined): boolean {
  return actor?.role === "office" && !!actor.userId;
}

/** The facts a caller must gather before asking. Every unknown must be passed as the blocking value. */
export type ReadyCheckInvitationFacts = {
  jobExists: boolean;
  deleted: boolean;
  closed: boolean;
  officialEligible: boolean;
  savedSpot: boolean;
  /** The saved-pricing snapshot from template8SnapshotForJob(); null = incomplete/expired token. */
  snapshot: SavedPricingSnapshot | null;
};

/**
 * Every reason the invitation must be refused, in the order the brief requires:
 * authorisation -> job state -> eligibility -> saved spot -> complete snapshot.
 * Returns null only when all of them pass.
 */
export function readyCheckInvitationBlocker(
  facts: ReadyCheckInvitationFacts,
  actor: OfficeActor | null | undefined,
): string | null {
  if (!officeAuthorized(actor)) return OFFICE_ONLY_MESSAGE;
  if (!facts.jobExists || facts.deleted) return JOB_NOT_FOUND_MESSAGE;
  if (facts.closed) return "This job is closed. Nothing was prepared.";
  if (!facts.officialEligible) return NOT_ELIGIBLE_MESSAGE;
  if (!facts.savedSpot) return NO_SAVED_SPOT_MESSAGE;
  if (!facts.snapshot) return SNAPSHOT_MISSING_MESSAGE;
  return null;
}

/** COM-04 (S86 owner Option A): real sending needs BOTH runtime switches. Missing => fail closed. */
export function readyCheckSendingAllowed(switches: {
  customerCommsEnabled: boolean | null;
  saveMySpotRealSendEnabled: boolean | null;
}): boolean {
  return switches.customerCommsEnabled === true && switches.saveMySpotRealSendEnabled === true;
}

export const READY_CHECK_INVITATION_PURPOSE = "ready_check_invitation" as const;
export const readyCheckInvitationKey = (jobId: string) => `${READY_CHECK_INVITATION_PURPOSE}:${jobId}`;
/** The workflow_events type written for every Office action, prepared or sent. */
export const READY_CHECK_INVITATION_EVENT = "ready_check_invitation" as const;
