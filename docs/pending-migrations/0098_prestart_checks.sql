-- Step 10: certification level/expiry (office, append-only) + day-before pre-start check records (append-only).
-- Additive only. Existing certification records are untouched; a verified record with no level row counts as NOT confirmed.
CREATE TABLE IF NOT EXISTS public.worker_certification_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id uuid NOT NULL REFERENCES public.partner_worker_certifications(id),
  worker_email text NOT NULL,
  level text NOT NULL CHECK (level IN ('full', 'provisional')),
  expires_on date NOT NULL,
  recorded_by uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.worker_certification_levels TO authenticated;
GRANT ALL ON public.worker_certification_levels TO service_role;
ALTER TABLE public.worker_certification_levels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Office reads certification levels" ON public.worker_certification_levels;
CREATE POLICY "Office reads certification levels" ON public.worker_certification_levels FOR SELECT TO authenticated USING (public.is_admin());
CREATE INDEX IF NOT EXISTS worker_certification_levels_cert_idx ON public.worker_certification_levels(certification_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS worker_certification_levels_email_idx ON public.worker_certification_levels(lower(worker_email), recorded_at DESC);

CREATE TABLE IF NOT EXISTS public.pre_start_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id),
  booking_id uuid,
  scheduled_start timestamptz NOT NULL,
  passed boolean NOT NULL,
  failures jsonb NOT NULL DEFAULT '[]'::jsonb,
  trigger text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.pre_start_checks TO authenticated;
GRANT ALL ON public.pre_start_checks TO service_role;
ALTER TABLE public.pre_start_checks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Office reads pre-start checks" ON public.pre_start_checks;
CREATE POLICY "Office reads pre-start checks" ON public.pre_start_checks FOR SELECT TO authenticated USING (public.is_admin());
CREATE INDEX IF NOT EXISTS pre_start_checks_job_idx ON public.pre_start_checks(job_id, checked_at DESC);

CREATE OR REPLACE FUNCTION public.guard_append_only_step10() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'These records are permanent'; END $$;
DROP TRIGGER IF EXISTS worker_certification_levels_immutable ON public.worker_certification_levels;
CREATE TRIGGER worker_certification_levels_immutable BEFORE UPDATE OR DELETE ON public.worker_certification_levels FOR EACH ROW EXECUTE FUNCTION public.guard_append_only_step10();
DROP TRIGGER IF EXISTS pre_start_checks_immutable ON public.pre_start_checks;
CREATE TRIGGER pre_start_checks_immutable BEFORE UPDATE OR DELETE ON public.pre_start_checks FOR EACH ROW EXECUTE FUNCTION public.guard_append_only_step10();
