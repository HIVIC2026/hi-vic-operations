-- 0075: signed official PIESA/PIISA copies (immutable) and their deliveries. Server-only writes.
CREATE TABLE public.official_form_signed_copies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
  form_key text NOT NULL CHECK (form_key IN ('piesa','piisa')),
  template_title text NOT NULL,
  template_publication text NOT NULL,
  mapping_version text NOT NULL,
  source_sha256 text NOT NULL,
  document_sha256 text NOT NULL,
  snapshot_sha256 text NOT NULL,
  snapshot jsonb NOT NULL,
  answers jsonb NOT NULL,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  job_facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  signer_user_id uuid NOT NULL,
  signer_name text NOT NULL,
  signer_role text NOT NULL,
  signature_date date NOT NULL,
  storage_path text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'current' CHECK (status IN ('current','invalidated','superseded')),
  invalidation_reason text,
  invalidated_at timestamptz,
  invalidated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'current' OR (invalidation_reason IS NOT NULL AND length(btrim(invalidation_reason)) > 0 AND invalidated_at IS NOT NULL))
);
CREATE UNIQUE INDEX official_form_signed_copies_one_current ON public.official_form_signed_copies (job_id, form_key) WHERE status = 'current';
CREATE INDEX official_form_signed_copies_job ON public.official_form_signed_copies (job_id);

GRANT SELECT ON public.official_form_signed_copies TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.official_form_signed_copies TO service_role;
ALTER TABLE public.official_form_signed_copies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Job participants read signed copies" ON public.official_form_signed_copies
  FOR SELECT TO authenticated USING (public.can_access_job(job_id));

-- Immutable: the only permitted change is current -> invalidated/superseded with reason/time/actor.
CREATE OR REPLACE FUNCTION public.guard_official_signed_copy() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Signed official copies cannot be deleted'; END IF;
  IF OLD.status <> 'current' THEN RAISE EXCEPTION 'Signed official copy is already %', OLD.status; END IF;
  IF NEW.status NOT IN ('invalidated','superseded') THEN RAISE EXCEPTION 'Only invalidation is allowed'; END IF;
  IF (to_jsonb(NEW) - ARRAY['status','invalidation_reason','invalidated_at','invalidated_by'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','invalidation_reason','invalidated_at','invalidated_by']) THEN
    RAISE EXCEPTION 'Signed official copy content is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_official_signed_copy BEFORE UPDATE OR DELETE ON public.official_form_signed_copies
  FOR EACH ROW EXECUTE FUNCTION public.guard_official_signed_copy();

CREATE TABLE public.official_form_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signed_copy_id uuid NOT NULL REFERENCES public.official_form_signed_copies(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
  recipient_role text NOT NULL CHECK (recipient_role IN ('installer','owner','electrician','office')),
  recipient_user_id uuid,
  channel text NOT NULL DEFAULT 'portal',
  delivered_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX official_form_deliveries_copy ON public.official_form_deliveries (signed_copy_id, recipient_role, delivered_at);

GRANT SELECT ON public.official_form_deliveries TO authenticated;
GRANT SELECT, INSERT ON public.official_form_deliveries TO service_role;
ALTER TABLE public.official_form_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Job participants read deliveries" ON public.official_form_deliveries
  FOR SELECT TO authenticated USING (public.can_access_job(job_id));

CREATE OR REPLACE FUNCTION public.guard_official_delivery() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'Delivery records are permanent'; END $$;
CREATE TRIGGER guard_official_delivery BEFORE UPDATE OR DELETE ON public.official_form_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.guard_official_delivery();

-- Private bucket 'official-form-copies' is created separately (not public); no client storage policies,
-- so files are reachable only through server-issued signed URLs.
