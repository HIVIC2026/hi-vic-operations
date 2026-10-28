-- Only safe while every partner_workers row still has an email.
ALTER TABLE public.partner_workers DROP CONSTRAINT IF EXISTS partner_workers_worker_role_check;
ALTER TABLE public.partner_workers ALTER COLUMN email SET NOT NULL;
