-- ===================================================================================================
-- ENQUIRY BACKLOG — STEP 3 of 4 — READ ONLY. Run after ENQ_01 and then every ~15 minutes.
-- ===================================================================================================

-- 3a. Queue progress for this batch.
select status, count(*) as items, min(updated_at) as first_update, max(updated_at) as last_update,
       max(last_error) as last_error
from public.post_intake_work
where reason = 'ENQUIRY_BACKLOG_MANUAL'
group by status
order by status;

-- 3b. What actually reached the provider for the three automatic purposes (the only real send evidence).
select
  j.job_number,
  s.purpose,
  s.status,
  s.sent_at,
  left(coalesce(s.error, ''), 160) as error,
  s.provider,
  s.provider_message_id,
  w.status as queue_status
from public.customer_email_sends s
join public.jobs j on j.id = s.job_id
left join public.post_intake_work w
       on w.job_id = s.job_id and w.work_type = 'initial_gate1'
where s.purpose in ('existing_leads_launch_v1', 'insulation_video_request', 'preliminary_ineligible')
  and (w.reason = 'ENQUIRY_BACKLOG_MANUAL' or s.created_at > now() - interval '2 days')
order by s.created_at desc;

-- 3c. Processed but NO send row: the sender stopped before reserving (switched off, consent, opt-out, media,
--     coverage, rules, no approved template). The reason is not persisted by the existing sender — re-run
--     ENQ_00 to see the same records with their current category and blocker.
select
  j.job_number, j.stage, w.status as queue_status, w.completed_at, w.last_error
from public.post_intake_work w
join public.jobs j on j.id = w.job_id
where w.reason = 'ENQUIRY_BACKLOG_MANUAL'
  and w.status = 'complete'
  and not exists (
    select 1 from public.customer_email_sends s
    where s.job_id = w.job_id
      and s.purpose in ('existing_leads_launch_v1', 'insulation_video_request', 'preliminary_ineligible')
  )
order by w.completed_at desc;

-- 3d. Delivery evidence, where the provider reported it. "Accepted" is not the same as "delivered".
select
  s.status,
  count(*) filter (where s.provider_message_id is not null) as with_provider_id,
  count(*) as total
from public.customer_email_sends s
where s.purpose in ('existing_leads_launch_v1', 'insulation_video_request', 'preliminary_ineligible')
  and s.created_at > now() - interval '7 days'
group by s.status;
