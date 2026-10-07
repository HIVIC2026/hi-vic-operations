-- Speed (Jo 7 Oct): office lists filter events by type; evidence queues filter by status.
CREATE INDEX IF NOT EXISTS workflow_events_type_created_idx ON public.workflow_events (event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS evidence_requirements_open_idx ON public.evidence_requirements (status) WHERE required;
CREATE INDEX IF NOT EXISTS invoices_job_created_idx ON public.invoices (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_job_idx ON public.messages (job_id);
