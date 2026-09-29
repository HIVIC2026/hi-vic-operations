CREATE TABLE public.veu_location_variables (
  postcode text PRIMARY KEY CHECK (postcode ~ '^[0-9]{4}$'),
  metropolitan_or_regional text NOT NULL CHECK (metropolitan_or_regional IN ('Metropolitan','Regional')),
  reticulated_gas boolean,
  climate_region text NOT NULL CHECK (climate_region IN ('Mild','Cold','Hot')),
  climate_zone smallint CHECK (climate_zone IN (4,5)),
  source_version text NOT NULL,
  source_url text NOT NULL,
  source_sha256 text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.veu_location_variables TO authenticated;
GRANT ALL ON public.veu_location_variables TO service_role;
ALTER TABLE public.veu_location_variables ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read official VEU location variables" ON public.veu_location_variables FOR SELECT TO authenticated USING (true);

CREATE TABLE public.retail_estimator_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL UNIQUE,
  is_current boolean NOT NULL DEFAULT false,
  r5_install_inc_gst_per_m2 numeric(10,2) NOT NULL,
  removal_inc_gst_per_m2 numeric(10,2) NOT NULL,
  piesa_assessment_inc_gst numeric(10,2) NOT NULL,
  ap_management_inc_gst numeric(10,2) NOT NULL,
  access_standard_multiplier numeric(6,4) NOT NULL,
  access_moderate_multiplier numeric(6,4) NOT NULL,
  access_difficult_multiplier numeric(6,4) NOT NULL,
  indicative_veec_value numeric(10,2) NOT NULL,
  veec_value_source_label text NOT NULL,
  veec_value_source_url text NOT NULL,
  veec_value_checked_at date NOT NULL,
  minimum_customer_copayment_inc_gst numeric(10,2) NOT NULL,
  spec_version text NOT NULL,
  spec_source_url text NOT NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX retail_estimator_settings_one_current ON public.retail_estimator_settings(is_current) WHERE is_current;
GRANT SELECT ON public.retail_estimator_settings TO authenticated;
GRANT ALL ON public.retail_estimator_settings TO service_role;
ALTER TABLE public.retail_estimator_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read retail estimator settings" ON public.retail_estimator_settings FOR SELECT TO authenticated USING (public.is_admin());

CREATE TABLE public.indicative_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'current' CHECK (status IN ('current','superseded')),
  input_signature text NOT NULL,
  eligibility_outcome text,
  display_mode text NOT NULL,
  area_m2 numeric(10,2) NOT NULL,
  area_source text NOT NULL,
  area_basis text NOT NULL,
  area_source_id text,
  postcode text NOT NULL,
  location jsonb NOT NULL,
  spec_version text NOT NULL,
  spec_source_url text NOT NULL,
  settings_id uuid NOT NULL REFERENCES public.retail_estimator_settings(id),
  settings_version integer NOT NULL,
  veec_value numeric(10,2) NOT NULL,
  veec_source_url text NOT NULL,
  veec_checked_at date NOT NULL,
  ghg_savings_factor numeric(10,6) NOT NULL,
  regional_factor numeric(6,4) NOT NULL,
  lifetime_years integer NOT NULL,
  raw_ghg_reduction numeric(14,6) NOT NULL,
  raw_estimated_discount numeric(12,4) NOT NULL,
  applied_discount numeric(12,4) NOT NULL,
  insulation_declared text,
  scenarios jsonb NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz
);
CREATE UNIQUE INDEX indicative_estimates_one_current ON public.indicative_estimates(job_id) WHERE status = 'current';
CREATE INDEX indicative_estimates_job ON public.indicative_estimates(job_id, created_at DESC);
GRANT SELECT ON public.indicative_estimates TO authenticated;
GRANT ALL ON public.indicative_estimates TO service_role;
ALTER TABLE public.indicative_estimates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read indicative estimates" ON public.indicative_estimates FOR SELECT TO authenticated USING (public.is_admin());
COMMENT ON TABLE public.indicative_estimates IS 'Step 3 indicative customer estimates (Activity 48 Spec v25 Eq 48.1). Owners read customer-safe fields only via server function.';