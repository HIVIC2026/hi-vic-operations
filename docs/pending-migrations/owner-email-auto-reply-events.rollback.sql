-- Rollback for owner-email-auto-reply-events.sql: drops the once-only claim index and the lookup index. Events already
-- written stay (workflow_events is append-only); without the unique index the server falls back to its read-then-insert
-- check before each send.
drop index if exists public.workflow_events_email_auto_reply_idx;
drop index if exists public.workflow_events_email_auto_reply_once_idx;
