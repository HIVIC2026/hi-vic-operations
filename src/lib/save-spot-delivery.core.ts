// STEP 56: Save my spot delivery outcomes. Pure. Every provider attempt ends in exactly one of:
//   accepted       – the email service took the email                  -> customer_email_sends "sent"
//   rejected       – the email service answered that it did NOT send it -> "failed" (the guarded sender may try again)
//   not_attempted  – the request never left (e.g. email not connected)  -> "failed"
//   uncertain      – timeout, dropped connection, gateway/provider 5xx, 408 or 409: the email MAY have been accepted
//                    -> "delivered_unrecorded" (the existing sent-unknown status, see delivery.core.ts / followups).
// reservationAllowed() (emailsafety.core.ts) only lets a missing or "failed" row send again, so an uncertain outcome is
// never retried by any automatic trigger or by the Office send button. Only the Office can resolve it, after checking
// the email service: "delivered" -> "sent" (final), "not delivered" -> "failed" (one more guarded send is allowed).
// Resend's own Idempotency-Key only de-duplicates for about 24 hours, so it is a second layer, never the only one.

export type ResendAttempt =
  | { outcome: "accepted"; id: string | null; detail: string }
  | { outcome: "rejected"; status: number; detail: string }
  | { outcome: "not_attempted"; detail: string }
  | { outcome: "uncertain"; detail: string };

/** HTTP status from the email service (via the connector gateway) -> what we know about delivery.
 *  2xx accepted. 408 (request timeout), 409 (Resend: the same idempotency key is already in flight or was used) and any
 *  5xx (provider or gateway error after the request may already have been forwarded) are UNKNOWN. Any other 4xx
 *  (bad request, authentication, validation, rate limit) is a definite refusal. Anything else is treated as unknown. */
export function classifyProviderStatus(status: number): "accepted" | "rejected" | "uncertain" {
  if (status >= 200 && status < 300) return "accepted";
  if (status === 408 || status === 409) return "uncertain";
  if (status >= 400 && status < 500) return "rejected";
  return "uncertain";
}

/** customer_email_sends.status to record for one attempt. */
export function sendStatusFor(a: ResendAttempt): "sent" | "failed" | "delivered_unrecorded" {
  return a.outcome === "accepted" ? "sent" : a.outcome === "uncertain" ? "delivered_unrecorded" : "failed";
}

/** Same marker the follow-up sender writes for a sent-unknown attempt. */
export const SENT_UNKNOWN_PREFIX = "sent_unknown: ";
export const UNCERTAIN_SEND_DETAIL = "Email outcome unknown: the email service may have accepted it. Not retried automatically – the office must check the email service and resolve it on the Leads page.";

/** A "sending" reservation older than this cannot still be in flight (the provider call times out after 20 s), so the
 *  process stopped mid-send and the outcome is unknown. Younger ones are treated as in progress. */
export const STALE_SENDING_MS = 15 * 60_000;

/** Is this Save my spot send row waiting for an Office decision? */
export function uncertainSend(row: { status: string; created_at: string | null }, now: number): boolean {
  if (row.status === "delivered_unrecorded") return true;
  if (row.status !== "sending" || !row.created_at) return false;
  const at = Date.parse(row.created_at);
  return Number.isFinite(at) && now - at >= STALE_SENDING_MS;
}

/** Which campaign email a customer_email_sends row is (all share purpose LAUNCH_CAMPAIGN; the key tells them apart). */
export type SendKind = "save_my_spot" | "insulation_details" | "existing_insulation_followup";
export function sendKindFromKey(key: string | null | undefined): SendKind {
  if (key?.includes(":existing_insulation_save_spot:")) return "existing_insulation_followup";
  if (key?.includes(":insulation_details:")) return "insulation_details";
  return "save_my_spot";
}
export const SEND_KIND_LABEL: Record<SendKind, string> = {
  save_my_spot: "Save my spot email",
  insulation_details: "Insulation details email (Group B)",
  existing_insulation_followup: "Existing-insulation Save my spot follow-up",
};
/** What "not delivered" leads to, per email. Nothing is ever sent at the moment of resolving. */
export const NOT_DELIVERED_HELP: Record<SendKind, string> = {
  save_my_spot: "Recorded as a confirmed failure; nothing is sent now. The portal only sends it again if this lead is processed again and every consent, opt-out and saved-spot check still passes. If you hand-send it with “Prepare email”, record “Sent manually” straight away so the portal never sends it as well.",
  insulation_details: "Recorded as a confirmed failure; nothing is sent now. The portal only sends it again if this lead is processed again and every check (including the customer email switches) still passes.",
  existing_insulation_followup: "Recorded as a confirmed failure; nothing is sent now. The portal never re-sends a follow-up, so contact the owner another way and record it with “Record outcome”.",
};
/** Leads "Needs attention" reason for an unknown outcome. */
export function uncertainAttentionReason(kind: SendKind): string {
  return `${SEND_KIND_LABEL[kind]}: outcome unknown – check the email service (Resend) for this address, then resolve it here. Nothing is resent automatically.`;
}
export const DELIVERED_HELP = "Recorded as sent at the time it was attempted. The portal will never send this home this email again.";

export type SaveSpotResolution = "delivered" | "not_delivered";
export const RESOLUTION_LABEL: Record<SaveSpotResolution, string> = {
  delivered: "The email service shows it was delivered",
  not_delivered: "The email service shows it was NOT delivered",
};
export const RESOLVE_NOTE_MIN = 5;

/** Office resolution -> new status. "delivered" is final (the home is never sent it again). "not_delivered" becomes a
 *  confirmed failure: the normal sender re-checks consent, opt-out, saved spot and the manual-send record before any
 *  further send, and the Office can instead hand-send it through "Prepare email". */
export function resolutionStatus(r: SaveSpotResolution): "sent" | "failed" {
  return r === "delivered" ? "sent" : "failed";
}

/** Same attempt? A failed row that is re-reserved gets a new created_at, so an Office decision about an earlier attempt
 *  can never be applied to a later one. */
export function sameAttempt(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = Date.parse(a), y = Date.parse(b);
  return Number.isFinite(x) && x === y;
}

/** Why a resolution can't be saved (null = it can). Never sends anything. */
export function resolutionBlocker(i: { row: { status: string; created_at: string | null } | null; note: string; now: number; attemptAt?: string | null }): string | null {
  if (!i.row) return "There is no unresolved Save my spot email for this lead.";
  if (i.attemptAt !== undefined && !sameAttempt(i.row.created_at, i.attemptAt)) return "This email record changed while you were checking it (a newer attempt exists). Reload and check again.";
  if (i.row.status === "sending" && !uncertainSend(i.row, i.now)) return "This email is still being sent. Wait a few minutes, reload and check again.";
  if (!uncertainSend(i.row, i.now)) return `This email's outcome is already recorded (${i.row.status}). Nothing to resolve.`;
  if (i.note.trim().length < RESOLVE_NOTE_MIN) return "Say what you checked (for example: \"Resend shows delivered 12 Oct 10:41\").";
  return null;
}

/** Stored error text after the Office resolves an unknown outcome (keeps what was there before). */
export function resolutionError(r: SaveSpotResolution, note: string, previous: { status: string; error: string | null }): string {
  const what = r === "delivered" ? "office_confirmed_delivered" : "office_confirmed_not_delivered";
  return `${what}: ${note.trim()} (was ${previous.status}${previous.error ? `: ${previous.error}` : ""})`.slice(0, 500);
}
