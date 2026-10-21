-- Speed (Jo 21 Oct): Office enquiry/job lists look up each job's intake media and "removed" marker.
-- documents and evidence_files had no job index, so every list read scanned both tables once per job
-- (~7.4 million scans each). Indexes only: no data, view, wording, pile or workflow change.
CREATE INDEX IF NOT EXISTS documents_job_id_kind_idx ON public.documents USING btree (job_id, kind);
CREATE INDEX IF NOT EXISTS evidence_files_job_id_idx ON public.evidence_files USING btree (job_id);
CREATE INDEX IF NOT EXISTS workflow_events_lead_removed_idx ON public.workflow_events (job_id) WHERE event_type = 'lead_removed';
