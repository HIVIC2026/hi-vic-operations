// Office Jobs board: jobs.stage is the ONLY status. Eligibility is a label/filter, never a column.
// Presentation-only mapping (Jo, 7 Oct). Never use this to decide workflow.
import type { Stage } from "./workflow";

export type BoardColumn = "spot" | "ready_check" | "quote" | "booked" | "installed" | "claimed" | "not_active";

export const BOARD_COLUMNS: { key: Exclude<BoardColumn, "not_active">; label: string }[] = [
  { key: "spot", label: "Spot saved / waiting for Ready Check" },
  { key: "ready_check", label: "Ready Check" },
  { key: "quote", label: "Quote out" },
  { key: "booked", label: "Booked" },
  { key: "installed", label: "Installed (checking)" },
  { key: "claimed", label: "Claimed and paid" },
];

/** Every stage in the code: plain name, board column, and whether Jo listed it (7 Oct). */
export const STAGE_BOARD: Record<Stage, { plain: string; column: BoardColumn; inJoList: boolean }> = {
  new_enquiry: { plain: "New enquiry – spot saved", column: "spot", inJoList: true },
  ready_check_ready_to_schedule: { plain: "Waiting for a Ready Check time", column: "spot", inJoList: true },
  ready_check_scheduled: { plain: "Ready Check booked", column: "ready_check", inJoList: true },
  ready_check_complete: { plain: "Ready Check done", column: "ready_check", inJoList: true },
  awaiting_quote_acceptance: { plain: "Quote sent – waiting for the owner", column: "quote", inJoList: true },
  awaiting_deposit_payment: { plain: "Quote accepted – waiting for payment", column: "quote", inJoList: true },
  piesa_and_install_window_pending: { plain: "Choosing safety check and install dates", column: "booked", inJoList: true },
  piesa_scheduled: { plain: "Safety check booked", column: "booked", inJoList: true },
  piesa_complete: { plain: "Safety check done", column: "booked", inJoList: true },
  installation_scheduling: { plain: "Choosing the install date", column: "booked", inJoList: true },
  installation_booked: { plain: "Install booked", column: "booked", inJoList: true },
  evidence_outstanding: { plain: "Installed – photos still needed", column: "installed", inJoList: true },
  rectification_required: { plain: "Electrical fix needed", column: "installed", inJoList: true },
  rectification_scheduling: { plain: "Booking the electrical fix", column: "installed", inJoList: true },
  ap_review: { plain: "Office checking the install", column: "installed", inJoList: true },
  ready_for_veec: { plain: "Ready to claim VEECs", column: "installed", inJoList: true },
  complete: { plain: "Claimed and paid", column: "claimed", inJoList: true },
  on_hold: { plain: "On hold", column: "not_active", inJoList: true },
  cancelled: { plain: "Cancelled", column: "not_active", inJoList: true },
  // Not in Jo's list — placed in the nearest column, flagged for her decision.
  eligibility_review: { plain: "Checking eligibility", column: "spot", inJoList: false },
  preliminary_estimate_ready: { plain: "Estimate ready – owner to save a spot", column: "spot", inJoList: false },
  ready_check_awaiting_acceptance: { plain: "Waiting for the owner to accept the Ready Check", column: "spot", inJoList: false },
  ready_check_awaiting_payment: { plain: "Old Ready Check payment record", column: "spot", inJoList: false },
  measured_estimate_ready: { plain: "Measured quote ready to send", column: "quote", inJoList: false },
  measured_quote_accepted: { plain: "Quote accepted – choosing dates", column: "booked", inJoList: false },
  electrical_variation_pending: { plain: "Extra electrical work – owner to approve", column: "booked", inJoList: false },
  awaiting_electrician: { plain: "Old: waiting for an electrician", column: "booked", inJoList: false },
  assessment_booking: { plain: "Old: booking the safety check", column: "booked", inJoList: false },
  assessment_booked: { plain: "Old: safety check booked", column: "booked", inJoList: false },
  assessment_complete: { plain: "Old: safety check done", column: "booked", inJoList: false },
  awaiting_owner_rectification_approval: { plain: "Electrical fix – owner to approve", column: "installed", inJoList: false },
  rectification_booked: { plain: "Electrical fix booked", column: "installed", inJoList: false },
  ready_for_installer_quotes: { plain: "Old: waiting for installer quotes", column: "quote", inJoList: false },
};

export const columnFor = (stage: string | null | undefined): BoardColumn =>
  (stage && STAGE_BOARD[stage as Stage]?.column) || "spot";
export const plainStage = (stage: string | null | undefined): string =>
  (stage && STAGE_BOARD[stage as Stage]?.plain) || "Unknown stage";

export type EligFilter = "likely" | "onsite" | "not";
export const ELIG_FILTERS: { key: EligFilter; label: string; outcome: string }[] = [
  { key: "likely", label: "Likely eligible", outcome: "likely_eligible" },
  { key: "onsite", label: "Needs onsite check", outcome: "needs_onsite_confirmation" },
  { key: "not", label: "Not eligible", outcome: "does_not_appear_eligible" },
];
export type SourceFilter = "hiv" | "upload";

export type BoardJob = { id: string; job_number: string; stage: string; eligibility_outcome: string | null; channel: string | null; source: string | null; owner_name: string | null; property_address: string | null; last_activity_at: string | null };

export function filterBoard(jobs: BoardJob[], f: { elig?: EligFilter | undefined; src?: SourceFilter | undefined; test?: boolean | undefined }): BoardJob[] {
  const outcome = f.elig ? ELIG_FILTERS.find((e) => e.key === f.elig)!.outcome : null;
  return jobs.filter((j) =>
    (f.test || j.source !== "qa_test") &&
    (!outcome || j.eligibility_outcome === outcome) &&
    (!f.src || (f.src === "upload" ? j.channel === "installer_sourced" : j.channel !== "installer_sourced")));
}

export function groupBoard(jobs: BoardJob[]): Record<BoardColumn, BoardJob[]> {
  const g = { spot: [], ready_check: [], quote: [], booked: [], installed: [], claimed: [], not_active: [] } as Record<BoardColumn, BoardJob[]>;
  for (const j of jobs) g[columnFor(j.stage)].push(j);
  return g;
}
