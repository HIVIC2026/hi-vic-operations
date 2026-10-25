-- Decision 292 (Jo 25 Oct 2026, replaces 255 for new senders): a NEW email sender asking an enquiry / price / rebate /
-- eligibility question gets ONE website reply by email instead of an enquiry. The reply has no job, so it is recorded
-- like decision 247's job-less `email_unmatched`: one `email_new_sender_replied` event per reply. This widens the
-- `workflow_events_job_required` check from email-unmatched-events.sql to that type (every other event still needs
-- its job; the log stays append-only, existing trigger untouched) and adds the once-ever guard: at most ONE live reply
-- per normalised sender address (details->>'idempotency_key' = 'new-sender-reply:v1:<address>'), so two copier runs
-- can never both send. Safe to run before or after email-unmatched-events.sql (both idempotent).
-- Until applied the copier records nothing for new senders and sends nothing live (a live send without its claim
-- would not be idempotent). Proven on PGlite: tests/new-sender-reply-events-practice-db.test.ts and the Outlook
-- copier harness (tests/helpers/outlook-recovery-cases.ts).
alter table public.workflow_events alter column job_id drop not null;
alter table public.workflow_events drop constraint if exists workflow_events_job_required;
alter table public.workflow_events add constraint workflow_events_job_required
  check (job_id is not null or event_type in ('email_unmatched', 'email_unmatched_dismissed', 'email_new_sender_replied'));
create index if not exists workflow_events_email_unmatched_idx on public.workflow_events (event_type)
  where event_type in ('email_unmatched', 'email_unmatched_matched', 'email_unmatched_dismissed');
create unique index if not exists workflow_events_new_sender_reply_once_idx on public.workflow_events ((details->>'idempotency_key'))
  where event_type = 'email_new_sender_replied' and details->>'mode' = 'live';
create index if not exists workflow_events_new_sender_reply_idx on public.workflow_events (event_type)
  where event_type = 'email_new_sender_replied';
