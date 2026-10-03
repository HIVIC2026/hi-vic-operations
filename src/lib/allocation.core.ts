// Contractor allocation + direct self-scheduling (pure rules, no I/O).
// The portal never becomes a diary-booking desk: trades accept work, owner and trade contact each other
// directly for the active visit, and a time is booked only when the OTHER party (or office) confirms it.
// Stage progression stays with the existing guarded workflow (stageEntryBlockers / transition / autoAdvanceJob).
import { piesaRequestBlockers, type PiesaRequestFacts } from "./payment-gate.core";
import { WORKFLOW_DECISIONS } from "@/config/workflow-decisions";

export type VisitKind = "ready_check" | "piesa" | "rectification" | "installation";
export const OWNER_CONTACT_NOTICE = WORKFLOW_DECISIONS.directContact.ownerNotice;
export const TRADE_CONTACT_NOTICE = WORKFLOW_DECISIONS.directContact.tradeNotice;
export const INSTALLER_PLANNING_NOTICE =
  "The PIESA electrical safety visit is booked. This is for planning only. Do not book installation until electrical clearance is complete.";
export const REMINDER_AFTER_H = WORKFLOW_DECISIONS.directContact.reminderAfterHours; // 24
export const OFFICE_ALERT_AFTER_H = WORKFLOW_DECISIONS.directContact.officeAlertAfterHours; // 48

// ---------- A. PIESA offers ----------
/** PIESA allocation can start only when the existing PIESA request gate is fully satisfied. */
export function piesaOfferBlockers(f: PiesaRequestFacts & { hasActiveElectrician: boolean; hasOpenOffers: boolean }): string[] {
  const out = piesaRequestBlockers(f);
  if (f.hasActiveElectrician) out.push("An electrician has already accepted this PIESA.");
  if (f.hasOpenOffers) out.push("PIESA offers are already open for this job.");
  return out;
}

export type RecCandidate = {
  business_id: string; name: string;
  is_active: boolean; onboarding_status: string; accepting_new_jobs: boolean | null; receives_hivic_leads: boolean | null;
  coverage_verified: boolean; covers_postcode: boolean; exact_postcode: boolean;
  has_valid_licence: boolean; approved_workers: number;
  weekly_capacity: number | null; open_jobs: number; recent_offers_30d: number;
  acceptance_rate: number | null; // 0..1 over recent offers, null = no history
  preferred?: boolean;
  piesa_rate_inc_gst?: number | null; // shown only if a live agreed rate exists; NEVER used for ordering
};

export function recEligibilityBlocker(c: RecCandidate): string | null {
  if (!c.is_active || c.onboarding_status !== "approved") return "Partner is not an approved, active REC.";
  if (c.accepting_new_jobs === false) return "Partner is not accepting new jobs.";
  if (c.receives_hivic_leads === false) return "Partner does not receive Home Insulation Victoria jobs.";
  if (!c.coverage_verified || !c.covers_postcode) return "Partner does not have verified coverage for this area.";
  if (!c.has_valid_licence) return "Partner has no current electrical licence/REC registration on file.";
  if (c.approved_workers < 1) return "Partner has no approved licensed electrician available.";
  if (c.weekly_capacity != null && c.open_jobs >= c.weekly_capacity) return "Partner is at capacity.";
  return null;
}

/**
 * Order eligible RECs: preferred first, then exact postcode coverage, spare capacity, fair distribution
 * (fewest recent offers), then responsiveness. Price is deliberately not a sort key.
 */
export function rankRecCandidates(cands: RecCandidate[]): RecCandidate[] {
  const spare = (c: RecCandidate) => (c.weekly_capacity == null ? 1 : Math.max(0, c.weekly_capacity - c.open_jobs) / Math.max(1, c.weekly_capacity));
  return cands.filter((c) => !recEligibilityBlocker(c)).sort((a, b) =>
    Number(!!b.preferred) - Number(!!a.preferred) ||
    Number(b.exact_postcode) - Number(a.exact_postcode) ||
    spare(b) - spare(a) ||
    a.recent_offers_30d - b.recent_offers_30d ||
    (b.acceptance_rate ?? 0.5) - (a.acceptance_rate ?? 0.5) ||
    a.name.localeCompare(b.name));
}

/** Next small batch: a preferred REC is offered alone; otherwise up to `batchSize` not yet offered. */
export function nextOfferBatch(ranked: RecCandidate[], alreadyOffered: Set<string>, batchSize: number): RecCandidate[] {
  const left = ranked.filter((c) => !alreadyOffered.has(c.business_id));
  if (left[0]?.preferred) return [left[0]];
  return left.slice(0, Math.max(1, batchSize));
}

