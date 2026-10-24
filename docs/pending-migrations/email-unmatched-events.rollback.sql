-- Rollback for email-unmatched-events.sql. Refuses while job-less events exist (workflow_events is append-only,
-- so they cannot be deleted): keep the migration in that case.
do $$
begin
  if exists (select 1 from public.workflow_events where job_id is null) then
    raise exception 'job-less email events exist; keep email-unmatched-events.sql applied';
  end if;
end $$;
drop index if exists public.workflow_events_email_unmatched_idx;
alter table public.workflow_events drop constraint if exists workflow_events_job_required;
alter table public.workflow_events alter column job_id set not null;
