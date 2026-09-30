CREATE TABLE public.rec_onboarding_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resume_token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  step_key text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  insurance_certificate_path text,
  agreement_version text,
  agreement_title text,
  agreement_text text,
  agreement_sha256 text,
  acknowledgements jsonb,
  signer_name text,
  signer_position text,
  signer_email text,
  signed_at timestamptz,
  signed_ip text,
  signed_user_agent text,
  partner_enquiry_id uuid REFERENCES public.partner_enquiries(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signed_complete CHECK (status = 'draft' OR (signed_at IS NOT NULL AND agreement_sha256 IS NOT NULL AND agreement_text IS NOT NULL AND signer_name IS NOT NULL))
);
GRANT ALL ON public.rec_onboarding_applications TO service_role;
GRANT SELECT ON public.rec_onboarding_applications TO authenticated;
ALTER TABLE public.rec_onboarding_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read REC onboarding" ON public.rec_onboarding_applications FOR SELECT TO authenticated USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.guard_rec_onboarding_signed() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'submitted' THEN RAISE EXCEPTION 'Signed REC onboarding records are permanent'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'submitted' THEN
    IF (to_jsonb(NEW) - 'partner_enquiry_id' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'partner_enquiry_id' - 'updated_at') THEN
      RAISE EXCEPTION 'Signed REC onboarding records cannot be changed';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER rec_onboarding_signed_guard BEFORE UPDATE OR DELETE ON public.rec_onboarding_applications
FOR EACH ROW EXECUTE FUNCTION public.guard_rec_onboarding_signed();