export function offerExpiry(now: Date, expiryHours: number): string {
  const h = Number.isFinite(expiryHours) && expiryHours > 0 ? expiryHours : 2;
  return new Date(now.getTime() + h * 3_600_000).toISOString();
}

export type OfferJobFacts = {
  job_number: string; suburb: string | null; postcode: string | null;
  measured_area_m2: number | null; access_summary: string | null; observations: string[];
  piesa_rate_inc_gst: number | null;
  // Present on the source row but must never leave the server before acceptance:
  address_line?: string | null; owner_name?: string | null; owner_phone?: string | null; owner_email?: string | null;
};
/** Minimum necessary pre-acceptance projection. Built from an allow-list, so new PII fields never leak. */
export function anonymisedOffer(f: OfferJobFacts) {
  return {
    job_number: f.job_number,
    suburb: f.suburb,
    postcode: f.postcode,
    approx_area_m2: f.measured_area_m2 == null ? null : Math.round(f.measured_area_m2 / 5) * 5,
    access_summary: f.access_summary,
    observations: f.observations.slice(0, 6),
    piesa_rate_inc_gst: f.piesa_rate_inc_gst,
  };
}

export const ACCEPT_OUTCOME_MESSAGE: Record<string, string> = {
  accepted: "Accepted. The owner's contact details for this visit are now available.",
  already_accepted: "You have already accepted this job.",
  already_withdrawn: "Another electrician accepted this job first.",
  already_declined: "This offer was declined.",
  already_expired: "This offer has expired.",
  expired: "This offer has expired.",
  already_assigned: "Another electrician accepted this job first.",
  not_member: "This offer was made to a different business.",
  partner_not_approved: "Your business is not approved to accept work yet.",
  wrong_kind: "This offer cannot be accepted here.",
  not_found: "Offer not found.",
};

// ---------- B. Direct coordination SLA ----------
export type CoordinationFacts = {
  releasedAt: string | null; // contact release for the active visit
  firstProposalAt: string | null;
  confirmedAt: string | null; // other party or office confirmed
  reminderSentAt?: string | null;
};
export type CoordinationState =
  | { state: "not_released" } | { state: "booked" }
  | { state: "waiting"; hours: number } | { state: "remind"; hours: number } | { state: "needs_office"; hours: number };

/** Contact release, link opens, reminders and one-sided proposals never count as booked. */
export function coordinationState(f: CoordinationFacts, now = new Date()): CoordinationState {
  if (f.confirmedAt) return { state: "booked" };
  if (!f.releasedAt) return { state: "not_released" };
  const hours = (now.getTime() - Date.parse(f.releasedAt)) / 3_600_000;
  if (hours >= OFFICE_ALERT_AFTER_H) return { state: "needs_office", hours };
  if (hours >= REMINDER_AFTER_H && !f.firstProposalAt && !f.reminderSentAt) return { state: "remind", hours };
  return { state: "waiting", hours };
}

export type ProposalLike = { status: string; proposer_role: string };
/** Booked only when the recorded proposal is accepted by someone other than the proposer, or by office. */
export function isConfirmedBooking(p: ProposalLike & { responder_role?: string | null }): boolean {
  if (p.status !== "accepted" || !p.responder_role) return false;
  return p.responder_role === "admin" || p.responder_role !== p.proposer_role;
}

// ---------- C. PIESA result / rectification / clearance ----------
export type ClearanceFacts = {
  piesaOutcome: "pass" | "fail" | null;
  piesaCompletedAt: string | null; // initial PIESA completed and signed
  rectificationRequired: boolean;
  rectificationQuoteAccepted: boolean;
  rectificationCompletedAt: string | null;
  sectionCSignedAt: string | null;
};
export type Clearance = { cleared: boolean; timingDate: string | null; basis: "initial_piesa" | "section_c" | null; blocker: string | null; pendingConfirmation: string };
export const TIMING_RULE_WARNING = "The 30-day timing rule is an operational rule pending written confirmation.";

/** Electrical clearance + the date the 30-day installation-commencement window runs from. */
export function electricalClearance(f: ClearanceFacts): Clearance {
  const base = { pendingConfirmation: TIMING_RULE_WARNING };
  if (!f.piesaCompletedAt || !f.piesaOutcome) return { ...base, cleared: false, timingDate: null, basis: null, blocker: "PIESA not completed and signed yet." };
  if (!f.rectificationRequired) {
    if (f.piesaOutcome !== "pass") return { ...base, cleared: false, timingDate: null, basis: null, blocker: "PIESA did not pass." };
    return { ...base, cleared: true, timingDate: f.piesaCompletedAt, basis: "initial_piesa", blocker: null };
  }
  if (!f.rectificationQuoteAccepted) return { ...base, cleared: false, timingDate: null, basis: null, blocker: "Owner has not approved the rectification quote." };
  if (!f.rectificationCompletedAt) return { ...base, cleared: false, timingDate: null, basis: null, blocker: "Rectification not completed yet." };
  if (!f.sectionCSignedAt) return { ...base, cleared: false, timingDate: null, basis: null, blocker: "Section C not completed and signed yet." };
  return { ...base, cleared: true, timingDate: f.sectionCSignedAt, basis: "section_c", blocker: null };
}

