-- 0229 (Jo 28 Oct 2026): a partner person can be saved with just a full name, trade role and optional mobile.
-- partner_workers.email becomes optional. The existing UNIQUE (business_id, email) stays exactly as it is: Postgres
-- treats NULLs as distinct, so two people in the same business with no email are allowed, and the check still applies
-- whenever an email is given. A blank email is refused so "" can never act as a shared value.
-- Lead / Crew uses the existing worker_role column and its existing check ('lead' | 'crew' | NULL); no change here.
-- Database functions that read worker email (record_worker_certification, consume_worker_invite, accept_ready_check_offer)
-- compare with "=", which never matches NULL, so they are already null-safe and are not changed.
-- Safe to run twice. Not applied live until Jo approves.
ALTER TABLE public.partner_workers ALTER COLUMN email DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partner_workers_email_not_blank' AND conrelid = 'public.partner_workers'::regclass) THEN
    ALTER TABLE public.partner_workers ADD CONSTRAINT partner_workers_email_not_blank CHECK (email IS NULL OR btrim(email) <> '');
  END IF;
END $$;
