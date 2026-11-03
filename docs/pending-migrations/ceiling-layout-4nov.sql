-- Jo 4 Nov 2026: A2 retail prices for top-ups, R6.0 and R7.0 (left BLANK for Jo to fill in; a blank needed price holds
-- the quote for office review) and the Settings switch "Top-ups can count old insulation towards R5.0" (ON by default).
ALTER TABLE public.retail_estimator_settings
  ADD COLUMN IF NOT EXISTS topup_inc_gst_per_m2 numeric(10,2) CHECK (topup_inc_gst_per_m2 IS NULL OR topup_inc_gst_per_m2 > 0),
  ADD COLUMN IF NOT EXISTS r6_install_inc_gst_per_m2 numeric(10,2) CHECK (r6_install_inc_gst_per_m2 IS NULL OR r6_install_inc_gst_per_m2 > 0),
  ADD COLUMN IF NOT EXISTS r7_install_inc_gst_per_m2 numeric(10,2) CHECK (r7_install_inc_gst_per_m2 IS NULL OR r7_install_inc_gst_per_m2 > 0);
ALTER TABLE public.workflow_settings
  ADD COLUMN IF NOT EXISTS topups_count_existing_insulation boolean NOT NULL DEFAULT true;
