-- Owner paperwork gates A–D: immutable signed records + exact-version wording approvals. Server-only writes.
CREATE TABLE IF NOT EXISTS public.owner_gate_signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
  gate text NOT NULL CHECK (gate IN ('A','B','C','D')),
  doc_key text NOT NULL,
  doc_version text NOT NULL,
  doc_draft boolean NOT NULL,
  signed_text text NOT NULL,
  signed_text_sha256 text NOT NULL,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  signatory_name text NOT NULL CHECK (length(btrim(signatory_name)) >= 2),
  ticked boolean NOT NULL CHECK (ticked),
  method text NOT NULL CHECK (method IN ('link_code','login','office')),
  signed_by uuid,
  verified_channel text CHECK (verified_channel IS NULL OR verified_channel IN ('sms','email')),
  verified_destination text,
  code_id uuid,
  ip text,
  user_agent text,
  copy_path text,
  copy_email_queued boolean NOT NULL DEFAULT false,
  signed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (method <> 'link_code' OR (verified_channel IS NOT NULL AND verified_destination IS NOT NULL AND code_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS owner_gate_signatures_job ON public.owner_gate_signatures (job_id, doc_key, signed_at);

CREATE TABLE IF NOT EXISTS public.owner_paperwork_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_key text NOT NULL,
  doc_version text NOT NULL,
  body_sha256 text NOT NULL,
  approved_by uuid NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (doc_key, doc_version)
);

CREATE OR REPLACE FUNCTION public.owner_paperwork_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'owner_gate_signatures' THEN
      IF NEW.id = OLD.id AND NEW.signed_text = OLD.signed_text AND NEW.signed_at = OLD.signed_at AND NEW.doc_version = OLD.doc_version
         AND NEW.signatory_name = OLD.signatory_name AND NEW.answers = OLD.answers THEN
        IF OLD.copy_path IS NULL AND NEW.copy_email_queued = OLD.copy_email_queued THEN RETURN NEW; END IF; -- copy path filled once
        IF NEW.copy_email_queued AND NOT OLD.copy_email_queued AND NEW.copy_path IS NOT DISTINCT FROM OLD.copy_path THEN RETURN NEW; END IF;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION 'Signed owner paperwork is permanent and cannot be changed or deleted';
END $$;
DROP TRIGGER IF EXISTS owner_gate_signatures_immutable ON public.owner_gate_signatures;
CREATE TRIGGER owner_gate_signatures_immutable BEFORE UPDATE OR DELETE ON public.owner_gate_signatures FOR EACH ROW EXECUTE FUNCTION public.owner_paperwork_immutable();
DROP TRIGGER IF EXISTS owner_paperwork_approvals_immutable ON public.owner_paperwork_approvals;
CREATE TRIGGER owner_paperwork_approvals_immutable BEFORE UPDATE OR DELETE ON public.owner_paperwork_approvals FOR EACH ROW EXECUTE FUNCTION public.owner_paperwork_immutable();

GRANT SELECT ON public.owner_gate_signatures, public.owner_paperwork_approvals TO authenticated;
GRANT ALL ON public.owner_gate_signatures, public.owner_paperwork_approvals TO service_role;
ALTER TABLE public.owner_gate_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_paperwork_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read owner gate signatures" ON public.owner_gate_signatures;
CREATE POLICY "Admins read owner gate signatures" ON public.owner_gate_signatures FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS "Admins read paperwork approvals" ON public.owner_paperwork_approvals;
CREATE POLICY "Admins read paperwork approvals" ON public.owner_paperwork_approvals FOR SELECT TO authenticated USING (public.is_admin());
COMMENT ON TABLE public.owner_gate_signatures IS 'Owner paperwork gates A-D: permanent signed records (exact wording, verified contact, IP). Written only by the server.';
COMMENT ON TABLE public.owner_paperwork_approvals IS 'Jo approvals of exact owner paperwork wording versions. Permanent.';
