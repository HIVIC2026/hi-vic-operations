// The office rulebook: every live job sits in exactly ONE of six stages and ONE status, with who it is
// waiting on and a due time. Pure and presentation-only — it labels existing facts and NEVER moves a job.
// Limits are defaults Jo can change in workflow_settings.office_time_limits.

import { SITUATION } from "./job-wording";

export type OfficeStage = "waiting_list" | "enquiry" | "ready_check" | "quote" | "safety" | "install" | "signoff" | "ended";
export type WaitingOn = "Us" | "Owner" | "Installer" | "Electrician" | "Owner + Installer" | "Owner + Electrician" | "System" | "Nobody" | "Office / campaign";

export const OFFICE_STAGES: { key: Exclude<OfficeStage, "ended" | "waiting_list">; n: number; label: string }[] = [
  { key: "enquiry", n: 1, label: "Enquiry" },
  { key: "ready_check", n: 2, label: "Ready Check" },
  { key: "quote", n: 3, label: "Quote" },
  { key: "safety", n: 4, label: "PIESA" },
  { key: "install", n: 5, label: "Install" },
  { key: "signoff", n: 6, label: "Final check" },
];

/** Limit kinds: d = calendar days, h = hours, bh = business hours (Mon–Fri 8am–5pm Melbourne), none = no limit. */
type Limit = { d: number } | { h: number } | { bh: number } | null;
type Def = { stage: OfficeStage; label: string; waiting: WaitingOn; limit: Limit; limitKey?: string; action?: string };

