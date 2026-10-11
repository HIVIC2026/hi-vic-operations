// A1 manual customer communication (STEP 17). PURE: no I/O.
// Office prepares an APPROVED customer email to copy and send outside the portal, then separately records what
// actually happened. Nothing here sends, queues or reserves anything, changes approval flags or the comms lock,
// or marks "Save my spot" (that stays owner-driven).
import type { AutomaticLeadEmail } from "./enquiry-groups.core";

// ---------- Which approved email Office may prepare ----------
export type ManualEmailTemplate = "save_my_spot" | "ineligible_result";
export const MANUAL_TEMPLATES: ManualEmailTemplate[] = ["save_my_spot", "ineligible_result"];
export const MANUAL_TEMPLATE_LABEL: Record<ManualEmailTemplate, string> = {
  save_my_spot: "Save your spot – likely eligible (approved)",
  ineligible_result: "Preliminary eligibility result – ineligible (approved)",
};
export const GROUP_B_MANUAL_BLOCKED = "Group B insulation-details wording is not approved for manual sending. Phone the owner or record the outcome instead.";
export const TYPICAL_SIZE_MANUAL_BLOCKED = "This estimate uses the typical-size (150 m²) assumption. Typical-size emails stay on hold until the original enquiry can be proven new, so none is available to copy.";
export const NO_MANUAL_EMAIL = "No approved email applies to this lead – handle it individually.";
export const SYSTEM_ALREADY_SENT = "The portal has already sent this email (or a send is in progress or uncertain). Check the delivery history before contacting the owner again.";

export type PreparedManualEmail =
  | { ok: true; jobId: string; jobNumber: string | null; template: ManualEmailTemplate; templateLabel: string; to: string; subject: string; plainText: string; html: string; notices: string[] }
  | { ok: false; jobId: string; jobNumber: string | null; reason: string };
export type PreparedApprovedEmail = Extract<PreparedManualEmail, { ok: true }>;

/** Picks the approved email from the single post-Gate-1 route (`automaticLeadEmail`). Group B and held typical-size estimates are never offered. */
export function manualTemplateFor(x: { route: AutomaticLeadEmail; routeBlocker: string | null; typicalSizeEstimate: boolean }): { template: ManualEmailTemplate } | { blocked: string } {
  switch (x.route) {
    case "offer_spot": return x.typicalSizeEstimate ? { blocked: TYPICAL_SIZE_MANUAL_BLOCKED } : { template: "save_my_spot" };
    case "ineligible": return { template: "ineligible_result" };
    case "request_insulation": return { blocked: GROUP_B_MANUAL_BLOCKED };
    case "none": return { blocked: x.routeBlocker ? `${x.routeBlocker} – no approved email to prepare.` : NO_MANUAL_EMAIL };
  }
}

/** customer_email_sends statuses that mean the portal sent, is sending, or may have sent the email. */
export const SYSTEM_SENT_STATUSES = ["sent", "sending", "delivered_unrecorded"];

/** Plain words for the hold/suppression codes of the portal sender. A manual copy obeys the SAME rules as the approved
 *  sender (only the global delivery switch and provider are skipped – that is what manual sending replaces). */
const MANUAL_REASON: Record<string, string> = {
  job_not_found: "Job not found.",
  test_delivery_blocked: "TEST enquiry – no customer email.",
  initial_checks_pending: "Initial checks are still running.",
  official_decision_not_recorded: "No official eligibility result is recorded.",
  eligibility_review_required: "Eligibility needs office review first.",
  official_not_ineligible: "The recorded result is no longer ineligible.",
  no_consent: "No current contact consent from the owner – do not email.",
  no_owner_email: "No owner email on record.",
  unsubscribed: "Owner unsubscribed – do not email.",
  bounced: "Email bounced, complaint or later customer activity – check before contacting.",
  test_or_example_recipient: "Test or example address.",
  job_progressed_or_closed: "The job has moved on from the enquiry stage – this email no longer applies.",
  backlog_cutoff_not_set: "The customer email start date is not set yet, so this email is not available (same rule as the portal sender).",
  backlog_before_cutoff: "This enquiry is from before the customer email start date, so this email is not available (same rule as the portal sender).",
  backlog_too_old: "This enquiry is more than 14 days old, so this email is not available (same rule as the portal sender).",
};
/** Plain words for a hold/suppression code (null = none). Unknown codes still block (fail closed). */
export function manualReasonText(code: string | null | undefined): string | null {
  if (!code) return null;
  return MANUAL_REASON[code] ?? code;
}