/** Installation contact release / booking is hard blocked until electrical clearance is valid. */
export function installationCoordinationBlocker(c: Clearance): string | null {
  return c.cleared ? null : `Installation cannot be arranged yet: ${c.blocker}`;
}

export type RectQuoteFacts = { kind: string; status: string; office_reviewed_at: string | null; has_unpriced_items: boolean };
/** Rectification quotes are always office-reviewed before they reach the owner. */
export function rectificationSendBlocker(q: RectQuoteFacts, actorIsOffice: boolean): string | null {
  if (q.kind !== "rectification") return null;
  if (!actorIsOffice) return "Only Home Insulation Victoria office staff can send a rectification quote.";
  if (q.has_unpriced_items) return "Some rectification items still need office pricing.";
  if (!q.office_reviewed_at) return "Rectification quote must be reviewed by the office before it is sent.";
  if (q.status !== "draft") return "Only a draft rectification quote can be sent.";
  return null;
}
export function rectificationVisitBlocker(f: { quoteAccepted: boolean; recActiveApproved: boolean }): string | null {
  if (!f.quoteAccepted) return "Owner must approve the rectification quote before the visit is arranged.";
  if (!f.recActiveApproved) return "The PIESA electrician is no longer approved/active — office must arrange another REC.";
  return null;
}

// ---------- D. Installer ----------
/** The agreed installer is never silently replaced. A decline always stops in the office queue. */
export function installerUnavailableOutcome(f: { reason: string | null | undefined }) {
  return {
    substitute: false as const,
    exception: "installer_unavailable" as const,
    why: `The agreed installer cannot proceed${f.reason ? `: ${f.reason}` : ""}.`,
    next: "Contact the owner, choose a replacement installer and issue an updated quote for owner approval if the price or terms change. Do not assign a new installer without the owner's approval.",
  };
}

// ---------- E. Needs Home Insulation Victoria ----------
export type NeedsCode =
  | "rec_coverage_exhausted" | "piesa_booking_overdue" | "delivery_failed" | "rectification_declined"
  | "rectification_pricing_review" | "installer_unavailable" | "installation_booking_overdue"
  | "piesa_timing_invalid" | "esc_or_distribution_timing" | "compliance_correction" | "registry_query" | "office_overdue";
export type NeedsItem = { key: string; code: NeedsCode; jobId: string | null; jobNumber: string | null; why: string; next: string; tab: string; since: string | null };

export const NEEDS_TEXT: Record<NeedsCode, { why: string; next: string; tab: string }> = {
  rec_coverage_exhausted: { why: "No approved electrician accepted the PIESA, or none cover this area.", next: "Find an approved REC for this area (or approve one in Coverage), then offer the job from the Overview tab.", tab: "overview" },
  piesa_booking_overdue: { why: "48 hours since contact details were shared and no PIESA time has been confirmed.", next: "Call the owner and electrician, confirm a time on the Overview tab, or release the electrician and re-offer.", tab: "overview" },
  delivery_failed: { why: "A message needed to move this job forward failed to deliver.", next: "Check the address/number on the Communications tab and resend or contact the person directly.", tab: "communications" },
  rectification_declined: { why: "The owner declined required electrical rectification, so installation cannot proceed.", next: "Talk to the owner about options; put the job on hold or cancel it with a reason.", tab: "quotes" },
  rectification_pricing_review: { why: "Rectification items need office pricing or review before the quote can go to the owner.", next: "Price each item on the Quotes tab, mark the rectification quote reviewed, then send it.", tab: "quotes" },
  installer_unavailable: { why: "The agreed installer cannot proceed.", next: "Agree a replacement with the owner and issue an updated quote for approval if terms change.", tab: "overview" },
  installation_booking_overdue: { why: "48 hours since installation contact details were shared and no installation time has been confirmed.", next: "Call the owner and installer and confirm a time on the Overview tab.", tab: "overview" },
  piesa_timing_invalid: { why: "Installation may not commence within 30 days of the PIESA timing date.", next: "Check the PIESA tab; bring installation forward or arrange a new PIESA.", tab: "piesa" },
  esc_or_distribution_timing: { why: "Installation is close but the PIESA copy or ESC pre-install notice is not done in time.", next: "Send the PIESA copy / ESC notice from the Compliance tab, or move the installation date.", tab: "compliance" },
  compliance_correction: { why: "A compliance record needs correcting before the job can continue.", next: "Open the Evidence tab and fix or request the missing/incorrect item.", tab: "evidence" },
  registry_query: { why: "The ESC/VEEC Registry raised a query or rejected the lodgement.", next: "Answer the query or correct and resubmit on the VEEC tab.", tab: "veec" },
  office_overdue: { why: "A task owned by Home Insulation Victoria is overdue.", next: "Open the job and complete the overdue office step.", tab: "overview" },
};

