// Review R04 (audit F16): one owner email whose delivery records a compliance fact (`warranty_copy_provided`) must keep
// four things apart — the reservation, a CONFIRMED delivery, a DEFINITE failure and an UNKNOWN outcome:
//   • only a confirmed delivery records the fact;
//   • a definite failure (the email service refused it, it was blocked, or it was never handed over) may be retried on a
//     later tick with the SAME provider idempotency key, after a growing wait (1h, 2h, 4h … max 24h);
//   • an unknown outcome (timeout, lost connection, 408/409/5xx, an attempt with no recorded outcome) is NEVER resent
//     automatically — the office is told (Needs me).
// Used by the warranty follow-up (warranty-followup.{core,server}) and the completion pack (completion-pack.server).
// PURE: no I/O, no dates except those passed in.

export type SendOutcome = { outcome: "delivered" | "failed" | "unknown"; detail: string };
export type SendEvent = { event_type: string; created_at: string; details?: Record<string, unknown> | null };
/** none = never tried; pending = a reservation with no recorded outcome (interrupted send). */
export type DeliveryState = { state: "none" | "delivered" | "failed" | "unknown" | "pending"; attempts: number; failures: number; lastFailureAt: string | null };
/** Event names for one email. `attempt` null = the guarded sender's own reservation is the only one (no pending state).
 *  `sentNeedsConfirmed`: a `sent` row counts as delivered only with details.confirmed = true (otherwise it is an attempt). */
export type SendEventNames = { attempt: string | null; sent: string; failed: string; unknown: string; sentNeedsConfirmed?: boolean };

export function deliveryFromEvents(events: readonly SendEvent[], n: SendEventNames): DeliveryState {
  const names = [n.attempt, n.sent, n.failed, n.unknown].filter((x): x is string => !!x);
  const ev = [...events].filter((e) => names.includes(e.event_type)).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const confirmed = (e: SendEvent) => e.event_type === n.sent && (!n.sentNeedsConfirmed || e.details?.["confirmed"] === true);
  const isAttempt = (e: SendEvent) => (n.attempt != null && e.event_type === n.attempt) || (e.event_type === n.sent && !confirmed(e));
  const failed = ev.filter((e) => e.event_type === n.failed);
  const base = { attempts: ev.filter(isAttempt).length, failures: failed.length, lastFailureAt: failed.at(-1)?.created_at ?? null };
  if (ev.some(confirmed)) return { ...base, state: "delivered" };
  if (ev.some((e) => e.event_type === n.unknown)) return { ...base, state: "unknown" };
  const last = ev.at(-1);
  if (!last) return { ...base, state: "none" };
  if (isAttempt(last)) return { ...base, state: "pending" };
  return { ...base, state: "failed" };
}

/** When the next try is allowed after the Nth definite failure: 1h, 2h, 4h … capped at 24h. */
export function retryAfter(lastFailureAt: string, failures: number): string {
  const hours = Math.min(24, 2 ** Math.max(0, failures - 1));
  return new Date(Date.parse(lastFailureAt) + hours * 3_600_000).toISOString();
}
/** Null when a definite failure may be retried now (or nothing failed); otherwise the wait reason. */
export function retryWaitBlocker(d: DeliveryState, nowIso: string): string | null {
  if (d.state !== "failed" || !d.lastFailureAt) return null;
  const next = retryAfter(d.lastFailureAt, d.failures);
  return Date.parse(nowIso) < Date.parse(next) ? `last send failed — next try after ${next}` : null;
}

/** The guarded owner sender's answer (owner-email-send.server) → outcome; null = "already attempted" (ask the email log). */
export function classifyGuardedSendResult(result: string): SendOutcome | null {
  if (result === "sent") return { outcome: "delivered", detail: "Accepted by the email service" };
  if (result.startsWith("failed")) return { outcome: "failed", detail: result };
  if (result.startsWith("blocked")) return { outcome: "failed", detail: `${result} (opt-out, suppression or recipient boundary)` };
  if (result.startsWith("delivery uncertain")) return { outcome: "unknown", detail: result };
  return null;
}
/** customer_email_sends.status for the key → outcome. No row = no reservation, so nothing was handed over. */
export function classifyEmailLogStatus(status: string | null): SendOutcome {
  if (status === "sent") return { outcome: "delivered", detail: "The email log shows it accepted by the email service" };
  if (status === "failed" || status == null) return { outcome: "failed", detail: status ? "The email log shows a definite failure" : "No send was reserved, so nothing was handed to the email service" };
  return { outcome: "unknown", detail: `The email log shows "${status}" — no clear answer from the email service` };
}
/** test-send result → outcome: sent → delivered; blocked → definite; "sent_unknown" or an HTTP status the provider may
 *  still have accepted (classifyProviderStatus ≠ rejected) → unknown; any other refusal → definite. */
export function classifyTestSendResult(r: { status: string; detail: string }, providerStatusKind: (status: number) => "accepted" | "rejected" | "uncertain"): SendOutcome {
  if (r.status === "sent") return { outcome: "delivered", detail: r.detail };
  if (r.status === "blocked") return { outcome: "failed", detail: `blocked: ${r.detail}` };
  if (/sent_unknown/i.test(r.detail)) return { outcome: "unknown", detail: r.detail };
  const m = /Resend (\d{3})\b/.exec(r.detail);
  if (m && providerStatusKind(Number(m[1])) !== "rejected") return { outcome: "unknown", detail: r.detail };
  return { outcome: "failed", detail: r.detail };
}
/** sendOwnerTemplateEmail's answer (TEST: "<status>: <detail>"; real: the guarded sender's string; holds: "not sent — …"
 *  / "skipped") → outcome, or "held" for a hold that never reached a sender (approval, link, consent, no email). */
export function classifyTemplateSendResult(result: string, test: boolean, providerStatusKind: (status: number) => "accepted" | "rejected" | "uncertain"): SendOutcome | "held" | null {
  if (result === "skipped" || result.startsWith("not sent")) return "held";
  if (test) {
    const m = /^(sent|blocked|failed): ?([\s\S]*)$/.exec(result);
    return m ? classifyTestSendResult({ status: m[1]!, detail: m[2] ?? "" }, providerStatusKind) : { outcome: "unknown", detail: result };
  }
  return classifyGuardedSendResult(result);
}

/** Needs me: ONE open row while an outcome is unknown and the fact it would record is not recorded. */
export function unknownSendOpen(events: readonly SendEvent[], n: SendEventNames, factRecorded: boolean): { at: string } | null {
  if (factRecorded || deliveryFromEvents(events, n).state !== "unknown") return null;
  const at = events.filter((e) => e.event_type === n.unknown).map((e) => e.created_at).sort()[0];
  return at ? { at } : null;
}
