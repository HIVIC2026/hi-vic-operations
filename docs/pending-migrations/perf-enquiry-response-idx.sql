-- P0 enquiry-response dashboard: bounded, index-backed reads.
-- Safe to run more than once (IF NOT EXISTS). No data is changed; no table is locked beyond the brief
-- CREATE INDEX (use CONCURRENTLY if running against live traffic outside a maintenance window).
--
-- 1) The dashboard's open-enquiry pool and the dispatch scope (oldest first, hard-limited).
CREATE INDEX IF NOT EXISTS jobs_open_enquiry_created_idx
  ON public.jobs (created_at)
  WHERE deleted_at IS NULL
    AND source = 'base44'
    AND channel = 'hivic_sourced'
    AND eligibility_outcome = 'likely_eligible'
    AND eligibility_review_required = false
    AND stage IN (
      'new_enquiry',
      'eligibility_review',
      'preliminary_estimate_ready',
      'ready_check_ready_to_schedule'
    );

-- 2) Per-home send history: "already sent / in flight / failed" is looked up by job on every read and send.
CREATE INDEX IF NOT EXISTS customer_email_sends_job_purpose_status_idx
  ON public.customer_email_sends (job_id, purpose, status);

-- 3) Suppression lists (opt-out) are checked per home.
CREATE INDEX IF NOT EXISTS customer_email_optouts_job_opted_idx
  ON public.customer_email_optouts (job_id, opted_out_at);

-- 4) "Has a current preliminary estimate" and "has an active estimate link" are per-home checks.
CREATE INDEX IF NOT EXISTS indicative_estimates_job_status_idx
  ON public.indicative_estimates (job_id, status);

CREATE INDEX IF NOT EXISTS customer_estimate_links_job_purpose_status_idx
  ON public.customer_estimate_links (job_id, purpose, status);
