-- Undo 0100: removes only the new visit events table and its guard. Nothing else is touched.
DROP TABLE IF EXISTS public.visit_events;
DROP FUNCTION IF EXISTS public.guard_visit_events();