// ---------- Recording what Office actually did ----------
export type ManualOutcome = "sent_manually" | "phoned" | "not_sent" | "followup_required";
export const MANUAL_OUTCOME_ORDER: ManualOutcome[] = ["sent_manually", "phoned", "not_sent", "followup_required"];
export const MANUAL_OUTCOME_LABEL: Record<ManualOutcome, string> = {
  sent_manually: "Sent manually",
  phoned: "Customer contacted by phone",
  not_sent: "Not sent",
  followup_required: "Follow-up required",
};
/** Marker stored in job_communications.source_event (`manual_office_communication:<outcome>`). */
export const MANUAL_SOURCE_EVENT = "manual_office_communication";
/** source_event of a "Sent manually" record (read by the portal senders' duplicate guard). */
export const MANUAL_SENT_EVENT = `${MANUAL_SOURCE_EVENT}:sent_manually`;
/** job_communications.provider for every Office-recorded entry. System emails carry their delivery provider (e.g. "resend"). */
export const MANUAL_PROVIDER = "manual";
export const MANUAL_SENDER = "Home Insulation Victoria office (sent outside the portal)";

export type ManualRecordPlan = {
  direction: "outbound" | "internal"; channel: "email" | "phone" | "note";
  /** Office-only: never readable by the owner or trades. */
  visibility: "internal"; deliveryStatus: "recorded"; provider: typeof MANUAL_PROVIDER; sourceEvent: string;
  needsApprovedEmail: boolean; needsNote: boolean;
  /** Only an actual manual email is outbound, so only it counts as owner contact on Office status (outbound + sent_at
   *  reads as "Estimate sent"). Phone calls and notes are internal rows and never do. */
  countsAsOwnerContact: boolean;
};
export function planManualRecord(outcome: ManualOutcome): ManualRecordPlan {
  const base = { visibility: "internal", deliveryStatus: "recorded", provider: MANUAL_PROVIDER, sourceEvent: `${MANUAL_SOURCE_EVENT}:${outcome}` } as const;
  switch (outcome) {
    case "sent_manually": return { ...base, direction: "outbound", channel: "email", needsApprovedEmail: true, needsNote: false, countsAsOwnerContact: true };
    case "phoned": return { ...base, direction: "internal", channel: "phone", needsApprovedEmail: false, needsNote: true, countsAsOwnerContact: false };
    case "not_sent": return { ...base, direction: "internal", channel: "note", needsApprovedEmail: false, needsNote: true, countsAsOwnerContact: false };
    case "followup_required": return { ...base, direction: "internal", channel: "note", needsApprovedEmail: false, needsNote: true, countsAsOwnerContact: false };
  }
}

export type ManualRecordInput = {
  outcome: ManualOutcome;
  template?: ManualEmailTemplate | null | undefined;
  subject?: string | null | undefined;
  body?: string | null | undefined;
  note?: string | null | undefined;
};
/** Null when valid. "Sent manually" must carry the prepared approved email; every other outcome needs a short note. */
export function manualRecordBlocker(i: ManualRecordInput): string | null {
  if (!MANUAL_OUTCOME_ORDER.includes(i.outcome)) return "Choose what happened.";
  const plan = planManualRecord(i.outcome);
  if (plan.needsApprovedEmail) {
    if (!i.template || !MANUAL_TEMPLATES.includes(i.template) || (i.subject ?? "").trim().length < 3 || (i.body ?? "").trim().length < 20)
      return "Prepare the approved email first – “Sent manually” records the exact approved subject and body you copied.";
  }
  if (plan.needsNote && (i.note ?? "").trim().length < 3) return "Add a short note (at least 3 characters) describing what happened.";
  return null;
}
/** Stored subject/body. The approved email is kept verbatim; note outcomes store the trimmed note. */
export function manualRecordContent(i: ManualRecordInput): { subject: string; body: string; sourceReference: string | null } {
  if (planManualRecord(i.outcome).needsApprovedEmail) return { subject: (i.subject ?? "").trim(), body: i.body ?? "", sourceReference: manualSendReference(i.template as ManualEmailTemplate) };
  return { subject: `Office record: ${MANUAL_OUTCOME_LABEL[i.outcome]}`, body: (i.note ?? "").trim(), sourceReference: null };
}

// ---------- Manual record markers (staff labels: communicationOrigin in portal-presentation.core.ts) ----------
export function manualOutcomeOf(sourceEvent: string | null | undefined): ManualOutcome | null {
  const prefix = `${MANUAL_SOURCE_EVENT}:`;
  if (!sourceEvent?.startsWith(prefix)) return null;
  const o = sourceEvent.slice(prefix.length) as ManualOutcome;
  return MANUAL_OUTCOME_ORDER.includes(o) ? o : null;
}
/** source_reference of a "Sent manually" record for this template; the portal senders refuse a duplicate when it exists. */
export const manualSendReference = (template: ManualEmailTemplate) => `template:${template}`;
