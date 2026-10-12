-- STAGED undo for Part A ONLY, and only if activate_pricing_cutover was never called (no pricing_cutover rows).
-- After activation use SELECT public.rollback_pricing_cutover(<actor>, <reason>); cohort/backup history is kept.
DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.pricing_cutover) THEN RAISE EXCEPTION 'Cutover was activated — use rollback_pricing_cutover instead'; END IF; END $$;
DROP TRIGGER IF EXISTS lead_campaign_responses_pricing_cohort ON public.lead_campaign_responses;
DROP FUNCTION IF EXISTS public.assign_pricing_cohort_on_save();
DROP FUNCTION IF EXISTS public.activate_pricing_cutover(uuid, text, text);
DROP FUNCTION IF EXISTS public.rollback_pricing_cutover(uuid, text);
DROP TABLE IF EXISTS public.job_pricing_cohorts;
DROP TABLE IF EXISTS public.saved_spot_price_backup;
DROP TABLE IF EXISTS public.pricing_cutover;
DROP FUNCTION IF EXISTS public.guard_pricing_immutable();
ALTER TABLE public.retail_estimator_settings DROP COLUMN IF EXISTS ready_check_fee_inc_gst;
