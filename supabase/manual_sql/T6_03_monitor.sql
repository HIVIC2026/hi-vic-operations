-- ===================================================================================================
-- T6 BACKLOG — STEP 3 of 4 — READ ONLY. Run after T6_02, then every ~15 minutes.
-- Answers: how far the existing worker has got, and what actually happened to each home.
-- ===================================================================================================

-- 3a. Queue progress (the existing worker drains 5 items per 2-minute tick).
select
  w.status,
  count(*)                as items,
  min(w.updated_at)       as first_update,
  max(w.updated_at)       as last_update,
  max(w.last_error)       as last_error
from public.post_intake_work w
where w.reason = 'T6_BACKLOG_MANUAL'
group by w.status
order by w.status;

-- 3b. Per-home delivery record for THIS email (the existing idempotency key for the Group B email).
--     A row exists only once the sender reserved the send; status 'failed' is the only status a retry
--     could ever re-open (the sender re-reserves a confirmed failure atomically).
select
  j.job_number,
  s.status,
  s.sent_at,
  left(coalesce(s.error, ''), 160) as error,
  s.provider,
  w.status                          as queue_status
from public.customer_email_sends s
join public.jobs j on j.id = s.job_id
left join public.post_intake_work w
       on w.job_id = s.job_id and w.work_type = 'initial_gate1'
where s.idempotency_key like 'existing_leads_launch_v1:insulation_details:%'
order by s.created_at desc;

-- 3c. Homes that were processed but produced NO send row.
--     IMPORTANT (existing behaviour, not changed): when sendOne() stops before reserving — switched
--     off, no consent, opted out, media gate, no approved template, already sent — nothing is written
--     to customer_email_sends and the reason is NOT persisted anywhere. These rows are exactly the
--     ones that need a human look; re-running T6_01 shows each one again with its verdict.
select
  j.job_number,
  j.stage,
  w.status      as queue_status,
  w.completed_at,
  w.last_error
from public.post_intake_work w
join public.jobs j on j.id = w.job_id
where w.reason = 'T6_BACKLOG_MANUAL'
  and w.status = 'complete'
  and not exists (
    select 1 from public.customer_email_sends s
    where s.job_id = w.job_id
      and s.idempotency_key = 'existing_leads_launch_v1:insulation_details:' || w.job_id::text
  )
order by w.completed_at desc;

-- 3d. Proof the copy came from Jo's T6 path (audit event written by the existing sender).
select
  j.job_number,
  e.event_type,
  e.summary,
  e.created_at
from public.workflow_events e
join public.jobs j on j.id = e.job_id
where e.event_type in ('save_my_spot_email_sent', 'save_my_spot_outcome_unknown')
  and e.created_at > now() - interval '30 days'
order by e.created_at desc
limit 300;
