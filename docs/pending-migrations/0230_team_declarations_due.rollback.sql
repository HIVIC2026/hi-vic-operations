-- Rollback for 0230: removes only declarations_due.
ALTER TABLE public.partner_workers DROP COLUMN IF EXISTS declarations_due;
