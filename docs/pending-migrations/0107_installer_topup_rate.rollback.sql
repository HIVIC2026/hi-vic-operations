-- Undo 0107: removes only the new topup_r5_rate column. No existing data is changed.
ALTER TABLE public.installer_rate_requests DROP COLUMN topup_r5_rate;
