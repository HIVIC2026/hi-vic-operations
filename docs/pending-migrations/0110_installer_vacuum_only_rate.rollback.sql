-- Undo 0110_installer_vacuum_only_rate: removes only the column this migration added.
ALTER TABLE public.installer_rate_requests DROP COLUMN IF EXISTS vacuum_only_rate;
