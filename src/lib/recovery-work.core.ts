// Pure rules for the still-to-finish list (recovery_work). No I/O.
export type RecoveryKind =
  | "veec_final_copy"
  | "veec_copy_email"
  | "stripe_payment_followup"
  | "stripe_refund_waiting"
  | "spot_saved_email";
export type RecoveryStatus = "open" | "done" | "needs_office";

export const RECOVERY_BACKOFF_MIN = [5, 15, 30] as const;
export const RECOVERY_MAX_ATTEMPTS = 3;

/** `attempts` = failed attempts before this one. The 3rd failure hands the item to the office. */
export function nextAfterFailure(
  attempts: number,
  now: Date,
): { status: RecoveryStatus; nextAttemptAt: string | null } {
  if (attempts + 1 >= RECOVERY_MAX_ATTEMPTS) return { status: "needs_office", nextAttemptAt: null };
  const min = RECOVERY_BACKOFF_MIN[Math.min(attempts, RECOVERY_BACKOFF_MIN.length - 1)] ?? 0;
  return { status: "open", nextAttemptAt: new Date(now.getTime() + min * 60_000).toISOString() };
}
