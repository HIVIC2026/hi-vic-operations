// Jo 23 Oct 2026: every installer job gets its Mitti Ready Check form automatically (no office "Create & assign"
// click). Pure decision only; creation reuses createAssignMittiAudit and its atomic per-job claim.
import { PRE_READY_CHECK_STAGES } from "./installer-new-jobs.core";

/** Jo 23 Oct: ON once A1/A2 were republished (photos optional on A1, one plain-text Site address in the title).
 *  Set false to pause while a template is being changed — a Mitti form keeps the version it was created from. */
export const AUTOFORM_ENABLED = true;
export const AUTOFORM_WINDOW_DAYS = 30;
export const AUTOFORM_RETRY_AFTER_HOURS = 24;
/** The tick has a 55s HTTP limit and runs other Mitti work too; a few forms per tick keeps it well inside. */
export const AUTOFORM_MAX_PER_TICK = 5;
export const AUTOFORM_FAILED_EVENT = "mitti_autoform_failed";

export type AutoFormFacts = {
  channel: string | null; stage: string; createdAt: string; deleted: boolean; archived: boolean;
  /** A current measurement row exists (any source). */ hasCurrentMeasurement: boolean;
  installerUserId: string | null; mittiInvited: boolean; templateSet: boolean; autoSendMitti: boolean;
  /** When the last automatic attempt failed, if any. */ lastFailureAt: string | null;
};

export type AutoFormDecision = { action: "create" } | { action: "skip"; reason: string };

export function autoFormDecision(f: AutoFormFacts, now: Date, enabled = AUTOFORM_ENABLED): AutoFormDecision {
  const skip = (reason: string): AutoFormDecision => ({ action: "skip", reason });
  if (!enabled) return skip("automatic Ready Check forms are paused");
  if (f.channel !== "installer_sourced") return skip("not an installer job");
  if (f.deleted || f.archived) return skip("removed");
  if (!(PRE_READY_CHECK_STAGES as readonly string[]).includes(f.stage)) return skip("past the Ready Check");
  if (now.getTime() - Date.parse(f.createdAt) > AUTOFORM_WINDOW_DAYS * 86_400_000) return skip("older than 30 days");
  // Any existing measurement (bulk provisional, portal, Mitti) is left alone: the office decides those by hand.
  if (f.hasCurrentMeasurement) return skip("already has a Ready Check record");
  if (!f.autoSendMitti) return skip("automatic Mitti forms are switched off");
  if (!f.templateSet) return skip("Ready Check form not set up");
  if (!f.mittiInvited) return skip("installer not set up in Mitti");
  if (!f.installerUserId) return skip("no installer assigned");
  if (f.lastFailureAt && now.getTime() - Date.parse(f.lastFailureAt) < AUTOFORM_RETRY_AFTER_HOURS * 3_600_000) return skip("last attempt failed – retrying tomorrow");
  return { action: "create" };
}
