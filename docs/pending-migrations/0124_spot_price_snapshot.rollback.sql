DROP INDEX IF EXISTS public.lead_campaign_responses_rank_idx;
ALTER TABLE public.lead_campaign_responses
  DROP COLUMN queue_rank, DROP COLUMN saved_estimate_url, DROP COLUMN saved_insulation, DROP COLUMN saved_area_m2,
  DROP COLUMN saved_gross_total, DROP COLUMN saved_veu_discount, DROP COLUMN saved_total, DROP COLUMN saved_estimate_id;
