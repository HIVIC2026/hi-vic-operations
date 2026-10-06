-- Save-my-spot: freeze the exact estimate the owner saw, and an explicit numeric queue order.
ALTER TABLE public.lead_campaign_responses
  ADD COLUMN saved_estimate_id uuid,
  ADD COLUMN saved_total numeric(12,2),
  ADD COLUMN saved_veu_discount numeric(12,2),
  ADD COLUMN saved_gross_total numeric(12,2),
  ADD COLUMN saved_area_m2 numeric(10,2),
  ADD COLUMN saved_insulation text,
  ADD COLUMN saved_estimate_url text,
  ADD COLUMN queue_rank smallint GENERATED ALWAYS AS (CASE WHEN queue_priority = 'video' THEN 1 ELSE 0 END) STORED;

COMMENT ON COLUMN public.lead_campaign_responses.saved_total IS 'Estimated customer total (inc GST) shown when the spot was saved. Never updated afterwards.';
COMMENT ON COLUMN public.lead_campaign_responses.queue_rank IS 'Explicit queue order: video = 1, none = 0. Sort DESC, then spot_saved_at ASC.';

CREATE INDEX lead_campaign_responses_rank_idx
  ON public.lead_campaign_responses (queue_rank DESC, spot_saved_at ASC)
  WHERE spot_saved_at IS NOT NULL AND opted_out_at IS NULL;
