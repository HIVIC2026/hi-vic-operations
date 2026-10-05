-- Automatic quote release controls. Existing switches stay unchanged.
ALTER TABLE public.workflow_settings
  ADD COLUMN IF NOT EXISTS quote_estimate_variance_tolerance_pct numeric(5,2) NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS installer_quote_min_inc_gst_per_m2 numeric(10,2),
  ADD COLUMN IF NOT EXISTS installer_quote_max_inc_gst_per_m2 numeric(10,2);

ALTER TABLE public.workflow_settings
  ADD CONSTRAINT workflow_settings_quote_variance_range CHECK (quote_estimate_variance_tolerance_pct >= 0 AND quote_estimate_variance_tolerance_pct <= 100),
  ADD CONSTRAINT workflow_settings_installer_quote_min_positive CHECK (installer_quote_min_inc_gst_per_m2 IS NULL OR installer_quote_min_inc_gst_per_m2 > 0),
  ADD CONSTRAINT workflow_settings_installer_quote_max_positive CHECK (installer_quote_max_inc_gst_per_m2 IS NULL OR installer_quote_max_inc_gst_per_m2 > 0),
  ADD CONSTRAINT workflow_settings_installer_quote_range_order CHECK (installer_quote_min_inc_gst_per_m2 IS NULL OR installer_quote_max_inc_gst_per_m2 IS NULL OR installer_quote_min_inc_gst_per_m2 <= installer_quote_max_inc_gst_per_m2);

COMMENT ON COLUMN public.workflow_settings.quote_estimate_variance_tolerance_pct IS 'Confirmed owner quote holds for office review when its total differs from the current preliminary estimate by more than this percentage. Default 15.';
COMMENT ON COLUMN public.workflow_settings.installer_quote_min_inc_gst_per_m2 IS 'Optional lower normal-range check for installer-supplied quoted installation price per measured square metre. Null disables the lower check.';
COMMENT ON COLUMN public.workflow_settings.installer_quote_max_inc_gst_per_m2 IS 'Optional upper normal-range check for installer-supplied quoted installation price per measured square metre. Null disables the upper check.';

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS release_state text,
  ADD COLUMN IF NOT EXISTS release_hold_reason text;

ALTER TABLE public.quotes
  ADD CONSTRAINT quotes_release_state_valid CHECK (release_state IS NULL OR release_state IN ('held', 'queued', 'released'));

COMMENT ON COLUMN public.quotes.release_state IS 'Automatic release result: held for office review, queued behind launch switches, or released to the owner. Null marks legacy quotes.';
COMMENT ON COLUMN public.quotes.release_hold_reason IS 'Plain office-facing reason an automatically generated quote was held. Null when queued or released.';