DROP FUNCTION IF EXISTS public.accept_install_day(uuid, uuid, uuid, date);
DROP INDEX IF EXISTS public.appointment_proposals_install_day_idx;
ALTER TABLE public.jobs DROP COLUMN IF EXISTS install_10day_flagged_at;
ALTER TABLE public.appointment_proposals DROP COLUMN IF EXISTS install_day;
