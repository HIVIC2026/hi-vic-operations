/**
 * Client-safe constants for the Active / Closed jobs list. The loader in job-list-page.server.ts
 * imports these too, so the sort menu, the URL whitelist and the generated SQL can never disagree.
 */

export type JobMode = "active" | "closed";
export type JobClosedView = "completed" | "cancelled" | "ineligible" | "test";
/** Closed tab chips: "all" (the approved O3 default) plus the four one-per-job piles. */
export type JobClosedFilter = JobClosedView | "all";

/** Exact complement of archived rows without putting every archived TEST UUID in one URL. */
export function jobArchiveFilter(rows: Array<{ id: string; source: string | null; qa_archived_at: string | null }>) {
  const visibleTestIds = rows.filter(row => row.source === "qa_test" && !row.qa_archived_at).map(row => row.id);
  return {
    visible: ["source.is.null", "source.neq.qa_test", ...(visibleTestIds.length ? [`id.in.(${visibleTestIds.join(",")})`] : [])].join(","),
    archivedOtherIds: rows.filter(row => row.source !== "qa_test" && row.qa_archived_at).map(row => row.id),
  };
}

export const CLOSED_VIEWS: JobClosedView[] = ["completed", "cancelled", "ineligible", "test"];
export const CLOSED_FILTERS: JobClosedFilter[] = ["all", ...CLOSED_VIEWS];
/** "All" = every closed job once: the four piles are mutually exclusive, so the total is their sum. */
export const closedAllCount = (t: Record<JobClosedView, number>) => t.completed + t.cancelled + t.ineligible + t.test;

/** Whitelisted search columns. The office searches exactly what it can see on the card. */
export const JOB_SEARCH_COLUMNS = [
  "job_number",
  "property_address",
  "owner_name",
  "owner_phone",
  "owner_email",
  "electrician_name",
  "installer_name",
  "originating_business_name",
] as const;

export const JOB_SORT_KEYS = [
  "last_activity_at",
  "created_at",
  "job_number",
  "property_address",
  "owner_name",
  "stage",
  "days_remaining",
] as const;
export type JobSortKey = (typeof JOB_SORT_KEYS)[number];
export const JOB_SORT_LABEL: Record<JobSortKey, string> = {
  last_activity_at: "Last activity",
  created_at: "Created",
  job_number: "Job number",
  property_address: "Property",
  owner_name: "Owner",
  stage: "Stage",
  days_remaining: "Days remaining",
};

/** The database job_stage enum, so a stage chip can never be filtered on a value that does not exist. */
export const JOB_STAGES = [
  "new_enquiry", "eligibility_review", "awaiting_electrician", "assessment_booking", "assessment_booked",
  "assessment_complete", "rectification_required", "awaiting_owner_rectification_approval", "awaiting_deposit_payment",
  "rectification_scheduling", "rectification_booked", "ready_for_installer_quotes", "awaiting_quote_acceptance",
  "installation_scheduling", "installation_booked", "evidence_outstanding", "ap_review", "ready_for_veec",
  "complete", "cancelled", "on_hold", "preliminary_estimate_ready", "ready_check_awaiting_acceptance",
  "ready_check_awaiting_payment", "ready_check_ready_to_schedule", "ready_check_scheduled", "ready_check_complete",
  "measured_estimate_ready", "measured_quote_accepted", "piesa_and_install_window_pending",
  "piesa_scheduled", "piesa_complete", "electrical_variation_pending",
] as const;
export type JobStage = (typeof JOB_STAGES)[number];

export type JobListParams = {
  mode: JobMode;
  closedView: JobClosedFilter;
  stage: string;
  search: string;
  sort: string;
  direction: "asc" | "desc";
  page: number;
  pageSize: number;
};

/** The one Closed pile for a job (mirrors the loader's scope). Deleted jobs belong only on the Deleted jobs page. */
export function closedPile(j: { source: string | null; office_removed: boolean | null; contact_rank: number | null; stage: string | null; deleted: boolean }): JobClosedView | "deleted" {
  if (j.deleted) return "deleted";
  if (j.source === "qa_test" || j.office_removed || (j.contact_rank ?? 1) > 1) return "test";
  if (j.stage === "complete") return "completed";
  if (j.stage === "cancelled") return "cancelled";
  return "ineligible";
}

/** Retired 21 Oct (Jo): hidden from filters, chips and labels; old job history still shows their names. */
export const RETIRED_STAGES: ReadonlySet<string> = new Set([
  "awaiting_electrician", "assessment_booking", "assessment_booked", "assessment_complete",
  "ready_for_installer_quotes", "awaiting_quote_acceptance", "ready_check_awaiting_payment", "awaiting_deposit_payment",
]);
export const VISIBLE_JOB_STAGES = JOB_STAGES.filter(s => !RETIRED_STAGES.has(s));
