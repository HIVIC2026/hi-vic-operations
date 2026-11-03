ALTER TABLE public.retail_estimator_settings DROP COLUMN IF EXISTS topup_inc_gst_per_m2, DROP COLUMN IF EXISTS r6_install_inc_gst_per_m2, DROP COLUMN IF EXISTS r7_install_inc_gst_per_m2;
ALTER TABLE public.workflow_settings DROP COLUMN IF EXISTS topups_count_existing_insulation;
