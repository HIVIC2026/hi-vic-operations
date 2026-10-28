-- Jo 28 Oct 2026: people can be saved without an email; installer people are a Lead or Crew.
-- The existing UNIQUE (business_id, email) stays: Postgres treats blank (NULL) emails as distinct, so two people
-- with no email in one business are allowed, while a given email is still unique per business.
ALTER TABLE public.partner_workers ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public.partner_workers DROP CONSTRAINT IF EXISTS partner_workers_worker_role_check;
ALTER TABLE public.partner_workers ADD CONSTRAINT partner_workers_worker_role_check CHECK (worker_role IS NULL OR worker_role IN ('lead','crew'));
COMMENT ON COLUMN public.partner_workers.worker_role IS 'Installer people: lead or crew. NULL = crew, except people with Mitti access today (treated as lead).';
