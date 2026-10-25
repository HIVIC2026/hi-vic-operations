-- Perf 25 Oct 2026 ("Needs me is INCREDIBLY slow"): indexes for the reads traced in docs/PERF_2026-10-25.md.
-- Indexes only: no table, row, view, grant or function changes. Safe to run more than once (IF NOT EXISTS).
-- Proven on PGlite by tests/perf-2026-10-25-indexes-practice-db.test.ts (applies twice, each index is used by the
-- query it is for, rollback removes exactly these).
--
-- HOW TO APPLY (live): the tables are small (31 MB database), so a plain CREATE INDEX takes well under a second each.
-- This file can run as one transaction in the SQL editor. If you prefer zero write-locking, run each statement on its
-- own as CREATE INDEX CONCURRENTLY IF NOT EXISTS … (CONCURRENTLY cannot run inside a transaction block, so not as one
-- script / not inside BEGIN … COMMIT). Before: `select indexname from pg_indexes where indexname like '%perf1025%';`
-- should return nothing. After: run ANALYZE on the tables below.

-- 1) job_piesa_deadlines' lateral "latest official PIESA" (r.job_id = j.id and r.kind in ('initial','reassessment')
--    order by r.created_at desc limit 1) ran a seq scan of piesa_records PER JOB, so every read of the view (Needs me,
--    Jobs, job_overview, trade home) paid jobs × piesa_records. Also the owner/fixes confirmation lookups.
CREATE INDEX IF NOT EXISTS piesa_records_job_kind_created_perf1025_idx
  ON public.piesa_records (job_id, kind, created_at DESC);

-- 2) bulk_import_rows looked up by job_id (7.2k calls, mean 40 ms) — only batch_id was indexed.
CREATE INDEX IF NOT EXISTS bulk_import_rows_job_perf1025_idx
  ON public.bulk_import_rows (job_id);

-- 3) customer_email_sends had no job_id index in the applied migrations: office_enquiry_index runs SIX correlated
--    per-job subqueries on it (first response sent, photos requested, spot offered, uncertain, latest attempt status/at),
--    so each Enquiries read scanned the table ~6 × jobs times. Also "last heard" and Needs me first-contact reads.
CREATE INDEX IF NOT EXISTS customer_email_sends_job_created_perf1025_idx
  ON public.customer_email_sends (job_id, created_at DESC);

-- 4) Per-job event checks ("workflow_events where job_id = $1 and event_type = $2", 3.8 M calls) used the
--    (job_id, created_at) index and filtered every event of the job; this serves them directly.
CREATE INDEX IF NOT EXISTS workflow_events_job_type_created_perf1025_idx
  ON public.workflow_events (job_id, event_type, created_at DESC);

-- 5) property_facts by property (the estimate page's current coordinates: property_id + fact_key + is_current) had
--    no index (property_facts selects: 699 calls, mean 632 ms).
CREATE INDEX IF NOT EXISTS property_facts_property_key_current_perf1025_idx
  ON public.property_facts (property_id, fact_key) WHERE is_current;

-- 6) Needs me's "Mitti sync failed in the last 3 days" read (status = 'error' and created_at >= …) scanned the whole
--    sync log on every load.
CREATE INDEX IF NOT EXISTS external_sync_logs_errors_perf1025_idx
  ON public.external_sync_logs (created_at DESC) WHERE status = 'error';
