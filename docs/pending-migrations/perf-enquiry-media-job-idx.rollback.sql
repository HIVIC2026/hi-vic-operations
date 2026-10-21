-- STAGED ROLLBACK ONLY — DO NOT APPLY.
-- Run only after the apply record proves these exact indexes were newly created
-- by perf-enquiry-media-job-idx.sql and absent in the pre-apply catalog.
-- Never drop a pre-existing index skipped by CREATE INDEX IF NOT EXISTS.
-- If only one index was newly created, execute only its corresponding DROP.
DROP INDEX IF EXISTS public.documents_job_id_kind_idx;
DROP INDEX IF EXISTS public.evidence_files_job_id_idx;