export const OFFICE_STATUSES = {
  // Waiting list: leads never contacted. No time limit, never late, never in Needs me — Pipeline shows a count only.
  "waiting_list.ready_to_send": {stage: "waiting_list", label: SITUATION["waiting_list.ready_to_send"]!.tag, waiting: "Office / campaign", limit: null },
  "waiting_list.needs_estimate": {stage: "waiting_list", label: SITUATION["waiting_list.needs_estimate"]!.tag, waiting: "Office / campaign", limit: null },
  "enquiry.checking": {stage: "enquiry", label: SITUATION["enquiry.checking"]!.tag, waiting: "System", limit: { d: 1 }, limitKey: "checking_days" },
  "enquiry.estimate_sent": {stage: "enquiry", label: SITUATION["enquiry.estimate_sent"]!.tag, waiting: "Owner", limit: { d: 3 }, limitKey: "estimate_reminder_days", action: SITUATION["enquiry.estimate_sent"]!.next! },
  "enquiry.video_asked": {stage: "enquiry", label: SITUATION["enquiry.video_asked"]!.tag, waiting: "Owner", limit: { d: 3 }, limitKey: "video_reminder_days", action: SITUATION["enquiry.video_asked"]!.next! },
  "enquiry.video_in": {stage: "enquiry", label: SITUATION["enquiry.video_in"]!.tag, waiting: "Us", limit: { d: 1 }, limitKey: "video_check_days", action: SITUATION["enquiry.video_in"]!.next! },
  "enquiry.spot_saved": {stage: "enquiry", label: SITUATION["enquiry.spot_saved"]!.tag, waiting: "Us", limit: { d: 2 }, limitKey: "spot_saved_days", action: SITUATION["enquiry.spot_saved"]!.next! },
  "enquiry.spot_saved_video": {stage: "enquiry", label: SITUATION["enquiry.spot_saved_video"]!.tag, waiting: "Us", limit: { d: 2 }, limitKey: "spot_saved_days", action: SITUATION["enquiry.spot_saved_video"]!.next! },
  // Jo 22 Oct: while Ready Check booking is OFF, a saved spot waits on nobody — no office action.
  // Installers' own customers (A1): the installer arranges and does the Ready Check directly (decision 54); no estimate, no offer, no time limit.
  "ready_check.installer_own": {stage: "ready_check", label: SITUATION["ready_check.installer_own"]!.tag, waiting: "Installer", limit: null },
  "ready_check.pick_times": {stage: "ready_check", label: SITUATION["ready_check.pick_times"]!.tag, waiting: "Owner", limit: { d: 3 }, limitKey: "owner_times_days", action: SITUATION["ready_check.pick_times"]!.next! },
  "ready_check.offered": {stage: "ready_check", label: SITUATION["ready_check.offered"]!.tag, waiting: "Installer", limit: { bh: 4 }, limitKey: "offer_business_hours", action: SITUATION["ready_check.offered"]!.next! },
  "ready_check.booked": {stage: "ready_check", label: SITUATION["ready_check.booked"]!.tag, waiting: "Installer", limit: null },
  "ready_check.onsite_started": {stage: "ready_check", label: SITUATION["ready_check.onsite_started"]!.tag, waiting: "Installer", limit: { d: 1 }, limitKey: "evidence_sync_days" },
  "ready_check.arranging": {stage: "ready_check", label: SITUATION["ready_check.arranging"]!.tag, waiting: "Owner + Installer", limit: { h: 48 }, limitKey: "arranging_hours", action: SITUATION["ready_check.arranging"]!.next! },
  "ready_check.done": {stage: "ready_check", label: SITUATION["ready_check.done"]!.tag, waiting: "System", limit: { d: 1 }, limitKey: "evidence_sync_days" },
  "ready_check.evidence_in": {stage: "ready_check", label: SITUATION["ready_check.evidence_in"]!.tag, waiting: "Us", limit: { d: 1 }, limitKey: "confirm_eligible_days", action: SITUATION["ready_check.evidence_in"]!.next! },
  "quote.sent_auto": {stage: "quote", label: SITUATION["quote.sent_auto"]!.tag, waiting: "System", limit: { d: 1 }, limitKey: "auto_quote_days" },
  "quote.held": {stage: "quote", label: SITUATION["quote.held"]!.tag, waiting: "Us", limit: { d: 1 }, limitKey: "held_quote_days", action: SITUATION["quote.held"]!.next! },
  "quote.waiting_sign": {stage: "quote", label: SITUATION["quote.waiting_sign"]!.tag, waiting: "Owner", limit: { d: 14 }, limitKey: "quote_expiry_days", action: SITUATION["quote.waiting_sign"]!.next! },
  "quote.waiting_payment": {stage: "quote", label: SITUATION["quote.waiting_payment"]!.tag, waiting: "Owner", limit: { d: 7 }, limitKey: "payment_days", action: SITUATION["quote.waiting_payment"]!.next! },
  "quote.paid": {stage: "quote", label: SITUATION["quote.paid"]!.tag, waiting: "System", limit: { d: 1 }, limitKey: "unlock_days" },
  "safety.pick_times": {stage: "safety", label: SITUATION["safety.pick_times"]!.tag, waiting: "Owner", limit: { d: 3 }, limitKey: "owner_times_days", action: SITUATION["safety.pick_times"]!.next! },
  "safety.offered": {stage: "safety", label: SITUATION["safety.offered"]!.tag, waiting: "Electrician", limit: { bh: 4 }, limitKey: "offer_business_hours", action: SITUATION["safety.offered"]!.next! },
  "safety.booked": {stage: "safety", label: SITUATION["safety.booked"]!.tag, waiting: "Electrician", limit: null },
  "safety.arranging": {stage: "safety", label: SITUATION["safety.arranging"]!.tag, waiting: "Owner + Electrician", limit: { h: 48 }, limitKey: "arranging_hours", action: SITUATION["safety.arranging"]!.next! },
  "safety.passed": {stage: "safety", label: SITUATION["safety.passed"]!.tag, waiting: "System", limit: { d: 1 }, limitKey: "unlock_days" },
  "safety.fixes_needed": {stage: "safety", label: SITUATION["safety.fixes_needed"]!.tag, waiting: "System", limit: { d: 1 }, limitKey: "auto_quote_days" },
  "safety.fix_sent_auto": {stage: "safety", label: SITUATION["safety.fix_sent_auto"]!.tag, waiting: "System", limit: { d: 1 }, limitKey: "auto_quote_days" },
  "safety.fix_held": {stage: "safety", label: SITUATION["safety.fix_held"]!.tag, waiting: "Us", limit: { d: 1 }, limitKey: "held_quote_days", action: SITUATION["safety.fix_held"]!.next! },
  "safety.fix_approve": {stage: "safety", label: SITUATION["safety.fix_approve"]!.tag, waiting: "Owner", limit: { d: 5 }, limitKey: "fix_approve_days", action: SITUATION["safety.fix_approve"]!.next! },
  "safety.fixes_booked": {stage: "safety", label: SITUATION["safety.fixes_booked"]!.tag, waiting: "Electrician", limit: null },
  "safety.fixed": {stage: "safety", label: SITUATION["safety.fixed"]!.tag, waiting: "System", limit: { d: 1 }, limitKey: "unlock_days" },
  "install.agree": {stage: "install", label: SITUATION["install.agree"]!.tag, waiting: "Owner + Installer", limit: null, action: SITUATION["install.agree"]!.next! },
  "install.booked": {stage: "install", label: SITUATION["install.booked"]!.tag, waiting: "Installer", limit: null },
  "install.checking": {stage: "install", label: SITUATION["install.checking"]!.tag, waiting: "System", limit: { d: 1 }, limitKey: "evidence_sync_days" },
  "install.evidence_missing": {stage: "install", label: SITUATION["install.evidence_missing"]!.tag, waiting: "Installer", limit: { d: 2 }, limitKey: "evidence_missing_days", action: SITUATION["install.evidence_missing"]!.next! },
  "signoff.ap": {stage: "signoff", label: SITUATION["signoff.ap"]!.tag, waiting: "Us", limit: { d: 3 }, limitKey: "ap_signoff_days", action: SITUATION["signoff.ap"]!.next! },
  "signoff.veec_waiting": {stage: "signoff", label: SITUATION["signoff.veec_waiting"]!.tag, waiting: "System", limit: { d: 30 }, limitKey: "veec_registration_days" },
  "signoff.payouts_due": {stage: "signoff", label: SITUATION["signoff.payouts_due"]!.tag, waiting: "Us", limit: null, action: SITUATION["signoff.payouts_due"]!.next! },
  "ended.complete": {stage: "ended", label: SITUATION["ended.complete"]!.tag, waiting: "Nobody", limit: null },
  "ended.cancelled": {stage: "ended", label: SITUATION["ended.cancelled"]!.tag, waiting: "Nobody", limit: null },
  "ended.on_hold": {stage: "ended", label: SITUATION["ended.on_hold"]!.tag, waiting: "Nobody", limit: null, action: SITUATION["ended.on_hold"]!.next! },
} as const satisfies Record<string, Def>;

