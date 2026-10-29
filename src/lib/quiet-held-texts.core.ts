// Batch 2, item 1 (Jo 29 Oct 2026): "A one-off text due after 8pm is held and never sent" → sent at 7am, skipped if it's
// no longer true. A quiet-hours hold is recorded in sms_messages (status "blocked", detail SMS_QUIET_REASON) under a
// non-claiming held key (decision 165), so the real key is still free. This decides which held texts are due for the
// 7am send; the per-type "still true" readers and the send live in quiet-held-texts.server.ts. PURE: no I/O.
import { isClosedOrArchivedJob } from "./mitti.core";
import { SMS_QUIET_REASON, smsQuietReason } from "./quote-hold.core";
import { claimKeyOf, isHeldAttemptKey } from "./sms.core";

/** The one-off types the 7am send covers (spec batch 2 §1). Anything else held overnight is left as recorded. */
export const QUIET_RESEND_TYPES = [
  "spot_saved", "quote_ready", "piesa_owner_confirm", "piesa_owner_fixes_confirm", "veec_sign_request", "veec_sign_reminder", "deposit_release",
  "visit_new_times", "install_no_access", "install_clearance", "boss_price_link", "fixes_times_link", "ready_check_days_suggested", "ready_check_booked_installer",
] as const;
export type QuietResendType = (typeof QUIET_RESEND_TYPES)[number];
export const isQuietResendType = (t: string): t is QuietResendType => (QUIET_RESEND_TYPES as readonly string[]).includes(t);

/** Holds older than this are never sent (one night's holds only). */
export const QUIET_RESEND_WINDOW_HOURS = 24;

/** One held sms_messages row plus its job's state. */
export type HeldRow = {
  idempotency_key: string; message_type: string; job_id: string | null; business_id: string | null;
  to_number: string; body: string; status: string; detail: string | null; created_at: string;
  job: { source: string | null; stage: string | null; deleted_at: string | null; qa_archived_at: string | null } | null;
};

/** Per-type "still true" check: is what this text says still the case right now? */
export type StillTrue = (row: HeldRow) => Promise<boolean>;

/**
 * The held texts to send now: outside quiet hours only; one per real key (the FIRST quiet hold, so the sender's freshness
 * limit counts from the earliest hold); held in the last 24h; real key not claimed; a covered type; a live, non-TEST job.
 * A key that also carries any other hold (switch off, no consent, too late…) is left as recorded — those are not retried
 * every 15 minutes (same rule as the decision-361 job offer catch-up).
 * @param claimed real keys that already have a claiming sms_messages row.
 */
export function quietResendDue(rows: readonly HeldRow[], claimed: ReadonlySet<string>, nowIso: string): HeldRow[] {
  if (smsQuietReason(nowIso)) return [];
  const since = Date.parse(nowIso) - QUIET_RESEND_WINDOW_HOURS * 3_600_000;
  const groups = new Map<string, HeldRow[]>();
  for (const r of rows) {
    if (r.status !== "blocked" || !isHeldAttemptKey(r.idempotency_key)) continue;
    const key = claimKeyOf(r.idempotency_key);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const due: HeldRow[] = [];
  for (const [key, group] of groups) {
    if (claimed.has(key)) continue;
    if (group.some((r) => r.detail !== SMS_QUIET_REASON)) continue;
    const first = [...group].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))[0]!;
    if (!isQuietResendType(first.message_type)) continue;
    if (!(Date.parse(first.created_at) >= since)) continue;
    if (!first.job || first.job.source === "qa_test" || isClosedOrArchivedJob(first.job)) continue;
    due.push(first);
  }
  return due;
}
