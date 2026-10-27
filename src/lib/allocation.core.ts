import { rectQuoteUnanswered } from "./rectification.core";
// Contractor allocation + direct self-scheduling (pure rules, no I/O).
// The portal never becomes a diary-booking desk: trades accept work, owner and trade contact each other
// directly for the active visit, and a time is booked only when the OTHER party (or office) confirms it.
// Stage progression stays with the existing guarded workflow (stageEntryBlockers / transition / autoAdvanceJob).
import { piesaRequestBlockers, type PiesaRequestFacts } from "./payment-gate.core";
import { WORKFLOW_DECISIONS } from "@/config/workflow-decisions";
import { veecQueryOverdue } from "./veec.core";
import { isBusinessDay, melbourneAt, melbourneYmd } from "./piesa-windows.core";

export type VisitKind = "ready_check" | "piesa" | "rectification" | "installation";
export const OWNER_CONTACT_NOTICE = WORKFLOW_DECISIONS.directContact.ownerNotice;
export const TRADE_CONTACT_NOTICE = WORKFLOW_DECISIONS.directContact.tradeNotice;
export const INSTALLER_PLANNING_NOTICE =
  "The Pre Insulation Electrical Safety Assessment (PIESA) visit is booked. This is for planning only. Do not book installation until electrical clearance is complete.";
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

/**
 * Why a PIESA / fix-up allocation produced NO offer at all.
 * `owner_times` = the owner's current times were offered to everyone who could take them and nobody could.
 * `coverage` = there is no approved electrician left to offer it to.
 */
export type NoOfferReason = "owner_times" | "coverage";

/**
 * The office must never be told "offers sent to approved electricians" when nothing was sent (P1 UAT DEF-08).
 * The old code returned `{offered: 0, exhausted: true}` and the screen still showed a success toast, so a job
 * silently stopped moving while the office believed electricians had been contacted. This is the sentence the
 * office now gets instead, and it names the one thing they have to do next.
 */
export function noOfferMessage(kind: "piesa" | "rectification", reason: NoOfferReason): string {
  const what = kind === "piesa" ? "PIESA" : "fix-up";
  return reason === "owner_times"
    ? `No approved electrician could take any of the owner's times, so no ${what} offer was sent. Ask the owner to choose new times.`
    : `No approved electrician is left to offer this ${what} to, so no offer was sent. Needs Home Insulation Victoria: no approved electrician coverage.`;
}

export type RecCandidate = {
  business_id: string; name: string;
  is_active: boolean; onboarding_status: string; accepting_new_jobs: boolean | null; receives_hivic_leads: boolean | null;
  coverage_verified: boolean; covers_postcode: boolean; exact_postcode: boolean;
  has_valid_licence: boolean; approved_workers: number;
  /** Plain reason when has_valid_licence is false (e.g. which document expired). */
  licence_blocker?: string | null;
  weekly_capacity: number | null; open_jobs: number; recent_offers_30d: number;
  acceptance_rate: number | null; // 0..1 over recent offers, null = no history
  preferred?: boolean;
  /** This electrician's own agreed rate from their approved rate card / agreement. NEVER the customer price; NEVER used for ordering. */
  electrician_rate_inc_gst?: number | null;
  // ---- Matching facts (Operating Model v2). All optional: missing = neutral / check skipped. ----
  /** false = booked in every one of the owner's PIESA windows. null = owner has no windows yet (check skipped). */
  free_in_window?: boolean | null;
  /** Has a confirmed job in a postcode they cover/the same postcode on one of the owner's window days. */
  nearby_job_that_day?: boolean;
  /** Reliability signals; not tracked per electrician yet, so they stay 0 until recorded. */
  no_shows?: number; evidence_rejections?: number;
  /** Jobs (accepted offers) in the last 30 days — fair spread. */
  recent_jobs_30d?: number;
  /** Average hours from offer to acceptance; null = no history. */
  avg_accept_hours?: number | null;
};

export function recEligibilityBlocker(c: RecCandidate): string | null {
  if (!c.is_active || c.onboarding_status !== "approved") return "Partner is not an approved, active REC.";
  if (c.accepting_new_jobs === false) return "Partner is not accepting new jobs.";
  if (c.receives_hivic_leads === false) return "Partner does not receive Home Insulation Victoria jobs.";
  if (!c.coverage_verified || !c.covers_postcode) return "Partner does not have verified coverage for this area.";
  if (!c.has_valid_licence) return c.licence_blocker || "Partner has no current electrical licence/REC registration on file.";
  if (c.approved_workers < 1) return "Partner has no approved licensed electrician available.";
  if (c.free_in_window === false) return "Partner is already booked in every one of the owner's times.";
  return null;
}

/** Reliability 0..1: acceptance rate (neutral 0.5 without history) minus recorded no-shows and evidence rejections. */
export function reliabilityScore(c: RecCandidate): number {
  return (c.acceptance_rate ?? 0.5) - 0.1 * (c.no_shows ?? 0) - 0.05 * (c.evidence_rejections ?? 0);
}

/**
 * Order eligible RECs (Operating Model v2). Price is deliberately never a sort key.
 * Home Insulation Victoria jobs: nearby job that day → reliability → fewest recent jobs (fair spread) → acceptance speed.
 * Installer-supplied jobs: the installer's preferred electrician first, then the same order.
 */
