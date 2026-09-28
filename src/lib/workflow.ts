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
