CREATE TABLE public.owner_eligibility_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  token_hash text NOT NULL UNIQUE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  submitted_at timestamptz,
  answers jsonb,
  result text CHECK (result IS NULL OR result IN ('likely_eligible','needs_onsite_confirmation','does_not_appear_eligible')),
  result_reasons jsonb,
  ruleset_version text,
  CHECK ((submitted_at IS NULL) = (result IS NULL))
);
CREATE INDEX owner_eligibility_links_job_idx ON public.owner_eligibility_links(job_id, created_at DESC);
GRANT SELECT ON public.owner_eligibility_links TO authenticated;
GRANT ALL ON public.owner_eligibility_links TO service_role;
ALTER TABLE public.owner_eligibility_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_all ON public.owner_eligibility_links FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE POLICY member_read ON public.owner_eligibility_links FOR SELECT TO authenticated USING (business_id IS NOT NULL AND public.is_business_member(business_id));