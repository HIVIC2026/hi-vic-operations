-- Undo for perf-enquiry-response-idx.sql. Drops only the indexes added there.
DROP INDEX IF EXISTS public.jobs_open_enquiry_created_idx;
DROP INDEX IF EXISTS public.customer_email_sends_job_purpose_status_idx;
DROP INDEX IF EXISTS public.customer_email_optouts_job_opted_idx;
DROP INDEX IF EXISTS public.indicative_estimates_job_status_idx;
DROP INDEX IF EXISTS public.customer_estimate_links_job_purpose_status_idx;
