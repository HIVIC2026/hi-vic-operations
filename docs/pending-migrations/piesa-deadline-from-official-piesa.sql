-- Decision 316 (Jo 25 Oct 2026): "the 30 days starts from the official PIESA, not the fixes".
-- job_piesa_deadlines used the CURRENT piesa_records row's date, which after electrical fixes is the
-- post_rectification row (the fixes / Section C date). The 30-day window now always runs from the latest
-- official PIESA (kind 'initial', or a 'reassessment' after an expired window). Outcome still comes from the
-- current row. Same columns, names and types, so grants and job_overview are unaffected. Idempotent.
create or replace view public.job_piesa_deadlines with (security_invoker = true) as
 select j.id as job_id,
    a.completed_date as piesa_date,
    p.outcome as piesa_outcome,
    a.completed_date + s.piesa_install_window_days as install_deadline,
    a.completed_date + s.piesa_install_window_days - (now() at time zone 'Australia/Melbourne')::date as days_remaining,
        case
            when a.completed_date is null or j.installation_completed_at is not null or (j.stage = any (array['complete'::job_stage, 'cancelled'::job_stage])) then null::text
            when (a.completed_date + s.piesa_install_window_days - (now() at time zone 'Australia/Melbourne')::date) < 0 then 'expired'::text
            when (a.completed_date + s.piesa_install_window_days - (now() at time zone 'Australia/Melbourne')::date) <= s.urgency_red_days then 'red'::text
            when (a.completed_date + s.piesa_install_window_days - (now() at time zone 'Australia/Melbourne')::date) <= s.urgency_amber_days then 'amber'::text
            else 'green'::text
        end as urgency,
    a.completed_date is not null and j.installation_completed_at is null and (a.completed_date + s.piesa_install_window_days) < (now() at time zone 'Australia/Melbourne')::date as piesa_expired
   from jobs j
     cross join workflow_settings s
     left join piesa_records p on p.job_id = j.id and p.is_current
     left join lateral (
       select r.completed_date from piesa_records r
        where r.job_id = j.id and r.kind in ('initial', 'reassessment')
        order by r.created_at desc limit 1
     ) a on true;
