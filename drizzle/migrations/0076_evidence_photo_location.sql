ALTER TABLE public.evidence_files
  ADD COLUMN IF NOT EXISTS lat double precision,
  ADD COLUMN IF NOT EXISTS lng double precision,
  ADD COLUMN IF NOT EXISTS location_accuracy_m double precision,
  ADD COLUMN IF NOT EXISTS captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS distance_m double precision,
  ADD COLUMN IF NOT EXISTS location_source text;
ALTER TABLE public.workflow_settings
  ADD COLUMN IF NOT EXISTS photo_max_distance_m integer NOT NULL DEFAULT 150;
ALTER TYPE public.evidence_category ADD VALUE IF NOT EXISTS 'identity_front_of_property';
ALTER TYPE public.evidence_category ADD VALUE IF NOT EXISTS 'switchboard_cables';
ALTER TYPE public.evidence_category ADD VALUE IF NOT EXISTS 'electrical_isolation';
ALTER TYPE public.evidence_category ADD VALUE IF NOT EXISTS 'solar_battery';
ALTER TYPE public.evidence_category ADD VALUE IF NOT EXISTS 'post_install_video';
ALTER TYPE public.evidence_category ADD VALUE IF NOT EXISTS 'final_zone_plan';