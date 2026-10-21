// Client-safe workflow vocabulary. Rules/guards live in workflow.server.ts.
import type { Database } from "@/integrations/supabase/types";
import { stageTag, stageNext, ELIGIBILITY_WORDS } from "./job-wording";

export type Stage = Database["public"]["Enums"]["job_stage"];
export type EligibilityOutcome = Database["public"]["Enums"]["eligibility_outcome"];
export type JobRole = "admin" | "electrician" | "installer" | "property_manager" | "owner";

export const STAGE_ORDER: Stage[] = [
  "new_enquiry",
  "eligibility_review",
  "preliminary_estimate_ready",
  "ready_check_awaiting_acceptance",
  "ready_check_awaiting_payment",
  "ready_check_ready_to_schedule",
  "ready_check_scheduled",
  "ready_check_complete",
  "measured_estimate_ready",
  "measured_quote_accepted",
  "piesa_and_install_window_pending",
  "piesa_scheduled",
  "piesa_complete",
  "electrical_variation_pending",
  "awaiting_electrician",
  "assessment_booking",
  "assessment_booked",
  "assessment_complete",
  "rectification_required",
  "awaiting_owner_rectification_approval",
  "awaiting_deposit_payment",
  "rectification_scheduling",
  "rectification_booked",
  "ready_for_installer_quotes",
  "awaiting_quote_acceptance",
  "installation_scheduling",
  "installation_booked",
  "evidence_outstanding",
  "ap_review",
  "ready_for_veec",
  "complete",
];
export const EXCEPTION_STAGES: Stage[] = ["on_hold", "cancelled"];

// Thin wrappers: all stage words come from job-wording.ts (Jo-approved list, 21 Oct).
const ALL_STAGES: Stage[] = [...STAGE_ORDER, ...EXCEPTION_STAGES];
export const STAGE_LABEL = Object.fromEntries(ALL_STAGES.map((s) => [s, stageTag(s)])) as Record<Stage, string>;
export const DEFAULT_NEXT_ACTION = Object.fromEntries(ALL_STAGES.map((s) => [s, stageNext(s)])) as Record<Stage, string>;

/** Stored on jobs.next_action by transitions and read by waitingOn(); NOT display text (screens use job-wording.ts). Kept byte-identical so waitingOn() behaviour is unchanged. */
export const STORED_NEXT_ACTION: Record<Stage, string> = {
  new_enquiry: "Review eligibility",
  eligibility_review: "Confirm eligibility outcome",
  preliminary_estimate_ready: "Owner to book Home Insulation Ready Check",
  ready_check_awaiting_acceptance: "Owner to accept the Ready Check",
  ready_check_awaiting_payment: "Move legacy Ready Check to free booking",
  ready_check_ready_to_schedule: "Assign EEC Certified Insulation Installer and arrange Ready Check",
  ready_check_scheduled: "Installer to complete Ready Check",
  ready_check_complete: "Measured estimate generates automatically",
  measured_estimate_ready: "Owner to accept measured project quote",
  measured_quote_accepted: "Reserve paired PIESA + installation window",
  piesa_and_install_window_pending: "Book PIESA 7–14 days before installation",
  piesa_scheduled: "Licensed electrician to complete PIESA",
  piesa_complete: "Reconcile PIESA scope against allowance",
  electrical_variation_pending: "Owner to approve electrical variation",
  awaiting_electrician: "Assign electrician",
  assessment_booking: "Electrician & owner to book PIESA",
  assessment_booked: "Electrician to attend and complete PIESA",
  assessment_complete: "Review assessment outcome",
  rectification_required: "Issue rectification quote",
  awaiting_owner_rectification_approval: "Owner to approve rectification quote",
  awaiting_deposit_payment: "Owner to complete approved payment option (Xero invoice)",
  rectification_scheduling: "Owner & electrician to book rectification",
  rectification_booked: "Electrician to complete rectification & PIESA",
  ready_for_installer_quotes: "Generate installer quotes",
  awaiting_quote_acceptance: "Owner to accept an installation quote",
  installation_scheduling: "Owner & installer to book installation",
  installation_booked: "Installer to complete installation",
  evidence_outstanding: "Installer to upload required evidence",
  ap_review: "Home Insulation Victoria compliance review",
  ready_for_veec: "Lodge VEEC",
  complete: "No action",
  cancelled: "No action",
  on_hold: "Resolve hold",
};