export function rankRecCandidates(cands: RecCandidate[], opts: { installerSourced?: boolean } = {}): RecCandidate[] {
  const speed = (c: RecCandidate) => c.avg_accept_hours ?? Number.POSITIVE_INFINITY;
  return cands.filter((c) => !recEligibilityBlocker(c)).sort((a, b) =>
    (opts.installerSourced ? Number(!!b.preferred) - Number(!!a.preferred) : 0) ||
    Number(!!b.nearby_job_that_day) - Number(!!a.nearby_job_that_day) ||
    reliabilityScore(b) - reliabilityScore(a) ||
    (a.recent_jobs_30d ?? 0) - (b.recent_jobs_30d ?? 0) ||
    (speed(a) === speed(b) ? 0 : speed(a) < speed(b) ? -1 : 1) ||
    a.name.localeCompare(b.name));
}

/** Next batch of up to `batchSize` not yet offered. On installer-supplied jobs a preferred REC is offered alone first. */
export function nextOfferBatch(ranked: RecCandidate[], alreadyOffered: Set<string>, batchSize: number, opts: { installerSourced?: boolean } = {}): RecCandidate[] {
  const left = ranked.filter((c) => !alreadyOffered.has(c.business_id));
  if (opts.installerSourced && left[0]?.preferred) return [left[0]];
  return left.slice(0, Math.max(1, batchSize));
}

export function offerExpiry(now: Date, expiryHours: number): string {
  const h = Number.isFinite(expiryHours) && expiryHours > 0 ? expiryHours : 2;
  return new Date(now.getTime() + h * 3_600_000).toISOString();
}

export const OFFER_BUSINESS_START_H = 8, OFFER_BUSINESS_END_H = 17;
/** Offer deadline counted in Melbourne business hours (8am–5pm, weekdays, excluding Vic public holidays). */
export function offerExpiryBusinessHours(now: Date, businessHours: number): string {
  let left = (Number.isFinite(businessHours) && businessHours > 0 ? businessHours : 4) * 3_600_000;
  let ymd = melbourneYmd(now);
  let cursor = now.getTime();
  for (let guard = 0; guard < 60; guard++) {
    if (isBusinessDay(ymd)) {
      const open = melbourneAt(ymd, OFFER_BUSINESS_START_H).getTime(), close = melbourneAt(ymd, OFFER_BUSINESS_END_H).getTime();
      const start = Math.max(cursor, open);
      if (start < close) {
        if (start + left <= close) return new Date(start + left).toISOString();
        left -= close - start;
      }
    }
    const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1);
    ymd = d.toISOString().slice(0, 10);
    cursor = 0;
  }
  return new Date(now.getTime() + left).toISOString();
}

export type OfferJobFacts = {
  job_number: string; suburb: string | null; postcode: string | null;
  measured_area_m2: number | null; access_summary: string | null; observations: string[];
  /** Electrician's own agreed rate (rate card/agreement/offer). Never the customer-facing PIESA price. */
  electrician_rate_inc_gst: number | null;
  /** Office explicitly chose to offer before a rate is recorded. */
  rate_to_confirm?: boolean;
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
    electrician_rate_inc_gst: f.electrician_rate_inc_gst,
    rate_to_confirm: f.electrician_rate_inc_gst == null ? !!f.rate_to_confirm : false,
  };
}

/** Rate rule: an electrician offer needs a recorded agreed rate, unless office explicitly marked it rate-to-confirm. */
export function offerRateBlocker(rate: number | null | undefined, rateToConfirm: boolean): string | null {
  if (rate != null && Number.isFinite(rate) && rate >= 0) return null;
  return rateToConfirm ? null : "No agreed electrician rate is recorded for this electrician. Set the rate, or office must explicitly mark the offer as rate to be confirmed.";
}

// ---------- Office electrician rate card ----------
export const ELECTRICIAN_RATE_SERVICES = {
  piesa: "Pre Insulation Electrical Safety Assessment (PIESA) visit",
  rectification_visit: "Electrical fixes visit",
  section_c_signoff: "Section C / electrical fixes sign-off",
  installation_attendance: "Installation electrical attendance",
} as const;
export type ElectricianRateService = keyof typeof ELECTRICIAN_RATE_SERVICES;
export type ElectricianRateRow = { id: string; business_id: string; service_type: string; rate_inc_gst: number | string; status: string; effective_from: string; effective_to: string | null };

/** Offer kind -> rate-card service used for the electrician's payable rate. */
export const OFFER_RATE_SERVICE: Record<"piesa" | "rectification", ElectricianRateService> = { piesa: "piesa", rectification: "rectification_visit" };

/** The one rate an offer may use: ACTIVE, in its effective window on `today` (YYYY-MM-DD). Draft/superseded/expired never count. */
export function selectAgreedRate(rows: ElectricianRateRow[], businessId: string, service: ElectricianRateService, today: string): ElectricianRateRow | null {
  const ok = rows.filter((r) => r.business_id === businessId && r.service_type === service && r.status === "active"
    && r.effective_from <= today && (r.effective_to == null || r.effective_to >= today));
  ok.sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));
  return ok[0] ?? null;
}

/** Office-only reason gate for "rate to be confirmed" overrides. */
export function rateToConfirmReasonBlocker(rateToConfirm: boolean, reason: string | null | undefined): string | null {
  if (!rateToConfirm) return null;
  return (reason ?? "").trim().length >= 5 ? null : "A reason is required to offer with the electrician rate to be confirmed.";
}

