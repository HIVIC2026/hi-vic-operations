-- Rollback for perf-2026-10-25-indexes.sql: drops exactly the indexes it added (nothing else). Idempotent.
DROP INDEX IF EXISTS public.piesa_records_job_kind_created_perf1025_idx;
DROP INDEX IF EXISTS public.bulk_import_rows_job_perf1025_idx;
DROP INDEX IF EXISTS public.customer_email_sends_job_created_perf1025_idx;
DROP INDEX IF EXISTS public.workflow_events_job_type_created_perf1025_idx;
DROP INDEX IF EXISTS public.property_facts_property_key_current_perf1025_idx;
DROP INDEX IF EXISTS public.external_sync_logs_errors_perf1025_idx;