export function needsItem(code: NeedsCode, jobId: string | null, jobNumber: string | null, since: string | null, detail?: string): NeedsItem {
  const t = NEEDS_TEXT[code];
  return { key: `${code}:${jobId ?? "-"}`, code, jobId, jobNumber, why: detail ? `${t.why} ${detail}` : t.why, next: t.next, tab: t.tab, since };
}

export type NeedsInput = {
  now: Date;
  jobs: { id: string; job_number: string | null }[];
  coverageExhausted: { job_id: string; created_at: string }[]; // latest exhaustion with no active electrician since
  releases: { job_id: string; visit_kind: VisitKind; released_at: string; confirmed_at: string | null }[];
  failedComms: { job_id: string; created_at: string }[];
  rectDeclined: { job_id: string; created_at: string | null }[];
  rectPricing: { job_id: string; created_at: string | null }[];
  installerUnavailable: { job_id: string; at: string; reason: string | null }[];
  piesaTiming: { job_id: string; urgency: string | null; piesa_expired: boolean | null; days_remaining: number | null }[];
  escTiming: { job_id: string; created_at: string | null }[];
  evidenceRejected: { job_id: string; created_at: string | null }[];
  registryQueries: { job_id: string; status: string; updated_at: string | null }[];
  officeOverdue: { job_id: string | null; title: string; since: string | null }[];
};

/** ONE office exception queue: only what automation cannot safely resolve, never routine waiting. */
export function buildNeedsHivic(i: NeedsInput): NeedsItem[] {
  const jobs = new Map(i.jobs.map((j) => [j.id, j.job_number]));
  const out = new Map<string, NeedsItem>();
  const add = (code: NeedsCode, jobId: string | null, since: string | null, detail?: string) => {
    if (jobId && !jobs.has(jobId)) return;
    const it = needsItem(code, jobId, jobId ? jobs.get(jobId) ?? null : null, since, detail);
    if (!out.has(it.key)) out.set(it.key, it);
  };
  for (const e of i.coverageExhausted) add("rec_coverage_exhausted", e.job_id, e.created_at);
  for (const r of i.releases) {
    if (r.visit_kind === "ready_check") continue; // Ready Check keeps its existing follow-up flow
    const s = coordinationState({ releasedAt: r.released_at, firstProposalAt: null, confirmedAt: r.confirmed_at }, i.now);
    if (s.state !== "needs_office") continue;
    if (r.visit_kind === "installation") add("installation_booking_overdue", r.job_id, r.released_at);
    else add("piesa_booking_overdue", r.job_id, r.released_at, r.visit_kind === "rectification" ? "(Rectification visit.)" : undefined);
  }
  for (const c of i.failedComms) add("delivery_failed", c.job_id, c.created_at);
  for (const q of i.rectDeclined) add("rectification_declined", q.job_id, q.created_at);
  for (const q of i.rectPricing) add("rectification_pricing_review", q.job_id, q.created_at);
  for (const u of i.installerUnavailable) add("installer_unavailable", u.job_id, u.at, u.reason ? `Reason: ${u.reason}` : undefined);
  for (const p of i.piesaTiming) if (p.piesa_expired || p.urgency === "red") add("piesa_timing_invalid", p.job_id, null, p.days_remaining != null ? `${p.days_remaining} day(s) left.` : undefined);
  for (const e of i.escTiming) add("esc_or_distribution_timing", e.job_id, e.created_at);
  for (const e of i.evidenceRejected) add("compliance_correction", e.job_id, e.created_at);
  for (const r of i.registryQueries) add("registry_query", r.job_id, r.updated_at, `Status: ${r.status}.`);
  for (const o of i.officeOverdue) add("office_overdue", o.job_id, o.since, o.title);
  return [...out.values()].sort((a, b) => (a.since ?? "").localeCompare(b.since ?? ""));
}
