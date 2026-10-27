-- APPLIED to the live database 27 Oct 2026 (Jo said yes). Constraint read back afterwards.
-- Decision 414 (Jo 27 Oct 2026): the office Emails tab saves three job-less records for emails with no job yet:
-- the AI draft, the sent reply, and "draft closed" when the email is matched to a job.
ALTER TABLE public.workflow_events DROP CONSTRAINT IF EXISTS workflow_events_job_required;
ALTER TABLE public.workflow_events ADD CONSTRAINT workflow_events_job_required CHECK (
  job_id IS NOT NULL OR event_type = ANY (ARRAY['email_unmatched', 'email_unmatched_dismissed', 'email_new_sender_replied',
    'email_nojob_ai_draft', 'email_nojob_reply_sent', 'email_nojob_ai_draft_closed']::text[])
);
