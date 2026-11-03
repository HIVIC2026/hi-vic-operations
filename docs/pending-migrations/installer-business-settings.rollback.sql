-- Rollback of installer-business-settings.sql: drops the who-books column, its check and its audit trigger.
-- The admin_config_events `who_books_changed` rows already written stay (history).
DROP TRIGGER IF EXISTS trg_guard_piesa_booked_by ON public.businesses;
DROP FUNCTION IF EXISTS public.guard_piesa_booked_by();
ALTER TABLE public.businesses DROP CONSTRAINT IF EXISTS businesses_piesa_booked_by_check;
ALTER TABLE public.businesses DROP COLUMN IF EXISTS piesa_booked_by;
