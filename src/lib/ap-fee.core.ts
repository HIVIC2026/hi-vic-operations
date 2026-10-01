/**
 * Who may change the Accredited Person management fee (C04, Jo, 2 Oct 2026: "only me").
 * Pure rules only — no database, no request handling. The server function applies these.
 */

/** Home Insulation Victoria owner sign-in (info@homeinsulationvictoria.com.au). C04: this account alone may change the fee. */
export const HIVIC_OWNER_USER_ID = "950fa0b6-dc44-49af-a754-6a65f26a661e";

/** The recorded allow-list. `AP_FEE_OVERRIDE_USER_IDS` (comma-separated) replaces it without a code change. */
export const AP_FEE_OVERRIDE_USER_IDS: readonly string[] = [HIVIC_OWNER_USER_ID];

/** Why the reason is required: the change must be explainable in the job file years later. */
export const AP_FEE_MIN_REASON_CHARS = 3;

/** Env wins when set; otherwise the recorded owner account. An empty result means nobody. */
export function resolveApFeeAllowedIds(envValue: string | null | undefined): string[] {
  const fromEnv = (envValue ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return fromEnv.length ? fromEnv : [...AP_FEE_OVERRIDE_USER_IDS];
}

/**
 * Fails closed. Returns the reason a fee change is refused, or null when it is allowed.
 * Being an admin is deliberately not enough — the fee is the owner's to set.
 */
export function apFeeOverrideBlocker(input: {
  actorId: string | null;
  allowedUserIds: readonly string[];
  reason: string | null;
}): string | null {
  if (input.allowedUserIds.length === 0) return "The Accredited Person fee can't be changed because no account is authorised. Ask the Home Insulation Victoria owner to set one.";
  if (!input.actorId || !input.allowedUserIds.includes(input.actorId)) return "Only the Home Insulation Victoria owner can change the Accredited Person fee.";
  if (!input.reason || input.reason.trim().length < AP_FEE_MIN_REASON_CHARS) return "A reason is required before the Accredited Person fee can be changed.";
  return null;
}

/** Can this sign-in change the fee? Used to decide whether to show the editor at all. */
export function canChangeApFee(actorId: string | null, allowedUserIds: readonly string[]): boolean {
  return allowedUserIds.length > 0 && !!actorId && allowedUserIds.includes(actorId);
}
