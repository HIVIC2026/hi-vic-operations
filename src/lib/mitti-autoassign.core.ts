// PURE rule: should linking a worker to a job auto-create and assign the Ready Check Mitti form?
import { mittiInviteLine, type MittiAccess } from "./mitti-membership.core";

export type MittiAutoResult =
  | { status: "not_needed" }
  | { status: "assigned"; auditId: string; reused: boolean }
  | { status: "needs_mitti_access"; message: string }
  | { status: "failed"; message: string };

const DONE_STAGES = new Set(["cancelled", "complete", "on_hold"]);

export function mittiAutoAssignDecision(i: {
  channel: string | null; stage: string | null; tradeRole: string | null; measurementComplete: boolean;
  hasProfile: boolean; access: MittiAccess | null; email: string | null;
}): { action: "skip" } | { action: "flag"; reason: string } | { action: "assign" } {
  if (i.channel !== "installer_sourced" || i.tradeRole !== "installer") return { action: "skip" };
  if (i.measurementComplete || (i.stage && DONE_STAGES.has(i.stage))) return { action: "skip" };
  if (!i.hasProfile) return { action: "flag", reason: `this worker has no portal sign-in linked yet, so Mitti access can't be confirmed. ${mittiInviteLine(i.email)}` };
  if (i.access !== "member") return { action: "flag", reason: `Mitti access is not confirmed for this worker. ${mittiInviteLine(i.email)}` };
  return { action: "assign" };
}
