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

// ---------------------------------------------------------------------------
// Post-acceptance lock (C04, Jo, 2 Oct 2026): the fee may change only before the
// customer accepts; once any installation quote on the job has been accepted it is
// permanently locked — for everyone, including the owner. No reconfirmation flow.

export const AP_FEE_LOCKED_MESSAGE = "AP fee locked after customer acceptance";

export type QuoteLockRow = { id: string; status: string; accepted_at: string | null };

/** Locked when any installation quote was ever accepted, even if later superseded or replaced. */
export function apFeeLockedByQuotes(quotes: readonly QuoteLockRow[]): boolean {
  return quotes.some((q) => q.status === "accepted" || q.accepted_at != null);
}

/** What the screen shows. Pure so it can be tested; the server still decides. */
export function apFeeEditorView(input: { canChange: boolean; locked: boolean }): "editor" | "locked" | "not_allowed" {
  if (input.locked) return "locked";
  return input.canChange ? "editor" : "not_allowed";
}

export type ApFeeJobState = { ap_fee_override_inc_gst: number | null; ap_fee_override_reason: string | null; ap_fee_override_by: string | null; ap_fee_override_at: string | null };

export interface ApFeeRepo {
  loadInstallationQuotes(jobId: string): Promise<QuoteLockRow[]>;
  loadJob(jobId: string): Promise<ApFeeJobState>;
  writeJob(jobId: string, next: ApFeeJobState): Promise<void>;
  audit(jobId: string, actorId: string, type: string, summary: string, details: Record<string, unknown>): Promise<void>;
  now(): string;
}

/**
 * The single enforcement path used by the server function. actorId must come from the
 * authenticated server context — never from browser input.
 */
export async function applyApFeeChange(repo: ApFeeRepo, input: {
  actorId: string; allowedUserIds: readonly string[]; jobId: string; amount: number | null; reason: string;
}): Promise<{ ok: true }> {
  const quotes = await repo.loadInstallationQuotes(input.jobId);
  if (apFeeLockedByQuotes(quotes)) {
    await repo.audit(input.jobId, input.actorId, "ap_fee_override_refused", "AP fee change refused: locked after customer acceptance",
      { attempted_amount: input.amount, reason: input.reason });
    throw new Error(AP_FEE_LOCKED_MESSAGE);
  }
  const block = apFeeOverrideBlocker({ actorId: input.actorId, allowedUserIds: input.allowedUserIds, reason: input.reason });
  if (block) {
    await repo.audit(input.jobId, input.actorId, "ap_fee_override_refused", `AP fee change refused: ${block}`, { attempted_amount: input.amount });
    throw new Error(block);
  }
  const before = await repo.loadJob(input.jobId);
  const amount = input.amount == null ? null : Math.round(input.amount * 100) / 100;
  const at = repo.now();
  const next: ApFeeJobState = {
    ap_fee_override_inc_gst: amount,
    ap_fee_override_reason: amount == null ? null : input.reason.trim(),
    ap_fee_override_by: amount == null ? null : input.actorId,
    ap_fee_override_at: amount == null ? null : at,
  };
  await repo.writeJob(input.jobId, next);
  // Acceptance may have landed between the check and the write: re-check and undo.
  if (apFeeLockedByQuotes(await repo.loadInstallationQuotes(input.jobId))) {
    await repo.writeJob(input.jobId, before);
    await repo.audit(input.jobId, input.actorId, "ap_fee_override_refused", "AP fee change undone: customer accepted during the change", { attempted_amount: amount });
    throw new Error(AP_FEE_LOCKED_MESSAGE);
  }
  await repo.audit(input.jobId, input.actorId, "ap_fee_override",
    amount == null ? "AP fee reset to standard" : `AP fee overridden to $${amount.toFixed(2)} inc GST`,
    { old_amount: before.ap_fee_override_inc_gst, new_amount: amount, reason: input.reason.trim(), actor: input.actorId, at });
  return { ok: true };
}
