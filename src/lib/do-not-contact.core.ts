// "Do not contact": the office marks an owner as not to be contacted. It stops AUTOMATIC owner messages only.
// Compliance sends (legal copies, completion pack, deposit receipt, non-compliance notice) still go. Append-only
// workflow_events, latest wins; no SQL.
export const DO_NOT_CONTACT_SET_EVENT = "owner_do_not_contact_set";
export const DO_NOT_CONTACT_CLEARED_EVENT = "owner_do_not_contact_cleared";
export const DO_NOT_CONTACT_REASON = "Owner asked not to be contacted";

export const COMPLIANCE_OWNER_EMAIL_PURPOSES: readonly string[] = [
  "esc_consent_copy", "piesa_copy", "veec_assignment_copy", "install_complete", "completion_pack", "install_deposit_paid",
  "non_compliance_notice", // sent by Part 4 Task 13; listed here so the guard exists first
  "tenant_notice", // Part 4 Task 16 (cl 23): the tenant is told the install day — the owner's Do not contact / unsubscribe is about the owner
];

/** An unsubscribe blocks everything except the legal copies; a suppression event (bounce/complaint) blocks everything. */
export function unsubscribeBlocks(x: { purpose: string; unsubscribed: boolean; suppressed: boolean }): boolean {
  if (x.suppressed) return true;
  return x.unsubscribed && !COMPLIANCE_OWNER_EMAIL_PURPOSES.includes(x.purpose);
}

/** True when the newest set/cleared event is "set". An unreadable timestamp sorts as oldest. */
export function doNotContactOn(events: { event_type: string; created_at: string }[]): boolean {
  let latest: { t: number; on: boolean } | null = null;
  for (const e of events) {
    const on = e.event_type === DO_NOT_CONTACT_SET_EVENT;
    if (!on && e.event_type !== DO_NOT_CONTACT_CLEARED_EVENT) continue;
    const t = Date.parse(e.created_at);
    const tt = Number.isFinite(t) ? t : -Infinity;
    // On a tie the later-listed event wins.
    if (!latest || tt >= latest.t) latest = { t: tt, on };
  }
  return latest?.on ?? false;
}

/** Reason an owner message must not go, or null. Texts are never compliance sends. */
export function doNotContactBlocks(x: { channel: "email" | "sms"; purpose: string; on: boolean }): string | null {
  if (!x.on) return null;
  if (x.channel === "email" && COMPLIANCE_OWNER_EMAIL_PURPOSES.includes(x.purpose)) return null;
  return DO_NOT_CONTACT_REASON;
}

/** `owner_contact_consents.source` written by recordUnsubscribe (emailsafety.server.ts). */
export const UNSUBSCRIBE_CONSENT_SOURCE = "unsubscribe";

/** Whether the latest owner contact consent row lets this email purpose go. Granted always does. A not_granted row written
 *  by an unsubscribe still lets the legal copies (compliance purposes) go; any other not_granted, or none, blocks. */
export function consentAllowsDelivery(latest: { consent_status: string; source?: string | null } | null, purpose?: string | null): boolean {
  if (!latest) return false;
  if (latest.consent_status === "granted") return true;
  return latest.consent_status === "not_granted" && latest.source === UNSUBSCRIBE_CONSENT_SOURCE && !!purpose && COMPLIANCE_OWNER_EMAIL_PURPOSES.includes(purpose);
}
