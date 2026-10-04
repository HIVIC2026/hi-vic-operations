DROP FUNCTION IF EXISTS public.approve_rectification_with_window(uuid, uuid, uuid);
ALTER TABLE public.appointment_proposals DROP COLUMN IF EXISTS electrician_window;
ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_rect_estimated_hours_range;
ALTER TABLE public.quotes DROP COLUMN IF EXISTS nudge_24h_at;
ALTER TABLE public.quotes DROP COLUMN IF EXISTS rect_estimated_hours;
