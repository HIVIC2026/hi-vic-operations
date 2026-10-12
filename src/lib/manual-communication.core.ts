// A1 manual customer communication (STEP 17, finalised STEP 32). PURE: no I/O.
// Office prepares an APPROVED customer email to copy and send outside the portal, then separately records what
// actually happened. Nothing here sends, queues or reserves anything, changes approval flags or the comms lock,
// or marks "Save my spot" (that stays owner-driven).
import type { AutomaticLeadEmail } from "./enquiry-groups.core";
import type { LocationVariables } from "./activity48.core";
import { DEFAULT_ESTIMATED_AREA_M2, computeEstimate, type RetailSettings } from "./estimate.core";

// ---------- Which approved email Office may prepare ----------
export type ManualEmailTemplate = "save_my_spot" | "ineligible_result";
export const MANUAL_TEMPLATES: ManualEmailTemplate[] = ["save_my_spot", "ineligible_result"];
export const MANUAL_TEMPLATE_LABEL: Record<ManualEmailTemplate, string> = {
  save_my_spot: "Save your spot – likely eligible (approved)",
  ineligible_result: "Preliminary eligibility result – ineligible (approved)",
};
export const GROUP_B_MANUAL_BLOCKED = "Group B insulation-details wording is not approved for manual sending. Phone the owner or record the outcome instead.";
export const TYPICAL_SIZE_MANUAL_BLOCKED = "The owner gave no ceiling size. The approved typical-size (150 m²) wording may only go as the automatic first reply to a new enquiry – never from an office list – so there is no email to copy.";
export const GLOBAL_LOCK_MANUAL_BLOCKED = "Customer emails are switched off for the whole portal (global communications lock), so the ineligible email can't be prepared for sending.";
export const NO_MANUAL_EMAIL = "No approved email applies to this lead – handle it individually.";
export const SYSTEM_ALREADY_SENT = "The portal has already sent this email (or a send is in progress or uncertain). Check the delivery history before contacting the owner again.";

/** Office-only figures on the assumed size. Never saved, never sent, never written to the owner's details. */
export type AssumedSizeEstimate = {
  areaM2: number; areaLabel: string; assumption: string;
  estimatedCost: number; rebate: number; grossBeforeRebate: number; installation: number; assessmentFee: number; apFee: number;
};
export type PreparedManualEmail =
  | { ok: true; jobId: string; jobNumber: string | null; template: ManualEmailTemplate; templateLabel: string; to: string; subject: string; plainText: string; html: string; notices: string[];
      /** false = the lead has no unsubscribe/referral link yet, so the preview shows placeholders and must not be copied. */
      linksReady: boolean }
  | { ok: false; jobId: string; jobNumber: string | null; reason: string; internalEstimate: AssumedSizeEstimate | null };
export type PreparedApprovedEmail = Extract<PreparedManualEmail, { ok: true }>;

/** Picks the approved email from the single post-Gate-1 route (`automaticLeadEmail`). Jo (12 Oct 2026): Office may prepare
 *  the approved no-size Save my spot copy, and the reviewed-under-R2 variant for Group B homes whose media the office
 *  recorded as below R2. Group B without that review is still never offered. */
export function manualTemplateFor(x: { route: AutomaticLeadEmail; routeBlocker: string | null; typicalSizeEstimate?: boolean; reviewedUnderR2?: boolean }): { template: ManualEmailTemplate } | { blocked: string } {
  switch (x.route) {
    case "offer_spot": return { template: "save_my_spot" };
    case "ineligible": return { template: "ineligible_result" };
    case "request_insulation": return x.reviewedUnderR2 ? { template: "save_my_spot" } : { blocked: GROUP_B_MANUAL_BLOCKED };
    case "none": return { blocked: x.routeBlocker ? `${x.routeBlocker} – no approved email to prepare.` : NO_MANUAL_EMAIL };
  }
}
/** Office already recorded "Sent manually" for this email – preparing it again is refused (no duplicate). */
export const MANUAL_ALREADY_SENT = "Office already recorded sending this email by hand. It won't be prepared again – check the communication history.";

/** 43-character preview placeholder for a link the lead doesn't have yet (passes the link validators, plainly not real).
 *  A preview carrying it is never copyable and can never be recorded as sent. */
export const PREVIEW_LINK_TOKEN = "PREVIEW_ONLY_link_issued_before_sending".padEnd(43, "X");
export const hasPreviewPlaceholder = (text: string | null | undefined) => (text ?? "").includes(PREVIEW_LINK_TOKEN);
/** Display-only: shows each placeholder link as a plain marker, so a preview can be read but never pasted with a fake link. */
export const previewDisplayText = (text: string) => text.replace(new RegExp(`https?://[^\\s<>"']*${PREVIEW_LINK_TOKEN}[^\\s<>"']*`, "g"), "[link created before sending]");

/** Missing ceiling size: the internal estimate is shown only when the owner may be contacted at all; otherwise the
 *  real reason is shown instead (same wording as the Save my spot sender). */
export function missingSizeContactBlocker(x: { stage: string | null; optedOut: boolean; spotSaved: boolean; consent: boolean }): string | null {
  if (["cancelled", "complete"].includes(x.stage ?? "")) return "Job is closed.";
  if (x.spotSaved) return "Spot already saved.";
  if (x.optedOut) return "Owner opted out.";
  if (!x.consent) return "No current contact consent.";
  return null;
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
};
/** Plain words for a hold/suppression code (null = none). Unknown codes still block (fail closed). */
export function manualReasonText(code: string | null | undefined): string | null {
  if (!code) return null;
  return MANUAL_REASON[code] ?? code;
}