/** Office-only spread line. Never render on electrician or customer screens. */
export function officeSpread(customerPriceIncGst: number, electricianRateIncGst: number | null) {
  if (electricianRateIncGst == null) return { customer: customerPriceIncGst, electrician: null, spread: null, text: `Customer $${customerPriceIncGst.toFixed(2)} · Electrician rate missing` };
  const spread = Math.round((customerPriceIncGst - electricianRateIncGst) * 100) / 100;
  return { customer: customerPriceIncGst, electrician: electricianRateIncGst, spread, text: `Customer $${customerPriceIncGst.toFixed(2)} · Electrician $${electricianRateIncGst.toFixed(2)} · Spread $${spread.toFixed(2)} (inc GST)` };
}

/** Electrician-facing rate line. Only ever the electrician's own agreed rate; never the customer price. */
export function electricianRateText(summary: { electrician_rate_inc_gst?: number | null; rate_to_confirm?: boolean | null }): string {
  const r = summary.electrician_rate_inc_gst;
  if (r != null && Number.isFinite(r)) return `Your agreed rate: $${r.toFixed(2)} inc GST`;
  return "Rate to be confirmed";
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
  not_qualified: "Your business needs a recorded licence and an approved licensed electrician before accepting.",
  out_of_area: "This job is outside your verified service area.",
  job_not_ready: "This job is no longer ready for this visit.",
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
  /** Decision 314 follow-up (decision 315 commit): the A3's ONLY repair tick is "Be on site at the start of the install
   *  day" (fixes-times.core `onsiteStartOnly`) — no fixes visit and no Section C ever happen. Absent = false. */
  onsiteStartOnly?: boolean;
  /** Review R08: the approved payment rule has cleared (workflow.server `paymentGate`) AND the FULL accepted onsite
   *  electrical (fixes) charge has been received on top of the safety check payment (payments.core `onsiteChargePaid`,
   *  read by electrical-clearance.server). The safety check payment alone is never enough. Absent = false. */
  fixesPaymentCleared?: boolean;
};
export type ClearanceBasis = "initial_piesa" | "section_c" | "electrician_at_start";
export type Clearance = { cleared: boolean; timingDate: string | null; basis: ClearanceBasis | null; blocker: string | null; pendingConfirmation: string };
export const TIMING_RULE_WARNING = "The 30-day timing rule is an operational rule pending written confirmation.";

/** Electrical clearance + the date the 30-day installation-commencement window runs from. */
export function electricalClearance(f: ClearanceFacts): Clearance {
  const base = { pendingConfirmation: TIMING_RULE_WARNING };
  if (!f.piesaCompletedAt || !f.piesaOutcome) return { ...base, cleared: false, timingDate: null, basis: null, blocker: "PIESA not completed and signed yet." };
  if (!f.rectificationRequired) {
    if (f.piesaOutcome !== "pass") return { ...base, cleared: false, timingDate: null, basis: null, blocker: "PIESA did not pass." };
    return { ...base, cleared: true, timingDate: f.piesaCompletedAt, basis: "initial_piesa", blocker: null };
  }
  if (!f.rectificationQuoteAccepted) return { ...base, cleared: false, timingDate: null, basis: null, blocker: "Owner has not approved the electrical fixes quote." };
  // Decision 314 follow-up: "Be on site at the start of the install day" alone — the electrician attends the install day
  // instead of a fixes visit, so there is no Section C. Cleared once the owner has accepted the fixes quote AND the payment
  // rule has cleared; the 30 days still run from the official PIESA date (decision 316).
  if (f.onsiteStartOnly) {
    if (!f.fixesPaymentCleared) return { ...base, cleared: false, timingDate: null, basis: null, blocker: "Waiting for the owner's payment for the electrician on site at the start of the install day." };
    return { ...base, cleared: true, timingDate: f.piesaCompletedAt, basis: "electrician_at_start", blocker: null };
  }
  if (!f.rectificationCompletedAt) return { ...base, cleared: false, timingDate: null, basis: null, blocker: "Electrical fixes not completed yet." };
  if (!f.sectionCSignedAt) return { ...base, cleared: false, timingDate: null, basis: null, blocker: "Section C not completed and signed yet." };
  // Decision 316 (Jo 25 Oct 2026): fixes clear the job, but the 30 days still run from the official PIESA date.
  return { ...base, cleared: true, timingDate: f.piesaCompletedAt, basis: "section_c", blocker: null };
}

/** Decision 314 follow-up: the job is cleared on the "electrician on site at the start of the install day" basis — the
 *  open fixes items are done ON the install day (never marked completed here), so no fixes visit or booking is needed. */
export const onsiteStartAtInstall = (c: Pick<Clearance, "cleared" | "basis"> | null | undefined): boolean => !!c?.cleared && c.basis === "electrician_at_start";

export const FIXES_NOT_COMPLETED_BLOCKER = "Electrical fixes not yet completed.";
export const PASSING_PIESA_BLOCKER = "A passing PIESA / electrical sign-off is required before installation.";
/** The electrical part of entry to installation_scheduling / installation_booked (workflow.server `stageEntryBlockers`).
 *  Every job: no open fixes items and a current passing PIESA. Decision 314 on-site-only job cleared on
 *  `electrician_at_start`: the open items are done on the install day and the PIESA (which says the electrician must be
 *  present at the start) is accepted as recorded — it still needs a current PIESA date. */
