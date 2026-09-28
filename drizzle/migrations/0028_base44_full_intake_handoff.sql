-- Base44 intake: immutable contact consents + idempotent media import links on documents.
CREATE TABLE public.owner_contact_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL REFERENCES public.owners(id) ON DELETE RESTRICT,
  source text NOT NULL DEFAULT 'base44',
  consent_status text NOT NULL CHECK (consent_status IN ('granted','not_granted','unknown')),
  contact_consent boolean,
  consent_version text,
  consented_at timestamptz,
  age_confirmed boolean,
  assistance text CHECK (assistance IS NULL OR assistance IN ('none','interpreter','contract_support','both')),
  contact_preference text,
  source_reference text,
  consent_key text NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, source, consent_key)
);
GRANT SELECT ON public.owner_contact_consents TO authenticated;
GRANT ALL ON public.owner_contact_consents TO service_role;
ALTER TABLE public.owner_contact_consents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read contact consents" ON public.owner_contact_consents FOR SELECT TO authenticated USING (public.is_admin());
CREATE TRIGGER owner_contact_consents_immutable BEFORE UPDATE OR DELETE ON public.owner_contact_consents FOR EACH ROW EXECUTE FUNCTION public.guard_immutable_row();
CREATE INDEX owner_contact_consents_job_idx ON public.owner_contact_consents(job_id, created_at DESC);

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS source_system text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS original_name text;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS size_bytes bigint;
CREATE UNIQUE INDEX IF NOT EXISTS documents_external_source_uniq ON public.documents(job_id, source_system, external_id) WHERE external_id IS NOT NULL;