export type StatusKey = keyof typeof OFFICE_STATUSES;
export const STATUS_KEYS = Object.keys(OFFICE_STATUSES) as StatusKey[];

export const DEFAULT_LIMITS: Record<string, number> = {
  checking_days: 1, estimate_reminder_days: 3, video_reminder_days: 3, video_check_days: 1, spot_saved_days: 2,
  owner_times_days: 3, offer_business_hours: 4, arranging_hours: 48, evidence_sync_days: 1, confirm_eligible_days: 1,
  auto_quote_days: 1, held_quote_days: 1, quote_expiry_days: 14, payment_days: 7, unlock_days: 1, fix_approve_days: 5,
  evidence_missing_days: 2, ap_signoff_days: 3, veec_registration_days: 30,
  // Needs-me safety-net settings
  inactivity_days: 5, clock_warning_days: 5, credential_warning_days: 30, quiet_owner_close_days: 14,
};
export function limits(overrides: Record<string, unknown> | null | undefined): Record<string, number> {
  const out = { ...DEFAULT_LIMITS };
  for (const [k, v] of Object.entries(overrides ?? {})) if (k in out && typeof v === "number" && v > 0) out[k] = v;
  return out;
}

const DAY = 86_400_000, HOUR = 3_600_000;

/** Adds business hours (Mon–Fri, 8am–5pm Melbourne time) in 15-minute steps. */
export function addBusinessHours(startMs: number, hours: number): number {
  const fmt = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", hour: "numeric", hour12: false });
  let t = startMs, left = hours * 60;
  for (let guard = 0; left > 0 && guard < 5000; guard++) {
    const parts = fmt.formatToParts(new Date(t));
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hr = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
    if (!["Sat", "Sun"].includes(wd) && hr >= 8 && hr < 17) left -= 15;
    t += 15 * 60_000;
  }
  return t;
}

