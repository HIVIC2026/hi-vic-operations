-- Rollback of installer-business-settings.sql: drops the who-books audit trigger and function ONLY.
-- The column `businesses.piesa_booked_by` and its check are KEPT: they were already live before this file (main's
-- 2026-11-03_piesa_booked_by.sql, applied) and main's code reads them (G6, 4 Nov 2026). To remove the column itself use
-- main's 2026-11-03_piesa_booked_by.undo.sql — only if the Part 2 "who books" screens are retired too.
-- The admin_config_events `who_books_changed` rows already written stay (history).
DROP TRIGGER IF EXISTS trg_guard_piesa_booked_by ON public.businesses;
DROP FUNCTION IF EXISTS public.guard_piesa_booked_by();
