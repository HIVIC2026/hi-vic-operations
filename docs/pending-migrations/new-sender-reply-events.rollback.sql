-- Rollback for new-sender-reply-events.sql: narrows the job-less check back to decision 247's two email types.
-- Refuses while new-sender reply events exist (workflow_events is append-only, so they cannot be deleted): keep the
-- migration in that case. Leaves job_id nullable (email-unmatched-events.sql owns that; roll it back separately).
do $$
begin
  if exists (select 1 from public.workflow_events where job_id is null and event_type = 'email_new_sender_replied') then
    raise exception 'job-less new-sender reply events exist; keep new-sender-reply-events.sql applied';
  end if;
end $$;
drop index if exists public.workflow_events_new_sender_reply_idx;
drop index if exists public.workflow_events_new_sender_reply_once_idx;
alter table public.workflow_events drop constraint if exists workflow_events_job_required;
alter table public.workflow_events add constraint workflow_events_job_required
  check (job_id is not null or event_type in ('email_unmatched', 'email_unmatched_dismissed'));
