-- Rollback for piesa-deadline-from-official-piesa.sql: the view as it was (current record's date).
create or replace view public.job_piesa_deadlines with (security_invoker = true) as
 select j.id as job_id,
    p.completed_date as piesa_date,
    p.outcome as piesa_outcome,
    p.completed_date + s.piesa_install_window_days as install_deadline,
    p.completed_date + s.piesa_install_window_days - (now() at time zone 'Australia/Melbourne')::date as days_remaining,
        case
            when p.completed_date is null or j.installation_completed_at is not null or (j.stage = any (array['complete'::job_stage, 'cancelled'::job_stage])) then null::text
            when (p.completed_date + s.piesa_install_window_days - (now() at time zone 'Australia/Melbourne')::date) < 0 then 'expired'::text
            when (p.completed_date + s.piesa_install_window_days - (now() at time zone 'Australia/Melbourne')::date) <= s.urgency_red_days then 'red'::text
            when (p.completed_date + s.piesa_install_window_days - (now() at time zone 'Australia/Melbourne')::date) <= s.urgency_amber_days then 'amber'::text
            else 'green'::text
        end as urgency,
    p.completed_date is not null and j.installation_completed_at is null and (p.completed_date + s.piesa_install_window_days) < (now() at time zone 'Australia/Melbourne')::date as piesa_expired
   from jobs j
     cross join workflow_settings s
     left join piesa_records p on p.job_id = j.id and p.is_current;
