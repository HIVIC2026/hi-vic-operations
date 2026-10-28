-- Follow-up replies through Outlook (Jo 28 Oct 2026; catch-up plan 29 Oct 2026, task 2). A follow-up reply on the
-- Emails tab is sent through the info@ Outlook mailbox, which has no once-only key, so the portal writes a once-only
-- claim BEFORE sending: one `email_nojob_followup_claim` event per details->>'claim_key'
-- ('nojob-email-followup:v1:<message id>:try<n>', n = earlier definite failures). A double tap gets the duplicate-key
-- error (23505) and sends nothing. A definite Outlook failure is recorded as `email_nojob_followup_failed`, which lets
-- the next Send take the next key. Both are job-less, so `workflow_events_job_required` is widened: rebuilt from the
-- latest definition (emails-tab-nojob-events.sql, applied live 27 Oct 2026) with the two new types added; nothing
-- already allowed is dropped. workflow_events stays append-only (existing trigger untouched). Idempotent.
-- Until applied, the claim insert is refused (check constraint) and the follow-up is NOT sent ("Not sent — couldn't
-- record the reply first"). Proven on PGlite: tests/followup-send-claim-practice-db.test.ts. Rollback:
-- followup-send-claim.rollback.sql.
ALTER TABLE public.workflow_events DROP CONSTRAINT IF EXISTS workflow_events_job_required;
ALTER TABLE public.workflow_events ADD CONSTRAINT workflow_events_job_required CHECK (
  job_id IS NOT NULL OR event_type = ANY (ARRAY['email_unmatched', 'email_unmatched_dismissed', 'email_new_sender_replied',
    'email_nojob_ai_draft', 'email_nojob_reply_sent', 'email_nojob_ai_draft_closed',
    'email_nojob_followup_claim', 'email_nojob_followup_failed']::text[])
);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_events_nojob_followup_claim_once_idx ON public.workflow_events ((details->>'claim_key'))
  WHERE event_type = 'email_nojob_followup_claim';
