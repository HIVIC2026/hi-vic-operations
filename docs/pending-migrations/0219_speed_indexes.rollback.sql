-- All three indexes were verified absent before 0219 was applied (21 Oct), so dropping them is safe.
DROP INDEX IF EXISTS public.documents_job_id_kind_idx;
DROP INDEX IF EXISTS public.evidence_files_job_id_idx;
DROP INDEX IF EXISTS public.workflow_events_lead_removed_idx;
