export const LAUNCH_CAMPAIGN = "existing_leads_launch_v1" as const;
export const LAUNCH_BATCH_SIZE = 50;
export const LAUNCH_COPY_APPROVED = false;

export type LaunchGroup = "likely" | "onsite";
export type DeskCheckOutcome = "looks_eligible" | "not_eligible" | "needs_onsite_check";

export function launchGroup(outcome: string | null, insulation: string | null): LaunchGroup | null {
  if (outcome === "likely_eligible" && insulation === "none") return "likely";
  if ((outcome === "likely_eligible" || outcome === "needs_onsite_confirmation") && (insulation === "present" || insulation === "unknown" || insulation === null)) return "onsite";
  return null;
}

export function deskCheckReasonError(outcome: DeskCheckOutcome, reason: string) {
  return outcome === "not_eligible" && reason.trim().length < 3 ? "Add a short reason for the homeowner record." : null;
}