/** Delivery-SCHEDULE rules of the automatic sender (email start date, 14-day window). Approved STEP 32: they keep
 *  blocking every automatic send but never block an Office manual copy – the copy shows them as a notice instead. */
const AUTOMATIC_SCHEDULE_ONLY: Record<string, string> = {
  backlog_cutoff_not_set: "the customer email start date is not set.",
  backlog_before_cutoff: "the enquiry is from before the customer email start date.",
  backlog_too_old: "the enquiry is more than 14 days old.",
};
/** Contact suppression for a manual copy: contact rules block; schedule-only rules become a notice. */
export function manualSuppression(code: string | null | undefined): { block: string | null; notice: string | null } {
  if (!code) return { block: null, notice: null };
  const schedule = AUTOMATIC_SCHEDULE_ONLY[code];
  if (schedule) return { block: null, notice: `Automatic sending skips this lead because ${schedule} A manual copy is allowed.` };
  return { block: manualReasonText(code), notice: null };
}

// ---------- Missing ceiling size: internal estimate on the assumed size (STEP 32) ----------
export const ASSUMED_SIZE_LABEL = `Assumed size: ${DEFAULT_ESTIMATED_AREA_M2} m² (typical Victorian home) – not measured and not provided by the owner`;
export const ASSUMED_SIZE_NOTE = "Internal indicative estimate for office use only. Calculated now with current prices on the assumed size; not saved, not sent, and the owner's details are unchanged.";
/** Uses the existing pricing maths unchanged; only the area is the clearly labelled assumption. Only for the
 *  likely-eligible, no-insulation route (the caller checks), so the insulation input is "none". */
export function assumedSizeEstimate(loc: LocationVariables, s: RetailSettings): AssumedSizeEstimate {
  const r = computeEstimate({ m2: DEFAULT_ESTIMATED_AREA_M2, source: "typical_default", basis: "assumed", id: null, label: ASSUMED_SIZE_LABEL }, loc, "none", s);
  const st = r.primary.by_access.standard;
  return {
    areaM2: DEFAULT_ESTIMATED_AREA_M2, areaLabel: ASSUMED_SIZE_LABEL, assumption: ASSUMED_SIZE_NOTE,
    estimatedCost: st.estimated_customer_total, rebate: st.applied_discount, grossBeforeRebate: st.pre_discount_total, installation: st.installation,
    assessmentFee: Number(s.piesa_assessment_inc_gst), apFee: Number(s.ap_management_inc_gst),
  };
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
    if (hasPreviewPlaceholder(i.body)) return "This copy still has preview placeholder links. Create the sending links, copy the email again, then record it.";
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

// ---------- Leads status after manual communication (STEP 32) ----------
export type ManualRecordRow = { source_event: string | null; source_reference: string | null; created_at: string; body?: string | null };
export type ManualNextKind = "followup_pending" | "phoned" | "not_sent" | "sent_manually";
export const MANUAL_NEXT_LABEL: Record<ManualNextKind, string> = {
  followup_pending: "Next action: follow-up pending",
  phoned: "Contacted by phone",
  not_sent: "Not sent (office decision) – still to do",
  sent_manually: "Email sent by hand by the office – not by the portal",
};
export type ManualLeadView = {
  /** Latest recorded manual send per approved template (null = never sent by hand). */
  saveSpotSentAt: string | null; ineligibleSentAt: string | null;
  /** The most recent manual record, shown on the lead. Phone/not sent/follow-up never complete an email action. */
  latest: { kind: ManualNextKind; at: string; note: string | null } | null;
};
const KIND: Record<ManualOutcome, ManualNextKind> = { sent_manually: "sent_manually", phoned: "phoned", not_sent: "not_sent", followup_required: "followup_pending" };
export function manualLeadView(rows: ManualRecordRow[]): ManualLeadView {
  const v: ManualLeadView = { saveSpotSentAt: null, ineligibleSentAt: null, latest: null };
  for (const r of [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const o = manualOutcomeOf(r.source_event);
    if (!o) continue;
    if (o === "sent_manually" && r.source_reference === manualSendReference("save_my_spot")) v.saveSpotSentAt = r.created_at;
    if (o === "sent_manually" && r.source_reference === manualSendReference("ineligible_result")) v.ineligibleSentAt = r.created_at;
    v.latest = { kind: KIND[o], at: r.created_at, note: o === "sent_manually" ? null : (r.body ?? "").trim() || null };
  }
  return v;
}
/** Folds recorded manual sends into the Leads status input: a manual send completes exactly that email action
 *  (Save your spot → offering spot, ineligible → ineligible). Nothing else changes; the job itself is never completed. */
export function withManualSends<T extends { ineligibleEmailSent: boolean; campaignSent: boolean; campaignGroup: "likely" | "onsite" | null }>(x: T, m: ManualLeadView): T {
  return {
    ...x,
    ineligibleEmailSent: x.ineligibleEmailSent || !!m.ineligibleSentAt,
    campaignSent: x.campaignSent || !!m.saveSpotSentAt,
    campaignGroup: x.campaignGroup ?? (m.saveSpotSentAt ? "likely" : null),
  };
}