export type JobFacts = {
  id: string; stage: string; createdAt: string; lastActivityAt: string | null; enteredStageAt: string | null;
  holdRevisitAt?: string | null; cancelledReason?: string | null;
  /** jobs.channel = installer_sourced (an installer's own customer): never an estimate/waiting-list lead — the installer does the Ready Check directly. */
  ownJob?: boolean;
  campaign?: { spotSavedAt: string | null; optedOutAt: string | null; videoRequested: boolean; mediaReceivedAt: string | null; deskCheckStatus: string | null; createdAt: string; queuePriority?: string | null } | null;
  /** Estimate link created (NOT proof of sending). */
  estimateSentAt?: string | null;
  /** Earliest real send record to the owner (customer_email_sends / outbound job_communications with sent_at). Only this may make a status say "sent" or "waiting for owner". */
  ownerContactedAt?: string | null;
  // readyCheckBookingOpen + "enquiry.spot_saved_waiting" removed 24 Oct 2026 (decision 53, audit removal 5): a saved spot is always "Spot saved".
  rcWindowsOpen?: number; rcAccepted?: boolean; rcOfferAt?: string | null; rcBookingAt?: string | null; rcSubmittedAt?: string | null;
  /** Earliest current ceiling measurement row (any status) — proof the visit actually started. */
  measurementStartedAt?: string | null;
  proposalPending?: { kind: string; since: string } | null;
  quote?: { releaseState: string | null; holdReason: string | null; sentAt: string | null; status: string; acceptedAt: string | null } | null;
  rectQuote?: { releaseState: string | null; sentAt: string | null; status: string } | null;
  paymentCleared?: boolean;
  /** Cleared only by an admin $349 override (not money received). */
  paymentOverridden?: boolean;
  piesa?: { completedAt: string | null; passed: boolean; sectionCAt: string | null } | null;
  elecOfferAt?: string | null; elecBookingAt?: string | null; rectBookingAt?: string | null;
  installDeadline?: string | null; installBookingAt?: string | null; installedAt?: string | null; evidenceMissing?: number;
  apApprovedAt?: string | null; veecSubmittedAt?: string | null; payoutsOpen?: number; payoutDueAt?: string | null;
};

export type OfficeStatus = {
  key: StatusKey; stage: OfficeStage; label: string; waitingOn: WaitingOn; since: string; dueAt: string | null;
  late: boolean; detail: string | null; action: string | null;
};

