-- Undo for emails-tab-nojob-events.sql (first remove any job-less rows of the three new types, or this will fail).
ALTER TABLE public.workflow_events DROP CONSTRAINT IF EXISTS workflow_events_job_required;
ALTER TABLE public.workflow_events ADD CONSTRAINT workflow_events_job_required CHECK (
  job_id IS NOT NULL OR event_type = ANY (ARRAY['email_unmatched', 'email_unmatched_dismissed', 'email_new_sender_replied']::text[])
);