export const ELIGIBILITY_LABEL: Record<EligibilityOutcome, string> = {
  likely_eligible: ELIGIBILITY_WORDS.likely_eligible,
  needs_onsite_confirmation: ELIGIBILITY_WORDS.needs_onsite_confirmation,
  does_not_appear_eligible: ELIGIBILITY_WORDS.does_not_appear_eligible,
};

export const EVIDENCE_STATUS_LABEL: Record<string, string> = {
  outstanding: "Outstanding",
  uploaded: "Awaiting verification",
  verified: "Verified",
  rejected: "Rejected – re-upload",
  not_required: "Not required",
};

export const aud = (n: number | null | undefined) =>
  n == null ? "—" : new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(Number(n));

export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "—";
export const fmtDateTime = (d: string | null | undefined) =>
  d
    ? new Date(d).toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : "—";

export const PAYMENT_LABEL: Record<string, string> = {
  invoice_not_created: "Invoice not created",
  invoice_created: "Invoice created",
  deposit_due: "Deposit due",
  deposit_paid: "Deposit paid",
  balance_due: "Balance due",
  fully_paid: "Fully paid",
  overdue: "Payment overdue",
  xero_sync_error: "Xero sync error",
};

/** Central PIESA 30-day rule for installation dates (Melbourne-local calendar date). Returns blocker text or null. */
export function installationDateBlocker(p: { piesa_expired?: boolean | null; install_deadline?: string | null } | null | undefined, startIso: string): string | null {
  if (p?.piesa_expired) return `New PIESA needed. Blocked: PIESA 30-day window expired on ${p.install_deadline}. Electrician must record a reassessment first.`;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(startIso));
  if (p?.install_deadline && day > p.install_deadline) return `Installation must be before the PIESA deadline (${p.install_deadline}).`;
  return null;
}

// ---------- Visible pipeline phases (board lanes). Detailed stages stay the source of truth. ----------
export type Phase = "enquiries" | "ready_check" | "piesa_window" | "site_assessment" | "quote_approval" | "deposit" | "rectification" | "installation" | "evidence_ap_veec" | "complete" | "exceptions";
export const PIPELINE_PHASES: { key: Phase; label: string; stages: Stage[] }[] = [
  { key: "enquiries", label: "Enquiries", stages: ["new_enquiry", "eligibility_review", "preliminary_estimate_ready"] },
  { key: "ready_check", label: "Ready Check", stages: ["ready_check_awaiting_acceptance", "ready_check_awaiting_payment", "ready_check_ready_to_schedule", "ready_check_scheduled", "ready_check_complete", "measured_estimate_ready", "measured_quote_accepted"] },
  { key: "piesa_window", label: "PIESA and install dates", stages: ["piesa_and_install_window_pending", "piesa_scheduled", "piesa_complete", "electrical_variation_pending"] },
  { key: "site_assessment", label: "PIESA (earlier jobs)", stages: ["awaiting_electrician", "assessment_booking", "assessment_booked"] },
  { key: "quote_approval", label: "Quote", stages: ["assessment_complete", "rectification_required", "awaiting_owner_rectification_approval", "ready_for_installer_quotes", "awaiting_quote_acceptance"] },
  { key: "deposit", label: "Payment", stages: ["awaiting_deposit_payment"] },
  { key: "rectification", label: "Electrical fixes", stages: ["rectification_scheduling", "rectification_booked"] },
  { key: "installation", label: "Install", stages: ["installation_scheduling", "installation_booked"] },
  { key: "evidence_ap_veec", label: "Final check and VEECs", stages: ["evidence_outstanding", "ap_review", "ready_for_veec"] },
  { key: "complete", label: "Complete", stages: ["complete"] },
];
export const EXCEPTION_PHASE = { key: "exceptions" as const, label: "On hold or cancelled", stages: EXCEPTION_STAGES };
export function phaseForStage(stage: Stage | null | undefined): Phase {
  if (!stage) return "enquiries";
  return PIPELINE_PHASES.find((p) => p.stages.includes(stage))?.key ?? "exceptions";
}

