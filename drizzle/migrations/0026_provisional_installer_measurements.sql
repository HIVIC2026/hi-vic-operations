ALTER TABLE public.ceiling_measurements
  ADD COLUMN IF NOT EXISTS provenance text NOT NULL DEFAULT 'hivic_onsite' CHECK (provenance IN ('hivic_onsite','installer_supplied_provisional')),
  ADD COLUMN IF NOT EXISTS measurement_purpose text CHECK (measurement_purpose IN ('sales_estimate','onsite_measured','final_installed')),
  ADD COLUMN IF NOT EXISTS measurement_method text CHECK (measurement_method IN ('laser','tape','floorplan','aerial_remote','other')),
  ADD COLUMN IF NOT EXISTS measured_by_name text,
  ADD COLUMN IF NOT EXISTS measured_by_role text,
  ADD COLUMN IF NOT EXISTS measured_by_business_id uuid REFERENCES public.businesses(id),
  ADD COLUMN IF NOT EXISTS measured_on date,
  ADD COLUMN IF NOT EXISTS zones jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS gross_area_m2 numeric,
  ADD COLUMN IF NOT EXISTS excluded_area_m2 numeric,
  ADD COLUMN IF NOT EXISTS assumptions text,
  ADD COLUMN IF NOT EXISTS confidence text CHECK (confidence IN ('low','medium','high')),
  ADD COLUMN IF NOT EXISTS partner_method_id uuid,
  ADD COLUMN IF NOT EXISTS supplied_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS supplied_area_m2 numeric,
  ADD COLUMN IF NOT EXISTS supplied_removal_m2 numeric,
  ADD COLUMN IF NOT EXISTS verified_area_m2 numeric,
  ADD COLUMN IF NOT EXISTS verified_method text CHECK (verified_method IN ('laser','tape','floorplan','aerial_remote','other')),
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS verified_role text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS variance_m2 numeric,
  ADD COLUMN IF NOT EXISTS variance_pct numeric,
  ADD COLUMN IF NOT EXISTS accepted_by uuid,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_reason text,
  ADD COLUMN IF NOT EXISTS accepted_standard_version text;

CREATE OR REPLACE FUNCTION public.guard_supplied_measurement()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
begin
  if old.supplied_snapshot is not null and (new.supplied_snapshot is distinct from old.supplied_snapshot or new.supplied_area_m2 is distinct from old.supplied_area_m2
     or new.supplied_removal_m2 is distinct from old.supplied_removal_m2 or new.provenance is distinct from old.provenance) then
    raise exception 'installer-supplied measurement figures are permanent';
  end if;
  if old.verified_at is not null and (new.verified_area_m2 is distinct from old.verified_area_m2 or new.verified_method is distinct from old.verified_method or new.verified_by is distinct from old.verified_by) then
    raise exception 'onsite verification figures are permanent';
  end if;
  return new;
end $$;
DROP TRIGGER IF EXISTS trg_guard_supplied_measurement ON public.ceiling_measurements;
CREATE TRIGGER trg_guard_supplied_measurement BEFORE UPDATE ON public.ceiling_measurements FOR EACH ROW EXECUTE FUNCTION public.guard_supplied_measurement();

ALTER TABLE public.workflow_settings
  ADD COLUMN IF NOT EXISTS measurement_standard_version text,
  ADD COLUMN IF NOT EXISTS measurement_standard_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS measurement_standard_approved_by uuid,
  ADD COLUMN IF NOT EXISTS measurement_standard_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS measurement_variance_tolerance_pct numeric;
COMMENT ON COLUMN public.workflow_settings.measurement_variance_tolerance_pct IS 'Pilot calibration only; null = no tolerance set. Set by admin after pilot review.';

CREATE TABLE public.partner_measurement_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id),
  version text NOT NULL,
  method text NOT NULL CHECK (method IN ('laser','tape','floorplan','other')),
  description text NOT NULL,
  tools text,
  zone_breakdown boolean NOT NULL DEFAULT true,
  evidence_expected text,
  exclusions_rule text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','retired')),
  approved_by uuid, approved_at timestamptz, approval_reason text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, version)
);
GRANT SELECT ON public.partner_measurement_methods TO authenticated;
GRANT ALL ON public.partner_measurement_methods TO service_role;
ALTER TABLE public.partner_measurement_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins and own business read measurement methods" ON public.partner_measurement_methods FOR SELECT TO authenticated
  USING (public.is_admin() OR public.is_business_member(business_id, false));