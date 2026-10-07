CREATE TABLE IF NOT EXISTS public.application_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.rec_onboarding_applications(id),
  decision text NOT NULL CHECK (decision IN ('changes_requested', 'declined')),
  message text CHECK (message IS NULL OR length(message) <= 2000),
  reopened_application_id uuid UNIQUE REFERENCES public.rec_onboarding_applications(id),
  email_status text NOT NULL DEFAULT 'not_sent',
  email_detail text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_reviews_reopen_only_for_changes CHECK (decision = 'changes_requested' OR reopened_application_id IS NULL),
  CONSTRAINT application_reviews_message_for_changes CHECK (decision <> 'changes_requested' OR length(coalesce(trim(message), '')) >= 3)
);
CREATE UNIQUE INDEX IF NOT EXISTS application_reviews_one_decision ON public.application_reviews (application_id);
GRANT SELECT ON public.application_reviews TO authenticated;
GRANT ALL ON public.application_reviews TO service_role;
ALTER TABLE public.application_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS application_reviews_admin_read ON public.application_reviews;
CREATE POLICY application_reviews_admin_read ON public.application_reviews FOR SELECT TO authenticated USING (public.is_admin());
CREATE OR REPLACE FUNCTION public.guard_application_review() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'application_review:immutable'; END IF;
  IF (to_jsonb(NEW) - 'email_status' - 'email_detail') IS DISTINCT FROM (to_jsonb(OLD) - 'email_status' - 'email_detail') THEN
    RAISE EXCEPTION 'application_review:immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_application_review ON public.application_reviews;
CREATE TRIGGER guard_application_review BEFORE UPDATE OR DELETE ON public.application_reviews FOR EACH ROW EXECUTE FUNCTION public.guard_application_review();