CREATE INDEX IF NOT EXISTS documents_job_id_kind_idx ON public.documents USING btree (job_id, kind);
CREATE INDEX IF NOT EXISTS evidence_files_job_id_idx ON public.evidence_files USING btree (job_id);
CREATE INDEX IF NOT EXISTS workflow_events_lead_removed_idx ON public.workflow_events (job_id) WHERE event_type = 'lead_removed';