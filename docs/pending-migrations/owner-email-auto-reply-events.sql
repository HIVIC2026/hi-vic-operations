-- Decision 386 (Jo 25 Oct 2026, "Auto-send simple ones"): a matched OWNER's standard question emailed to info@ gets ONE
-- automatic reply. The reply is claimed by ONE `email_auto_replied` workflow event per Outlook message, written BEFORE
-- the send (details->>'idempotency_key' = 'owner-email-auto-reply:v1:<provider message id>'). This adds the once-only
-- guard so two copier runs (sync + the office's "Match this email") can never both send for the same message.
-- No check constraint changes: every decision-386 event (`email_auto_replied`, `email_auto_reply_held`,
-- `email_auto_reply_filed`) carries its job, so `workflow_events_job_required` (email-unmatched-events.sql /
-- new-sender-reply-events.sql) is untouched and there is no event_type check on workflow_events. The log stays
-- append-only (existing trigger untouched). Idempotent; safe before or after the other email migrations.
-- Until applied the server still checks for an earlier claim before sending (read-then-insert, as decision 337);
-- this index makes the claim race-proof (the second insert fails with 23505 and nothing is sent).
-- Proven on PGlite: tests/owner-email-auto-reply-events-practice-db.test.ts.
create unique index if not exists workflow_events_email_auto_reply_once_idx on public.workflow_events ((details->>'idempotency_key'))
  where event_type = 'email_auto_replied';
create index if not exists workflow_events_email_auto_reply_idx on public.workflow_events (event_type)
  where event_type in ('email_auto_replied', 'email_auto_reply_held', 'email_auto_reply_filed');
