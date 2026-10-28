-- Rollback for 0229. Refuses while any person has no email (they would need an email first).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.partner_workers WHERE email IS NULL) THEN
    RAISE EXCEPTION 'rollback refused: some partner people have no email';
  END IF;
END $$;
ALTER TABLE public.partner_workers DROP CONSTRAINT IF EXISTS partner_workers_email_not_blank;
ALTER TABLE public.partner_workers ALTER COLUMN email SET NOT NULL;