const MAPPED_STAGES = new Set([
  "new_enquiry", "eligibility_review", "preliminary_estimate_ready", "ready_check_awaiting_acceptance", "ready_check_awaiting_payment",
  "ready_check_ready_to_schedule", "ready_check_scheduled", "ready_check_complete", "assessment_complete", "measured_estimate_ready",
  "ready_for_installer_quotes", "awaiting_quote_acceptance", "measured_quote_accepted", "awaiting_deposit_payment",
  "piesa_and_install_window_pending", "awaiting_electrician", "assessment_booking", "assessment_booked", "piesa_scheduled", "piesa_complete",
  "rectification_required", "electrical_variation_pending", "awaiting_owner_rectification_approval", "rectification_scheduling", "rectification_booked",
  "installation_scheduling", "installation_booked", "evidence_outstanding", "ap_review", "ready_for_veec", "complete", "cancelled", "on_hold",
]);
/** True when the portal stage has a rule here. Unknown stages are flagged by the daily "nothing lost" check. */
export const isMappedStage = (s: string) => MAPPED_STAGES.has(s);

/** Exactly one status for a job, or null if no rule matches (the "nothing lost" check flags that). */
export function officeStatus(f: JobFacts, now: number, lim: Record<string, number> = DEFAULT_LIMITS): OfficeStatus | null {
  const pick = (key: StatusKey, since: string | null | undefined, opts: { due?: string | null; detail?: string | null } = {}): OfficeStatus => {
    const d = OFFICE_STATUSES[key] as Def;
    const s = since ?? f.enteredStageAt ?? f.createdAt;
    let due: number | null = opts.due ? new Date(opts.due).getTime() : null;
    if (due == null && d.limit) {
      const n = d.limitKey ? lim[d.limitKey] ?? 0 : 0;
      const base = new Date(s).getTime();
      due = "d" in d.limit ? base + n * DAY : "h" in d.limit ? base + n * HOUR : addBusinessHours(base, n);
    }
    return { key, stage: d.stage, label: d.label, waitingOn: d.waiting, since: s, dueAt: due == null ? null : new Date(due).toISOString(), late: due != null && now > due, detail: opts.detail ?? null, action: d.action ?? null };
  };
  const c = f.campaign;
  // A saved spot outranks "estimate sent"/waiting-list at every pre-Ready-Check stage: it is waiting on us.
  const saved = (): OfficeStatus | null => {
    if (!c || c.optedOutAt) return null;
    if (c.mediaReceivedAt && !c.deskCheckStatus) return pick("enquiry.video_in", c.mediaReceivedAt);
    if (!c.spotSavedAt) return null;
    return pick(c.mediaReceivedAt || c.queuePriority === "video" ? "enquiry.spot_saved_video" : "enquiry.spot_saved", c.spotSavedAt);
  };
  switch (f.stage) {
    case "complete": return pick("ended.complete", f.lastActivityAt);
    case "cancelled": return pick("ended.cancelled", f.lastActivityAt, { detail: f.cancelledReason ?? null });
    case "on_hold": return pick("ended.on_hold", f.lastActivityAt, { due: f.holdRevisitAt ?? null, detail: f.holdRevisitAt ? `Revisit ${f.holdRevisitAt}` : null });
    case "new_enquiry": case "eligibility_review": return pick("enquiry.checking", f.enteredStageAt ?? f.createdAt);
    case "preliminary_estimate_ready": case "ready_check_awaiting_acceptance": case "ready_check_awaiting_payment": {
      // Estimate / waiting-list wording is only for website, email and phone enquiries before a spot is saved (decision 54).
      if (f.ownJob) return pick("ready_check.installer_own", f.enteredStageAt);
      const s = saved(); if (s) return s;
      if (!f.ownerContactedAt) return pick(f.estimateSentAt ? "waiting_list.ready_to_send" : "waiting_list.needs_estimate", f.enteredStageAt);
      return pick("enquiry.estimate_sent", f.ownerContactedAt);
    }
    case "ready_check_ready_to_schedule": {
      // An installer's own customer has no offer, owner times or estimate: the installer is doing the Ready Check.
      if (f.ownJob) return pick("ready_check.installer_own", f.enteredStageAt);
      if (f.proposalPending && f.proposalPending.kind === "ready_check") return pick("ready_check.arranging", f.proposalPending.since);
      if (f.rcOfferAt) return pick("ready_check.offered", f.rcOfferAt);
      if ((f.rcWindowsOpen ?? 0) > 0) return pick("enquiry.spot_saved", c?.spotSavedAt ?? f.enteredStageAt, { detail: "Owner picked times — offer it to installers" });
      { const s = saved(); if (s) return s; }
      if (c?.videoRequested && !c.mediaReceivedAt && !c.spotSavedAt) return pick("enquiry.video_asked", c.createdAt);
      // Rule: "sent" / "waiting for owner" only with a real send record. Otherwise the lead is on the waiting list.
      if (!f.ownerContactedAt) return pick(f.estimateSentAt ? "waiting_list.ready_to_send" : "waiting_list.needs_estimate", f.enteredStageAt);
      if (!f.rcAccepted) return pick("enquiry.estimate_sent", f.ownerContactedAt);
      return pick("ready_check.pick_times", f.enteredStageAt);
    }
    case "ready_check_scheduled": {
      // Later facts outrank the stored stage: a prepared quote means the job is at Quote.
      const q = f.quote;
      if (q?.releaseState === "held") return pick("quote.held", f.enteredStageAt, { detail: q.holdReason });
      if (q?.sentAt && q.status === "issued") return pick("quote.waiting_sign", q.sentAt);
      // The stage alone never proves a booking: without a real Ready Check booking, classify as not yet scheduled
      // (an installer's own customer then reads "Ready Check" — the installer arranges it directly, never "needs estimate").
      if (!f.rcBookingAt) return officeStatus({ ...f, stage: "ready_check_ready_to_schedule" }, now, lim);
      if (f.measurementStartedAt) return pick("ready_check.onsite_started", f.measurementStartedAt, { detail: `Booked ${f.rcBookingAt.slice(0, 10)}` });
      return pick("ready_check.booked", f.enteredStageAt, { due: f.rcBookingAt ? new Date(new Date(f.rcBookingAt).getTime() + DAY).toISOString() : null, detail: f.rcBookingAt ? `Booked ${f.rcBookingAt.slice(0, 10)}` : null });
    }
    case "ready_check_complete": return f.rcSubmittedAt ? pick("ready_check.evidence_in", f.rcSubmittedAt) : pick("ready_check.done", f.enteredStageAt);
    case "assessment_complete": case "measured_estimate_ready": case "ready_for_installer_quotes": case "awaiting_quote_acceptance": {
      const q = f.quote;
      if (q?.releaseState === "held") return pick("quote.held", f.enteredStageAt, { detail: q.holdReason });
      if (q?.sentAt && q.status === "issued") return pick("quote.waiting_sign", q.sentAt);
      return pick("quote.sent_auto", f.enteredStageAt);
    }
    case "measured_quote_accepted": case "awaiting_deposit_payment":
      return f.paymentCleared ? pick("quote.paid", f.enteredStageAt) : pick("quote.waiting_payment", f.quote?.acceptedAt ?? f.enteredStageAt);
    case "piesa_and_install_window_pending": case "awaiting_electrician": case "assessment_booking":
      if (f.proposalPending) return pick("safety.arranging", f.proposalPending.since);
      if (f.elecOfferAt) return pick("safety.offered", f.elecOfferAt);
      return pick("safety.pick_times", f.enteredStageAt);
    case "assessment_booked": case "piesa_scheduled": return pick("safety.booked", f.enteredStageAt, { due: f.elecBookingAt ? new Date(new Date(f.elecBookingAt).getTime() + DAY).toISOString() : null, detail: f.elecBookingAt ? `Booked ${f.elecBookingAt.slice(0, 10)}` : null });
    case "piesa_complete": {
      // Phase 3 path 2 (27 Oct): "piesa_complete" means the visit is done, not passed — a PIESA that found fixes never reads "PIESA passed".
      if (f.piesa && !f.piesa.passed && !f.piesa.sectionCAt) {
        const r = f.rectQuote;
        if (r?.releaseState === "held") return pick("safety.fix_held", f.enteredStageAt);
        if (r?.sentAt) return pick("safety.fix_approve", r.sentAt);
        return pick("safety.fixes_needed", f.piesa.completedAt ?? f.enteredStageAt);
      }
      return pick("safety.passed", f.piesa?.completedAt ?? f.enteredStageAt);
    }
    case "rectification_required": case "electrical_variation_pending": {
      const r = f.rectQuote;
      if (r?.releaseState === "held" || f.stage === "electrical_variation_pending") return pick("safety.fix_held", f.enteredStageAt);
      if (r?.sentAt) return pick("safety.fix_approve", r.sentAt);
      return pick("safety.fix_sent_auto", f.enteredStageAt);
    }
    case "awaiting_owner_rectification_approval": return pick("safety.fix_approve", f.rectQuote?.sentAt ?? f.enteredStageAt);
    case "rectification_scheduling": return f.proposalPending ? pick("safety.arranging", f.proposalPending.since) : pick("safety.pick_times", f.enteredStageAt);
    case "rectification_booked":
      if (f.piesa?.sectionCAt) return pick("safety.fixed", f.piesa.sectionCAt);
      return pick("safety.fixes_booked", f.enteredStageAt, { due: f.rectBookingAt ? new Date(new Date(f.rectBookingAt).getTime() + DAY).toISOString() : null, detail: f.rectBookingAt ? `Booked ${f.rectBookingAt.slice(0, 10)}` : null });
    case "installation_scheduling": return pick("install.agree", f.enteredStageAt, { due: f.installDeadline ?? null, detail: f.installDeadline ? `Must start by ${f.installDeadline.slice(0, 10)}` : null });
    case "installation_booked": return pick("install.booked", f.enteredStageAt, { due: f.installDeadline ?? null, detail: [f.installBookingAt && `Booked ${f.installBookingAt.slice(0, 10)}`, f.installDeadline && `must start by ${f.installDeadline.slice(0, 10)}`].filter(Boolean).join(", ") || null });
    case "evidence_outstanding": return (f.evidenceMissing ?? 0) > 0 && f.installedAt ? pick("install.evidence_missing", f.installedAt, { detail: `${f.evidenceMissing} item(s) missing` }) : pick("install.checking", f.installedAt ?? f.enteredStageAt);
    case "ap_review": return pick("signoff.ap", f.enteredStageAt);
    case "ready_for_veec":
      if ((f.payoutsOpen ?? 0) > 0) return pick("signoff.payouts_due", f.apApprovedAt ?? f.enteredStageAt, { due: f.payoutDueAt ?? null, detail: f.payoutDueAt ? `Due ${f.payoutDueAt.slice(0, 10)}` : null });
      return pick("signoff.veec_waiting", f.veecSubmittedAt ?? f.enteredStageAt);
    default: return null;
  }
}

/** Installer-supplied jobs enter at Quote (full measure-up) or "Evidence in, confirm eligible" (partial). */
export function installerEntryStatus(fullMeasureUp: boolean): StatusKey {
  return fullMeasureUp ? "quote.sent_auto" : "ready_check.evidence_in";
}

/** Plain time-left text, e.g. "2 days left" or "3 hours late". */
export function timeLeft(dueAt: string | null, now: number): string | null {
  if (!dueAt) return null;
  const ms = new Date(dueAt).getTime() - now;
  const abs = Math.abs(ms);
  const txt = abs >= DAY ? `${Math.round(abs / DAY)} day${Math.round(abs / DAY) === 1 ? "" : "s"}` : `${Math.max(1, Math.round(abs / HOUR))} hour${Math.round(abs / HOUR) === 1 ? "" : "s"}`;
  return ms >= 0 ? `${txt} left` : `${txt} late`;
}
