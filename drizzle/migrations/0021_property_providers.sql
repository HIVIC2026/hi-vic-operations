ALTER TABLE public.property_source_checks DROP CONSTRAINT IF EXISTS property_source_checks_status_check;
ALTER TABLE public.property_source_checks ADD CONSTRAINT property_source_checks_status_check CHECK (status IN ('ok','no_match','error','timeout','not_configured','skipped','no_coverage','no_entitlement','rejected'));
ALTER TABLE public.property_area_estimates ADD COLUMN IF NOT EXISTS calculation jsonb;

CREATE TABLE public.property_floorplans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.property_intelligence_runs(id) ON DELETE SET NULL,
  provider text NOT NULL,
  provider_property_id text,
  provider_image_id text,
  provider_url text,
  captured_date date,
  storage_policy text NOT NULL CHECK (storage_policy IN ('store_permitted','reference_only','unknown')),
  storage_path text,
  is_candidate boolean NOT NULL DEFAULT false,
  needs_review boolean NOT NULL DEFAULT true,
  review_reason text,
  metadata jsonb,
  retrieved_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX property_floorplans_unique ON public.property_floorplans(job_id, provider, provider_image_id);
GRANT SELECT ON public.property_floorplans TO authenticated;
GRANT ALL ON public.property_floorplans TO service_role;
ALTER TABLE public.property_floorplans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read floorplans" ON public.property_floorplans FOR SELECT TO authenticated USING (public.is_admin());