export function installEntryElectricalBlockers(f: { openRectItems: number; piesaDate: string | null | undefined; piesaOutcome: string | null | undefined; onsiteStartCleared?: boolean }): string[] {
  const out: string[] = [];
  if (f.onsiteStartCleared) {
    if (!f.piesaDate) out.push(PASSING_PIESA_BLOCKER);
    return out;
  }
  if (f.openRectItems > 0) out.push(FIXES_NOT_COMPLETED_BLOCKER);
  if (!f.piesaDate || f.piesaOutcome !== "pass") out.push(PASSING_PIESA_BLOCKER);
  return out;
}

/** Installation contact release / booking is hard blocked until electrical clearance is valid. */
export function installationCoordinationBlocker(c: Clearance): string | null {
  return c.cleared ? null : `Installation cannot be arranged yet: ${c.blocker}`;
}

export type RectQuoteFacts = { kind: string; status: string; office_reviewed_at: string | null; has_unpriced_items: boolean;
  /** Decision 315 hold (fixes-times.core `fixesTimesHoldReason`): "Waiting for the electrician's fixes times". */
  fixes_times_hold?: string | null };
/** Rectification quotes are always office-reviewed before they reach the owner. */
export function rectificationSendBlocker(q: RectQuoteFacts, actorIsOffice: boolean): string | null {
  if (q.kind !== "rectification") return null;
  if (!actorIsOffice) return "Only Home Insulation Victoria office staff can send electrical fixes quote.";
  if (q.has_unpriced_items) return "Some electrical fixes items still need office pricing.";
  if (q.fixes_times_hold) return q.fixes_times_hold;
  if (!q.office_reviewed_at) return "Electrical fixes quote must be reviewed by the office before it is sent.";
  if (q.status !== "draft") return "Only a draft electrical fixes quote can be sent.";
  return null;
}
export function rectificationVisitBlocker(f: { quoteAccepted: boolean; recActiveApproved: boolean }): string | null {
  if (!f.quoteAccepted) return "Owner must approve the electrical fixes quote before the visit is arranged.";
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
  | "rectification_pricing_review" | "installer_unavailable" | "installation_booking_overdue" | "ready_check_booking_overdue"
  | "piesa_timing_invalid" | "esc_or_distribution_timing" | "compliance_correction" | "registry_query" | "office_overdue" | "rectification_quote_unanswered"
  | "rec_no_longer_approved" | "install_ten_days_left" | "install_days_declined"
  | "esc_submit_due" | "esc_submit_urgent" | "esc_update_registry" | "esc_withdraw_resubmit" | "prestart_failed" | "cert_rerecord_needed" | "white_card_not_verified" | "ready_check_no_taker" | "offer_no_taker_24h" | "choose_trades" | "ready_check_offer_returned"
  | "owner_no_show_repeat" | "trade_no_show" | "owner_cancelled_visit" | "rectification_new_times" | "installer_usual_electrician_missing"
  | "mitti_fix_form" | "mitti_review_pickup" | "ready_check_held" | "quote_held_review" | "quote_not_delivered" | "mitti_setup_installer" | "ready_check_chase_installer" | "quote_auto_send_held"
  | "xero_invoice_product_unconfirmed" | "veec_assignment_unsigned" | "electrician_install_attendance" | "install_deposit_unpaid_at_start"
  | "payment_match_unclear" | "xero_invoice_repairs_held" | "xero_invoice_repeat_piesa_held";
export type NeedsUrgency = "urgent" | "today" | "soon";
export type NeedsItem = { key: string; code: NeedsCode; jobId: string | null; jobNumber: string | null; why: string; next: string; tab: string; since: string | null; urgency: NeedsUrgency; stage: string | null; suburb: string | null };

export const NEEDS_TEXT: Record<NeedsCode, { why: string; next: string; tab: string; urgency: NeedsUrgency }> = {
  mitti_fix_form: { why: "Fix Mitti form: the Ready Check could not sync.", next: "Office needs to: read the reason, fix it (or ask the installer to), then press Retry on the job's Mitti card.", tab: "overview", urgency: "today" },
  mitti_review_pickup: { why: "Link/Review a form started in Mitti.", next: "Office needs to: open \"Ready Checks started in Mitti\" on Active jobs and link it to the right job (or create one).", tab: "overview", urgency: "today" },
  ready_check_held: { why: "Check held Ready Check: the owner quote can't be prepared yet.", next: "Office needs to: sort out each reason listed, then sync the Ready Check again.", tab: "quotes", urgency: "today" },
  quote_held_review: { why: "Review held quote.", next: "Office needs to: check the held owner quote on the Quotes tab and release it or stop it with a reason.", tab: "quotes", urgency: "today" },
  quote_auto_send_held: { why: "Quote not sent automatically: the Ready Check is Complete but a check failed (or the form changed after the quote was sent).", next: "Office needs to: read the reason on the Quotes tab, sort it out, then press Send quote (or ask the installer to fix the form).", tab: "quotes", urgency: "today" },
  quote_not_delivered: { why: "Quote not delivered: the owner was not emailed.", next: "Office needs to: contact the owner about their quote (it is on their job page).", tab: "communications", urgency: "today" },
  mitti_setup_installer: { why: "Set up installer in Mitti: the installer isn't in our Mitti account.", next: "Office needs to: invite the installer to Mitti with their portal email, then retry the form.", tab: "overview", urgency: "today" },
  // Decision 327 (Jo 25 Oct 2026) replaces the decision-314 "tell the installer and electrician" line: the electrician is asked
  // automatically; this row appears only after 48h with no answer (one reminder sent at 24h) or when they can do no day left.
  electrician_install_attendance: { why: "Electrician can't attend / hasn't confirmed install-day attendance", next: "Office needs to: call the electrician. If they can't do any day left in the 30-day window, arrange another electrician or a new PIESA with the owner.", tab: "overview", urgency: "today" },
  // Decision 367 (Jo 25 Oct 2026): the install day started but the 10% deposit is still unpaid (the pre-start check locks it).
  install_deposit_unpaid_at_start: { why: "Install day has started but the 10% install deposit is not paid — the install is locked.", next: "Office needs to: call the owner about the deposit (bank transfer / PayID). Once it shows in Xero the install unlocks; otherwise move the install day.", tab: "quotes", urgency: "urgent" },
  payment_match_unclear: { why: "A card payment and a Xero payment of the same amount have no shared Stripe id, so both are counted (audit R02).", next: "Office needs to: check in Xero. If it is the same card money, remove that Xero payment and apply it again with the Stripe id (pi_… or ch_…) in the Reference – it then counts once. If they are two payments, nothing changes.", tab: "quotes", urgency: "soon" },
  // Audit R07: the portal counts the approved fixes but the Xero invoice doesn't hold them yet.
  xero_invoice_repairs_held: { why: "Approved electrical fixes are not on the Xero invoice yet — the portal total and the Xero invoice disagree.", next: "Office needs to: add the fixes to the SAME Xero invoice (if Xero refuses because a payment is on it, remove the payment, add the fixes line, re-apply the payment), then press Sync on the job's Money card.", tab: "quotes", urgency: "today" },
  // Jo 28 Oct: owner-pays repeat PIESA line could not be added to the ONE Xero invoice.
  xero_invoice_repeat_piesa_held: { why: "The owner accepted a repeat safety check (PIESA) but its price is not on the Xero invoice yet.", next: "Office needs to: add the repeat safety check line to the SAME Xero invoice (if Xero refuses because a payment is on it, remove the payment, add the line, re-apply the payment), then press Sync on the job's Money card.", tab: "quotes", urgency: "today" },
  xero_invoice_product_unconfirmed: { why: "Xero invoice went out without the installed product/m² wording (ESC tax-invoice requirement).", next: "Office needs to: confirm the insulation product and measured area on the job, then add the brand, model, R-value and m² to the Xero invoice line.", tab: "quotes", urgency: "soon" },
  ready_check_chase_installer: { why: "Chase installer: the Ready Check is still missing answers or photos after 24 hours.", next: "Office needs to: call the installer and ask them to finish the Mitti form.", tab: "overview", urgency: "today" },
  installer_usual_electrician_missing: { why: "Installer has no usual electrician saved", next: "Office needs to: ask the installer to add their usual electrician in My business, then sync the Ready Check again.", tab: "quotes", urgency: "today" },
  rec_coverage_exhausted: { why: "No approved electrician coverage: nobody accepted the PIESA, or none cover this area.", next: "Find an approved REC for this area (or approve one in Coverage), then offer the job from the PIESA tab.", tab: "piesa", urgency: "today" },
  piesa_booking_overdue: { why: "48 hours since contact details were shared and no PIESA time has been confirmed.", next: "Call the owner and electrician, confirm a time on the PIESA tab, or release the electrician and re-offer.", tab: "piesa", urgency: "today" },
  delivery_failed: { why: "A message needed to move this job forward failed to deliver.", next: "Check the address/number on the Communications tab and send it again, or contact the person directly.", tab: "communications", urgency: "today" },
  rectification_declined: { why: "The owner declined required electrical fixes, so installation cannot proceed.", next: "Talk to the owner about options; put the job on hold or cancel it with a reason.", tab: "quotes", urgency: "soon" },
  rectification_pricing_review: { why: "Electrical fixes pricing needs office review before the quote can go to the owner.", next: "Price each item on the Quotes tab, mark the electrical fixes quote reviewed, then send it.", tab: "quotes", urgency: "today" },
  installer_unavailable: { why: "The agreed installer declined or cannot proceed. No replacement is made automatically.", next: "Agree a replacement with the owner and issue an updated quote for approval if the company or terms change.", tab: "overview", urgency: "today" },
  ready_check_booking_overdue: { why: "48 hours since Ready Check contact details were shared and no Ready Check time has been confirmed.", next: "Call the owner and installer and confirm a time on the Overview tab.", tab: "overview", urgency: "today" },
  installation_booking_overdue: { why: "48 hours since installation contact details were shared and no installation time has been confirmed.", next: "Call the owner and installer and confirm a time on the Overview tab.", tab: "overview", urgency: "today" },
  piesa_timing_invalid: { why: "Installation may not commence within 30 days of the PIESA timing date.", next: "Check the PIESA tab; bring installation forward or arrange a new PIESA.", tab: "piesa", urgency: "urgent" },
  esc_or_distribution_timing: { why: "Installation is close but the PIESA copy or ESC pre-install notice is not done in time.", next: "Send the PIESA copy / ESC notice from the Compliance tab, or move the installation date.", tab: "compliance", urgency: "urgent" },
  compliance_correction: { why: "A compliance record needs correcting before the job can continue.", next: "Open the Evidence tab and fix or request the missing/incorrect item.", tab: "evidence", urgency: "soon" },
  rectification_quote_unanswered: { why: "Electrical fixes quote unanswered — 30-day clock at risk. The owner has not responded 5 days after it was sent.", next: "Call the owner about the electrical fixes quote on the Quotes tab.", tab: "quotes", urgency: "today" },
  registry_query: { why: "The ESC/VEEC Registry raised a query or rejected the lodgement.", next: "Answer the query or correct and resubmit on the VEEC tab.", tab: "veec", urgency: "soon" },
  office_overdue: { why: "A task owned by Home Insulation Victoria is overdue.", next: "Open the job and complete the overdue office step.", tab: "overview", urgency: "soon" },
  esc_submit_due: { why: "ESC pre-install notification window is open.", next: "Submit the notification in the Registry using the details on the Installation section, then tap Submitted with the date and reference.", tab: "compliance", urgency: "today" },
  esc_submit_urgent: { why: "ESC notification not submitted and the install is 2 days away or less.", next: "Submit it in the Registry now, then tap Submitted with the date and reference.", tab: "compliance", urgency: "urgent" },
  esc_update_registry: { why: "Install date moved after the ESC notification was submitted. Update notification in Registry.", next: "Update the notification in the Registry, then record the update with the date and reference.", tab: "compliance", urgency: "urgent" },
  esc_withdraw_resubmit: { why: "Install date moved beyond the notification's 5-day window. Withdraw and resubmit.", next: "Withdraw the old notification in the Registry, submit a new one, then record it.", tab: "compliance", urgency: "urgent" },
  prestart_failed: { why: "Pre-start check failed. Installation form and evidence are locked.", next: "Fix each reason listed; the check re-runs automatically within 15 minutes.", tab: "compliance", urgency: "urgent" },
  white_card_not_verified: { why: "The lead installer's White Card is not verified (decision 319). Installs booked from 26 Oct 2026 are blocked until it is; earlier bookings go ahead.", next: "Open Partners › People, ask the installer to upload their White Card under My business › Team, then verify it.", tab: "overview", urgency: "today" },
  cert_rerecord_needed: { why: "Lead installer certification has no Full/Provisional level or expiry. Re-record certification as Full with expiry date.", next: "Open Partners, find the installer's certification check and record the level and expiry.", tab: "overview", urgency: "today" },
  install_ten_days_left: { why: "10 days or fewer left in the 30-day installation window and no installation is booked.", next: "Call the owner and the quoted installer and book a day on the Installation section before the window closes.", tab: "compliance", urgency: "urgent" },
  install_days_declined: { why: "The quoted installer could not do any of the owner's install days. The installer is never replaced automatically.", next: "Call the owner and installer to agree a day, or agree a replacement installer with the owner.", tab: "compliance", urgency: "today" },
  veec_assignment_unsigned: { why: "10 days since the install and the owner has not signed the VEEC assignment form (decision 120). The job cannot reach Ready for VEEC without it.", next: "Call the owner and ask them to sign from their My job link; check the installer and AP parts are signed first.", tab: "compliance", urgency: "urgent" },
  owner_no_show_repeat: { why: "The owner missed this visit a second time (late change or not home). The one free rebook is used.", next: "Call the owner, agree a time, then book it from the job's scheduling section.", tab: "overview", urgency: "today" },
  trade_no_show: { why: "The trade did not arrive: no \"I've arrived\" and no evidence 4 hours after the visit start. Counted against their reliability.", next: "Call the trade and the owner. If the trade was onsite, clear the no-show with a reason; otherwise rebook or reassign.", tab: "overview", urgency: "urgent" },
  owner_cancelled_visit: { why: "The owner cancelled a booked visit more than 24 hours ahead.", next: "Contact the owner to confirm whether they want to continue, then rebook or put the job on hold.", tab: "overview", urgency: "today" },
  rectification_new_times: { why: "A booked electrical fixes visit was cancelled. The electrician supplies electrical fixes times, so the office arranges new ones.", next: "Ask the electrician for new times and agree one with the owner.", tab: "overview", urgency: "today" },
  choose_trades: { why: "This job is ready for an offer. “How job offers go out” is set to Office picks first, so nothing has gone out yet.", next: "Open the job and use “Choose trades for this job” to tick who gets the offer.", tab: "overview", urgency: "today" },
  offer_no_taker_24h: { why: "This job has been offered for the set time (24 hours by default) and nobody has taken one of the owner's times. Trades who still hold the offer can now suggest another time.", next: "Open the job and use “Choose trades for this job” to add more trades (those already offered keep theirs), or watch for suggested times.", tab: "overview", urgency: "today" },
  ready_check_offer_returned: { why: "The installer you chose for this Ready Check didn't take it (Not for me, or no times within 24 hours). Nothing else was offered.", next: "Open the job and use “Choose installer” to send the offer to another installer.", tab: "overview", urgency: "today" },
  ready_check_no_taker: { why: "No installer could take the owner's Ready Check times, even after the owner gave more times.", next: "Call the owner to agree a time, then assign an approved installer from the People section.", tab: "overview", urgency: "today" },
  rec_no_longer_approved: { why: "The assigned electrician is no longer an approved, active REC, so the electrical work cannot continue with them.", next: "Release the electrician on the PIESA tab and re-offer the work to another approved REC (the owner keeps the approved quote).", tab: "piesa", urgency: "today" },
};

/** Office job page section each Needs tab opens (deep link ?section=). */
export const NEEDS_TAB_SECTION: Record<string, "people" | "quote" | "piesa" | "installation" | "ap_veec" | "history"> = {
  overview: "people", piesa: "piesa", quotes: "quote", communications: "history", compliance: "installation", evidence: "ap_veec", veec: "ap_veec",
};
// Moved to job-section.core (dependency-free) so the office job route's validateSearch does not pull this module into every page; same values.
export { JOB_SECTIONS, parseJobSection } from "./job-section.core";

/** Trade-facing electrical status wording (source-of-truth labels). Presentation only. */
export function electricalStatusLabel(i: { offerPending?: boolean; stage: string; hasBooking?: boolean; proposalPending?: boolean }): string {
  if (i.offerPending) return "Offered";
  switch (i.stage) {
    case "piesa_and_install_window_pending": return i.proposalPending ? "Awaiting owner confirmation" : "Accepted · Arrange visit";
    case "piesa_scheduled": return "Booked";
    case "piesa_complete": return "PIESA complete";
    case "electrical_variation_pending": case "rectification_required": case "awaiting_owner_rectification_approval": return "Electrical fixes required";
    case "rectification_scheduling": return i.proposalPending ? "Awaiting owner confirmation" : "Electrical fixes required · Arrange visit";
    case "rectification_booked": return "Booked";
    case "installation_scheduling": case "installation_booked": case "evidence_outstanding": return "Electrically cleared";
    default: return "Accepted";
  }
}

export function needsItem(code: NeedsCode, jobId: string | null, jobNumber: string | null, since: string | null, detail?: string, job?: { stage?: string | null; suburb?: string | null }): NeedsItem {
  const t = NEEDS_TEXT[code];
  return { key: `${code}:${jobId ?? "-"}`, code, jobId, jobNumber, why: detail ? `${t.why} ${detail}` : t.why, next: t.next, tab: t.tab, since, urgency: t.urgency, stage: job?.stage ?? null, suburb: job?.suburb ?? null };
}

export type NeedsInput = {
  now: Date;
  jobs: { id: string; job_number: string | null; stage?: string | null; suburb?: string | null }[];
  recNoLongerApproved?: { job_id: string; since: string | null }[];
  coverageExhausted: { job_id: string; created_at: string; detail?: string | undefined }[]; // latest exhaustion with no active electrician since
  releases: { job_id: string; visit_kind: VisitKind; released_at: string; confirmed_at: string | null }[];
  failedComms: { job_id: string; created_at: string }[];
  rectDeclined: { job_id: string; created_at: string | null }[];
  rectPricing: { job_id: string; created_at: string | null }[];
  installerUnavailable: { job_id: string; at: string; reason: string | null }[];
  piesaTiming: { job_id: string; urgency: string | null; piesa_expired: boolean | null; days_remaining: number | null }[];
  escTiming: { job_id: string; created_at: string | null }[];
  evidenceRejected: { job_id: string; created_at: string | null }[];
  registryQueries: { job_id: string; status: string; updated_at: string | null; query_received_at?: string | null; reply_sent_at?: string | null }[];
  officeOverdue: { job_id: string | null; title: string; since: string | null }[];
  rectUnanswered?: { job_id: string; sent_at: string | null }[];
  prestart?: { esc: { job_id: string; code: string; detail: string }[]; failed: { job_id: string; since: string; detail: string }[]; certs: { job_id: string; detail: string }[]; whiteCards?: { job_id: string; detail: string }[] } | undefined;
  readyCheckNoTaker?: { job_id: string; created_at: string }[];
  readyCheckReturned?: { job_id: string; created_at: string; detail?: string | undefined }[];
  offerNoTaker?: { job_id: string; kind: string; since: string }[];
  chooseTrades?: { job_id: string; kind: string; since: string | null }[];
  visitFlags?: { job_id: string; code: "owner_no_show_repeat" | "trade_no_show" | "owner_cancelled_visit" | "rectification_new_times"; created_at: string; detail?: string | undefined }[];
  installFlags?: { job_id: string; code: "install_ten_days_left" | "install_days_declined"; created_at: string; detail?: string | undefined }[];
  /** Decision 120 day-10 alerts for jobs whose owner has still not signed the VEEC assignment form. */
  veecUnsigned?: { job_id: string; created_at: string }[];
};

/** ONE office exception queue: only what automation cannot safely resolve, never routine waiting. */
export function buildNeedsHivic(i: NeedsInput): NeedsItem[] {
  const jobs = new Map(i.jobs.map((j) => [j.id, j]));
  const out = new Map<string, NeedsItem>();
  const add = (code: NeedsCode, jobId: string | null, since: string | null, detail?: string) => {
    if (jobId && !jobs.has(jobId)) return;
    const j = jobId ? jobs.get(jobId) : undefined;
    const it = needsItem(code, jobId, j?.job_number ?? null, since, detail, j);
    if (!out.has(it.key)) out.set(it.key, it);
  };
  for (const e of i.coverageExhausted) add("rec_coverage_exhausted", e.job_id, e.created_at, e.detail);
  for (const r of i.recNoLongerApproved ?? []) add("rec_no_longer_approved", r.job_id, r.since);
  for (const r of i.releases) {
    const s = coordinationState({ releasedAt: r.released_at, firstProposalAt: null, confirmedAt: r.confirmed_at }, i.now);
    if (s.state !== "needs_office") continue;
    if (r.visit_kind === "ready_check") add("ready_check_booking_overdue", r.job_id, r.released_at);
    else if (r.visit_kind === "installation") add("installation_booking_overdue", r.job_id, r.released_at);
    else add("piesa_booking_overdue", r.job_id, r.released_at, r.visit_kind === "rectification" ? "(Electrical fixes visit.)" : undefined);
  }
  for (const c of i.failedComms) add("delivery_failed", c.job_id, c.created_at);
  for (const q of i.rectDeclined) add("rectification_declined", q.job_id, q.created_at);
  for (const q of i.rectPricing) add("rectification_pricing_review", q.job_id, q.created_at);
  for (const u of i.installerUnavailable) add("installer_unavailable", u.job_id, u.at, u.reason ? `Reason: ${u.reason}` : undefined);
  for (const p of i.piesaTiming) if (p.piesa_expired || p.urgency === "red") add("piesa_timing_invalid", p.job_id, null, p.days_remaining != null ? `${p.days_remaining} day(s) left.` : undefined);
  const escTask = new Set((i.prestart?.esc ?? []).map((e) => e.job_id));
  for (const e of i.prestart?.esc ?? []) add(e.code as NeedsCode, e.job_id, null, e.detail);
  for (const f of i.prestart?.failed ?? []) add("prestart_failed", f.job_id, f.since, f.detail);
  for (const c of i.prestart?.certs ?? []) add("cert_rerecord_needed", c.job_id, null, c.detail);
  for (const c of i.prestart?.whiteCards ?? []) add("white_card_not_verified", c.job_id, null, c.detail);
  for (const e of i.escTiming) if (!escTask.has(e.job_id)) add("esc_or_distribution_timing", e.job_id, e.created_at);
  for (const e of i.evidenceRejected) add("compliance_correction", e.job_id, e.created_at);
  for (const r of i.registryQueries) {
    const overdue = r.status === "query" && veecQueryOverdue(r.query_received_at, r.reply_sent_at, new Date());
    add("registry_query", r.job_id, r.updated_at, `Status: ${r.status}.${overdue ? " Unanswered 3+ days." : ""}`);
  }
  for (const o of i.officeOverdue) add("office_overdue", o.job_id, o.since, o.title);
  for (const q of i.rectUnanswered ?? []) if (rectQuoteUnanswered({ kind: "rectification", status: "issued", sent_at: q.sent_at }, i.now)) add("rectification_quote_unanswered", q.job_id, q.sent_at);
  for (const r of i.readyCheckNoTaker ?? []) { const j = jobs.get(r.job_id); if (j?.stage === "ready_check_ready_to_schedule") add("ready_check_no_taker", r.job_id, r.created_at); }
  for (const r of i.readyCheckReturned ?? []) add("ready_check_offer_returned", r.job_id, r.created_at, r.detail);
  for (const r of i.chooseTrades ?? []) add("choose_trades", r.job_id, r.since, r.kind === "piesa" ? "(Electrician Pre Insulation Electrical Safety Assessment (PIESA).)" : "(Installer Ready Check: choose one installer.)");
  for (const r of i.offerNoTaker ?? []) add("offer_no_taker_24h", r.job_id, r.since, r.kind === "piesa" ? "(Electrician Pre Insulation Electrical Safety Assessment (PIESA) offer.)" : "(Installer Ready Check offer.)");
  for (const f of i.visitFlags ?? []) add(f.code, f.job_id, f.created_at, f.detail);
  for (const f of i.installFlags ?? []) { const j = jobs.get(f.job_id); if (j?.stage === "installation_scheduling") add(f.code, f.job_id, f.created_at, f.detail); }
  for (const f of i.veecUnsigned ?? []) { const j = jobs.get(f.job_id); if (j && ["evidence_outstanding", "ap_review"].includes(j.stage ?? "")) add("veec_assignment_unsigned", f.job_id, f.created_at); }
  const rank: Record<NeedsUrgency, number> = { urgent: 0, today: 1, soon: 2 };
  return [...out.values()].sort((a, b) => rank[a.urgency] - rank[b.urgency] || (a.since ?? "").localeCompare(b.since ?? ""));
}

/** Mirrors SQL visit_is_current(): a release is usable only while its visit is the job's current visit. */
const LEGACY = ["awaiting_electrician","assessment_booking","assessment_booked","assessment_complete","ready_for_installer_quotes","awaiting_quote_acceptance","awaiting_deposit_payment"];
const VISIT_STAGES: Record<VisitKind, string[]> = {
  ready_check: ["ready_check_awaiting_acceptance","ready_check_awaiting_payment","ready_check_ready_to_schedule","ready_check_scheduled","ready_check_complete","measured_estimate_ready","measured_quote_accepted"],
  piesa: ["piesa_and_install_window_pending","piesa_scheduled","piesa_complete","electrical_variation_pending","rectification_required","awaiting_owner_rectification_approval","rectification_scheduling","rectification_booked"],
  rectification: ["rectification_scheduling","rectification_booked"],
  installation: ["installation_scheduling","installation_booked","evidence_outstanding"],
};
export function visitIsCurrent(visit: string, stage: string): boolean {
  return LEGACY.includes(stage) || (VISIT_STAGES[visit as VisitKind]?.includes(stage) ?? false);
}
