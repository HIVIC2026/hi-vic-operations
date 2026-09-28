// Client-safe workflow vocabulary. Rules/guards live in workflow.server.ts.
import type { Database } from "@/integrations/supabase/types";

export type Stage = Database["public"]["Enums"]["job_stage"];
export type EligibilityOutcome = Database["public"]["Enums"]["eligibility_outcome"];
export type JobRole = "admin" | "electrician" | "installer" | "property_manager" | "owner";

export const STAGE_ORDER: Stage[] = [
  "new_enquiry",
  "eligibility_review",
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

export const STAGE_LABEL: Record<Stage, string> = {
  new_enquiry: "New Enquiry",
  eligibility_review: "Eligibility Review",
  awaiting_electrician: "Awaiting Electrician",
  assessment_booking: "Assessment Booking",
  assessment_booked: "Assessment Booked",
  assessment_complete: "Assessment Complete",
  rectification_required: "Rectification Required",
  awaiting_owner_rectification_approval: "Awaiting Owner Rectification Approval",
  awaiting_deposit_payment: "Awaiting Deposit Payment",
  rectification_scheduling: "Rectification Scheduling",
  rectification_booked: "Rectification Booked",
  ready_for_installer_quotes: "Ready for Installer Quotes",
  awaiting_quote_acceptance: "Awaiting Quote Acceptance",
  installation_scheduling: "Installation Scheduling",
  installation_booked: "Installation Booked",
  evidence_outstanding: "Evidence Outstanding",
  ap_review: "AP Review",
  ready_for_veec: "Ready for VEEC",
  complete: "Complete",
  cancelled: "Cancelled",
  on_hold: "On Hold",
};

export const DEFAULT_NEXT_ACTION: Record<Stage, string> = {
  new_enquiry: "Review eligibility",
  eligibility_review: "Confirm eligibility outcome",
  awaiting_electrician: "Assign electrician",
  assessment_booking: "Electrician & owner to book measure-up",
  assessment_booked: "Electrician to attend and complete assessment",
  assessment_complete: "Review assessment outcome",
  rectification_required: "Issue rectification quote",
  awaiting_owner_rectification_approval: "Owner to approve rectification quote",
  awaiting_deposit_payment: "Owner to pay 50% deposit (Xero invoice)",
  rectification_scheduling: "Owner & electrician to book rectification",
  rectification_booked: "Electrician to complete rectification & PIESA",
  ready_for_installer_quotes: "Generate installer quotes",
  awaiting_quote_acceptance: "Owner to accept an installation quote",
  installation_scheduling: "Owner & installer to book installation",
  installation_booked: "Installer to complete installation",
  evidence_outstanding: "Installer to upload required evidence",
  ap_review: "HI VIC compliance review",
  ready_for_veec: "Lodge VEEC",
  complete: "No action",
  cancelled: "No action",
  on_hold: "Resolve hold",
};

export const ELIGIBILITY_LABEL: Record<EligibilityOutcome, string> = {
  likely_eligible: "Likely Eligible",
  needs_onsite_confirmation: "Needs Onsite Confirmation",
  does_not_appear_eligible: "Does Not Appear Eligible",
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
  if (p?.piesa_expired) return `Blocked: PIESA 30-day window expired on ${p.install_deadline}. Electrician must record a reassessment first.`;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(startIso));
  if (p?.install_deadline && day > p.install_deadline) return `Installation must be before the PIESA deadline (${p.install_deadline}).`;
  return null;
}

// ---------- Visible pipeline phases (board lanes). Detailed stages stay the source of truth. ----------
export type Phase = "enquiries" | "site_assessment" | "quote_approval" | "deposit" | "rectification" | "installation" | "evidence_ap_veec" | "complete" | "exceptions";
export const PIPELINE_PHASES: { key: Phase; label: string; stages: Stage[] }[] = [
  { key: "enquiries", label: "Enquiries", stages: ["new_enquiry", "eligibility_review"] },
  { key: "site_assessment", label: "Site assessment", stages: ["awaiting_electrician", "assessment_booking", "assessment_booked"] },
  { key: "quote_approval", label: "Quote & approval", stages: ["assessment_complete", "rectification_required", "awaiting_owner_rectification_approval", "ready_for_installer_quotes", "awaiting_quote_acceptance"] },
  { key: "deposit", label: "Deposit", stages: ["awaiting_deposit_payment"] },
  { key: "rectification", label: "Rectification", stages: ["rectification_scheduling", "rectification_booked"] },
  { key: "installation", label: "Installation", stages: ["installation_scheduling", "installation_booked"] },
  { key: "evidence_ap_veec", label: "Evidence / AP / VEEC", stages: ["evidence_outstanding", "ap_review", "ready_for_veec"] },
  { key: "complete", label: "Complete", stages: ["complete"] },
];
export const EXCEPTION_PHASE = { key: "exceptions" as const, label: "On hold / Cancelled", stages: EXCEPTION_STAGES };
export function phaseForStage(stage: Stage | null | undefined): Phase {
  if (!stage) return "enquiries";
  return PIPELINE_PHASES.find((p) => p.stages.includes(stage))?.key ?? "exceptions";
}

export type WaitingOn = "HI VIC" | "Owner" | "Electrician" | "Installer" | "Payment / Xero" | "AP" | null;
const WAITING: Partial<Record<Stage, WaitingOn>> = {
  new_enquiry: "HI VIC", eligibility_review: "HI VIC", awaiting_electrician: "HI VIC",
  assessment_booking: "Electrician", assessment_booked: "Electrician", assessment_complete: "HI VIC",
  rectification_required: "HI VIC", awaiting_owner_rectification_approval: "Owner", ready_for_installer_quotes: "HI VIC",
  awaiting_quote_acceptance: "Owner", awaiting_deposit_payment: "Payment / Xero", rectification_scheduling: "Electrician",
  rectification_booked: "Electrician", installation_scheduling: "Installer", installation_booked: "Installer",
  evidence_outstanding: "Installer", ap_review: "AP", ready_for_veec: "AP", on_hold: "HI VIC",
};
/** Who/what the job waits on – derived from stage, refined by next_action text. */
export function waitingOn(stage: Stage | null | undefined, nextAction?: string | null): WaitingOn {
  if (!stage || stage === "complete" || stage === "cancelled") return null;
  const n = (nextAction ?? "").toLowerCase();
  if (/deposit|xero|payment/.test(n)) return "Payment / Xero";
  if (/\bowner\b|customer/.test(n) && stage !== "new_enquiry") return "Owner";
  if (/measure-up/.test(n) && /installer/.test(n)) return "Installer";
  return WAITING[stage] ?? null;
}
