-- Rollback for followup-send-claim.sql: drops the claim index and puts back the previous job-less check exactly as
-- emails-tab-nojob-events.sql defines it. Refuses while job-less claim/failure events exist (workflow_events is
-- append-only, so they cannot be deleted): keep the migration in that case.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.workflow_events WHERE job_id IS NULL AND event_type IN ('email_nojob_followup_claim', 'email_nojob_followup_failed')) THEN
    RAISE EXCEPTION 'job-less follow-up claim/failure events exist; keep followup-send-claim.sql applied';
  END IF;
END $$;
DROP INDEX IF EXISTS public.workflow_events_nojob_followup_claim_once_idx;
ALTER TABLE public.workflow_events DROP CONSTRAINT IF EXISTS workflow_events_job_required;
ALTER TABLE public.workflow_events ADD CONSTRAINT workflow_events_job_required CHECK (
  job_id IS NOT NULL OR event_type = ANY (ARRAY['email_unmatched', 'email_unmatched_dismissed', 'email_new_sender_replied',
    'email_nojob_ai_draft', 'email_nojob_reply_sent', 'email_nojob_ai_draft_closed']::text[])
);
