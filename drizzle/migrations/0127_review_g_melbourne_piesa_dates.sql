CREATE OR REPLACE VIEW public.job_piesa_deadlines WITH (security_invoker = true) AS
 SELECT j.id AS job_id,
    p.completed_date AS piesa_date,
    p.outcome AS piesa_outcome,
    p.completed_date + s.piesa_install_window_days AS install_deadline,
    p.completed_date + s.piesa_install_window_days - (now() AT TIME ZONE 'Australia/Melbourne')::date AS days_remaining,
        CASE
            WHEN p.completed_date IS NULL OR j.installation_completed_at IS NOT NULL OR (j.stage = ANY (ARRAY['complete'::public.job_stage, 'cancelled'::public.job_stage])) THEN NULL::text
            WHEN (p.completed_date + s.piesa_install_window_days - (now() AT TIME ZONE 'Australia/Melbourne')::date) < 0 THEN 'expired'::text
            WHEN (p.completed_date + s.piesa_install_window_days - (now() AT TIME ZONE 'Australia/Melbourne')::date) <= s.urgency_red_days THEN 'red'::text
            WHEN (p.completed_date + s.piesa_install_window_days - (now() AT TIME ZONE 'Australia/Melbourne')::date) <= s.urgency_amber_days THEN 'amber'::text
            ELSE 'green'::text
        END AS urgency,
    p.completed_date IS NOT NULL AND j.installation_completed_at IS NULL AND (p.completed_date + s.piesa_install_window_days) < (now() AT TIME ZONE 'Australia/Melbourne')::date AS piesa_expired
   FROM public.jobs j
     CROSS JOIN public.workflow_settings s
     LEFT JOIN public.piesa_records p ON p.job_id = j.id AND p.is_current;