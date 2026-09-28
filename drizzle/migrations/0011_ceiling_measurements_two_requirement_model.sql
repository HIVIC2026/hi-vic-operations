CREATE TYPE public.measurement_status AS ENUM ('draft', 'needs_review', 'complete', 'rejected');
CREATE TYPE public.measurement_source AS ENUM ('electrician', 'installer', 'admin_import');

CREATE TABLE public.ceiling_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  status public.measurement_status NOT NULL DEFAULT 'draft',
  is_current boolean NOT NULL DEFAULT true,
  source_role public.measurement_source NOT NULL,
  completed_by uuid REFERENCES public.profiles(id),
  created_by uuid REFERENCES public.profiles(id),
  external_source text,
  external_id text,
  measured_area_m2 numeric,
  removal_required boolean,
  removal_m2 numeric,
  insulation_present boolean,
  existing_r_value numeric,
  access_difficulty public.access_difficulty,
  evidence_notes text,
  review_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_reason text,
  supplemented_by uuid REFERENCES public.profiles(id),
  supplemented_at timestamptz,
  supplemented_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_snapshot jsonb,
  completed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ceiling_measurements_one_current ON public.ceiling_measurements(job_id) WHERE is_current;
CREATE UNIQUE INDEX ceiling_measurements_external ON public.ceiling_measurements(job_id, external_source, external_id) WHERE external_id IS NOT NULL;

GRANT SELECT ON public.ceiling_measurements TO authenticated;
GRANT ALL ON public.ceiling_measurements TO service_role;
ALTER TABLE public.ceiling_measurements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "job participants read measurements" ON public.ceiling_measurements FOR SELECT TO authenticated USING (public.can_access_job(job_id));
CREATE POLICY "admins manage measurements" ON public.ceiling_measurements FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
CREATE TRIGGER t_ceiling_measurements BEFORE UPDATE ON public.ceiling_measurements FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Who is expected to do the measure-up when neither requirement is done yet.
ALTER TABLE public.jobs ADD COLUMN measure_up_responsibility text NOT NULL DEFAULT 'electrician' CHECK (measure_up_responsibility IN ('electrician', 'installer'));
-- Scope the Mitti audit was dispatched with; measure-up-only Mitti template is configuration (never invented).
ALTER TABLE public.assessments ADD COLUMN mitti_scope text;
ALTER TABLE public.workflow_settings ADD COLUMN mitti_measureup_template_id text;

-- Idempotent backfill from existing combined assessments (provenance: electrician; Mitti reference kept).
INSERT INTO public.ceiling_measurements (job_id, status, is_current, source_role, completed_by, created_by, external_source, external_id,
  measured_area_m2, removal_required, removal_m2, insulation_present, existing_r_value, access_difficulty, completed_at, raw_snapshot, created_at)
SELECT a.job_id,
  CASE WHEN a.status = 'complete' AND coalesce(a.measured_area_m2, 0) > 0 THEN 'complete'::public.measurement_status ELSE 'draft'::public.measurement_status END,
  true, 'electrician', a.assessor_id, a.assessor_id,
  CASE WHEN a.external_mitti_id IS NOT NULL THEN 'mitti' END, a.external_mitti_id,
  a.measured_area_m2, a.removal_required, a.removal_m2, a.insulation_present, a.existing_r_value, a.access_difficulty,
  CASE WHEN a.status = 'complete' THEN coalesce(a.completed_at, a.updated_at) END,
  jsonb_build_object('backfilled_from_assessment', a.id),
  a.created_at
FROM public.assessments a
WHERE a.measured_area_m2 IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.ceiling_measurements m WHERE m.job_id = a.job_id);

COMMENT ON COLUMN public.assessments.measured_area_m2 IS 'DEPRECATED for quoting: ceiling_measurements (current, complete) is the source of truth';