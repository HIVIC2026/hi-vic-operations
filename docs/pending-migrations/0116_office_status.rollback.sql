DROP TABLE IF EXISTS public.office_snoozes;
ALTER TABLE public.jobs DROP COLUMN IF EXISTS hold_revisit_at;
ALTER TABLE public.workflow_settings DROP COLUMN IF EXISTS office_time_limits;