export type WaitingOn = "Home Insulation Victoria" | "Owner" | "Electrician" | "Installer" | "Payment / Xero" | "AP" | null;
const WAITING: Partial<Record<Stage, WaitingOn>> = {
  new_enquiry: "Home Insulation Victoria", eligibility_review: "Home Insulation Victoria", awaiting_electrician: "Home Insulation Victoria",
  preliminary_estimate_ready: "Owner", ready_check_awaiting_acceptance: "Owner", ready_check_awaiting_payment: "Owner",
  ready_check_ready_to_schedule: "Home Insulation Victoria", ready_check_scheduled: "Installer", ready_check_complete: "Home Insulation Victoria",
  measured_estimate_ready: "Owner", measured_quote_accepted: "Home Insulation Victoria", piesa_and_install_window_pending: "Home Insulation Victoria",
  piesa_scheduled: "Electrician", piesa_complete: "Home Insulation Victoria", electrical_variation_pending: "Owner",
  assessment_booking: "Electrician", assessment_booked: "Electrician", assessment_complete: "Home Insulation Victoria",
  rectification_required: "Home Insulation Victoria", awaiting_owner_rectification_approval: "Owner", ready_for_installer_quotes: "Home Insulation Victoria",
  awaiting_quote_acceptance: "Owner", awaiting_deposit_payment: "Payment / Xero", rectification_scheduling: "Electrician",
  rectification_booked: "Electrician", installation_scheduling: "Installer", installation_booked: "Installer",
  evidence_outstanding: "Installer", ap_review: "AP", ready_for_veec: "AP", on_hold: "Home Insulation Victoria",
};
/** Retired legacy electrician-assessment stages: readable in history, never entered by current workflow. */
export const RETIRED_LEGACY_STAGES: readonly Stage[] = ["awaiting_electrician", "assessment_booking", "assessment_booked", "assessment_complete"];
export const isRetiredStage = (s: string | null | undefined) => (RETIRED_LEGACY_STAGES as readonly string[]).includes(s ?? "");
export function retiredStageBlocker(to: string): string | null {
  return isRetiredStage(to) ? `${STAGE_LABEL[to as Stage]} is retired. The free Ready Check comes first, then the PIESA is booked after quote acceptance.` : null;
}
/** Who/what the job waits on – derived from stage, refined by next_action text. */
/** Early-stage jobs that passed or need onsite confirmation go to the free installer Ready Check before any electrician. */
export const READY_CHECK_NEXT = "Arrange the Ready Check";
export function needsReadyCheckFirst(stage: string | null | undefined, outcome: string | null | undefined, reviewRequired?: boolean | null) {
  return !reviewRequired && ["likely_eligible", "needs_onsite_confirmation"].includes(outcome ?? "") && ["new_enquiry", "eligibility_review", "awaiting_electrician"].includes(stage ?? "");
}
export function waitingOn(stage: Stage | null | undefined, nextAction?: string | null): WaitingOn {
  if (!stage || stage === "complete" || stage === "cancelled") return null;
  const n = (nextAction ?? "").toLowerCase();
  if (nextAction === READY_CHECK_NEXT) return "Home Insulation Victoria";
  if (/deposit|xero|payment/.test(n)) return "Payment / Xero";
  if (/\bowner\b|customer/.test(n) && stage !== "new_enquiry") return "Owner";
  if (/measure-up/.test(n) && /installer/.test(n)) return "Installer";
  return WAITING[stage] ?? null;
}
