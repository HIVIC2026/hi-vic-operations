-- Tidy partner profile fields + office "this is a test" marks for partner applications.
-- Additive only. Signed applications stay immutable; a test mark is a separate append-only row.

CREATE TABLE IF NOT EXISTS public.onboarding_test_marks (
  application_id uuid PRIMARY KEY REFERENCES public.rec_onboarding_applications(id),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  marked_by uuid,
  marked_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.onboarding_test_marks TO authenticated;
GRANT ALL ON public.onboarding_test_marks TO service_role;
ALTER TABLE public.onboarding_test_marks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read test marks" ON public.onboarding_test_marks;
CREATE POLICY "admins read test marks" ON public.onboarding_test_marks FOR SELECT TO authenticated USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.guard_onboarding_test_mark() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN RAISE EXCEPTION 'Test marks are permanent'; END $$;
DROP TRIGGER IF EXISTS onboarding_test_marks_immutable ON public.onboarding_test_marks;
CREATE TRIGGER onboarding_test_marks_immutable BEFORE UPDATE OR DELETE ON public.onboarding_test_marks FOR EACH ROW EXECUTE FUNCTION public.guard_onboarding_test_mark();

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS base_suburb text,
  ADD COLUMN IF NOT EXISTS coverage_lat double precision,
  ADD COLUMN IF NOT EXISTS coverage_lng double precision,
  ADD COLUMN IF NOT EXISTS coverage_radius_km integer,
  ADD COLUMN IF NOT EXISTS covers_all_victoria boolean,
  ADD COLUMN IF NOT EXISTS public_liability_cover_amount numeric,
  ADD COLUMN IF NOT EXISTS free_quotes_for_hivic_leads boolean,
  ADD COLUMN IF NOT EXISTS signer_name text,
  ADD COLUMN IF NOT EXISTS signer_position text,
  ADD COLUMN IF NOT EXISTS signer_mobile text,
  ADD COLUMN IF NOT EXISTS signer_email text,
  ADD COLUMN IF NOT EXISTS approval_message_status text CHECK (approval_message_status IN ('queued','sent','cancelled')),
  ADD COLUMN IF NOT EXISTS approval_message_queued_at timestamptz;
