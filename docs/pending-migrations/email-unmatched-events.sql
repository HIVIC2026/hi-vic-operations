-- Decision 247 (Jo 24 Oct 2026): mail the Outlook copier cannot match raises ONE `email_unmatched` workflow event
-- with NO job (the email is never stored on a job until the office matches it); "Not a customer" is recorded as
-- `email_unmatched_dismissed`, also with no job. Every other event keeps its job: the check constraint allows a
-- null job_id only for these two types. workflow_events stays append-only (existing trigger untouched).
-- Until this is applied the copier counts such mail as unmatched-not-recorded and carries on (nothing is lost
-- compared with today). Idempotent; proven on PGlite (tests/email-unmatched-events-practice-db.test.ts and the
-- Outlook copier harness).
alter table public.workflow_events alter column job_id drop not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workflow_events_job_required') then
    alter table public.workflow_events add constraint workflow_events_job_required
      check (job_id is not null or event_type in ('email_unmatched', 'email_unmatched_dismissed'));
  end if;
end $$;
create index if not exists workflow_events_email_unmatched_idx on public.workflow_events (event_type)
  where event_type in ('email_unmatched', 'email_unmatched_matched', 'email_unmatched_dismissed');
